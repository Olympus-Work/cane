import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { DB } from '../db/db.module.js';
import { owner, recoveryCodes, sessions, settings } from '../db/schema.js';
import { NOTIFIER } from '../engine/engine.service.js';
import type { Notifier } from '../engine/ports.js';
import { hashPassword, verifyPassword } from './password.js';
import { SecretBox } from './secret-box.js';
import { newRecoveryCodes, newSessionToken, normaliseRecoveryCode, sha256Hex } from './tokens.js';
import { checkTotp, newTotpSecret, totpUri } from './totp.js';

export const SECRET_BOX = Symbol('SECRET_BOX');

/** B14.3 / B14.4. */
export const LOCK_AFTER_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_MS = 12 * 3_600_000;
export const MIN_PASSWORD_LENGTH = 12;

const PENDING_TOTP_KEY = 'totp_pending';

export interface RequestCtx {
  ip: string | null;
  device: string | null;
}

export type LoginResult = { ok: true; token: string; expiresAt: Date } | { ok: false; reason: 'invalid' | 'locked' };

export interface SessionInfo {
  id: string;
  device: string | null;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface TotpEnrolment {
  secret: string;
  uri: string;
}

/** Constant-time text comparison (both sides hashed to equal length first). */
const sameText = (a: string, b: string): boolean => timingSafeEqual(Buffer.from(sha256Hex(a), 'hex'), Buffer.from(sha256Hex(b), 'hex'));
const normEmail = (e: string): string => e.trim().toLowerCase();

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    private readonly audit: AuditService,
  ) {}

  private async loadOwner() {
    const [o] = await this.db.select().from(owner).where(eq(owner.id, 1));
    return o ?? null;
  }

  // --- Login (B14.2, B14.3) ---

  /** Email + password + (TOTP code or a recovery code). Every failure looks the same to the caller, except "locked". */
  async login(email: string, password: string, code: string, ctx: RequestCtx, now: Date = new Date()): Promise<LoginResult> {
    const o = await this.loadOwner();
    if (!o) {
      await hashPassword(password); // similar cost whether or not the account exists
      await this.audit.record({ actor: 'anonymous', action: 'login_failed', after: { reason: 'no_owner' }, ip: ctx.ip });
      return { ok: false, reason: 'invalid' };
    }
    if (o.lockedUntil && o.lockedUntil > now) {
      await this.audit.record({ actor: 'owner', action: 'login_failed', after: { reason: 'locked' }, ip: ctx.ip });
      return { ok: false, reason: 'locked' };
    }

    const emailOk = sameText(normEmail(email), normEmail(o.email));
    const passwordOk = await verifyPassword(o.passwordHash, password);
    const totpStep = o.totpSecretEnc ? checkTotp(this.box.decrypt(o.totpSecretEnc), code, o.totpLastStep, now.getTime()) : null;
    const recoveryId = totpStep === null ? await this.findRecoveryCode(code) : null;

    // The second factor is only spent once email and password are right.
    let secondFactorOk = false;
    if (emailOk && passwordOk) {
      if (totpStep !== null) secondFactorOk = await this.claimStep(totpStep);
      else if (recoveryId !== null) secondFactorOk = await this.claimRecoveryCode(recoveryId, now);
    }
    if (!secondFactorOk) {
      const locked = await this.registerFailure(ctx, now, 'login_failed');
      return { ok: false, reason: locked ? 'locked' : 'invalid' };
    }

    await this.db.update(owner).set({ failedLogins: 0, lockedUntil: null }).where(eq(owner.id, 1));
    const session = await this.createSession(ctx, now);
    await this.audit.record({ actor: 'owner', action: 'login_success', target: session.id, ip: ctx.ip });
    await this.notifier.notify('login_success', null, {});
    return { ok: true, token: session.token, expiresAt: session.expiresAt };
  }

  /** One atomic UPDATE counts the failure and locks at the limit. Returns whether this failure locked the account. */
  private async registerFailure(ctx: RequestCtx, now: Date, action: string): Promise<boolean> {
    const lockUntil = new Date(now.getTime() + LOCK_MS).toISOString();
    const [r] = await this.db
      .update(owner)
      .set({
        failedLogins: sql`case when ${owner.failedLogins} + 1 >= ${LOCK_AFTER_FAILURES} then 0 else ${owner.failedLogins} + 1 end`,
        lockedUntil: sql`case when ${owner.failedLogins} + 1 >= ${LOCK_AFTER_FAILURES} then ${lockUntil}::timestamptz else ${owner.lockedUntil} end`,
      })
      .where(eq(owner.id, 1))
      .returning({ lockedUntil: owner.lockedUntil });
    const locked = !!r?.lockedUntil && r.lockedUntil.toISOString() === lockUntil;
    await this.audit.record({ actor: 'owner', action, after: { locked }, ip: ctx.ip });
    if (locked) {
      await this.audit.record({ actor: 'owner', action: 'login_failed_lockout', ip: ctx.ip });
      await this.notifier.notify('login_failed_lockout', null, { minutes: LOCK_MS / 60_000 });
    }
    return locked;
  }

  /** Marks a TOTP time step as used; false if that step or a later one was already accepted. */
  private async claimStep(step: number): Promise<boolean> {
    const rows = await this.db
      .update(owner)
      .set({ totpLastStep: step })
      .where(and(eq(owner.id, 1), sql`(${owner.totpLastStep} is null or ${owner.totpLastStep} < ${step})`))
      .returning({ id: owner.id });
    return rows.length === 1;
  }

  private async findRecoveryCode(code: string): Promise<number | null> {
    if (!/^[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}$/i.test(code.trim())) return null;
    const [r] = await this.db
      .select({ id: recoveryCodes.id })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.codeHash, sha256Hex(normaliseRecoveryCode(code))), isNull(recoveryCodes.usedAt)));
    return r?.id ?? null;
  }

  private async claimRecoveryCode(id: number, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(recoveryCodes)
      .set({ usedAt: now })
      .where(and(eq(recoveryCodes.id, id), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });
    return rows.length === 1;
  }

  // --- Sessions (B14.4) ---

  private async createSession(ctx: RequestCtx, now: Date): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = newSessionToken();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    const [row] = await this.db
      .insert(sessions)
      .values({ ownerId: 1, tokenHash: sha256Hex(token), device: ctx.device?.slice(0, 200) ?? null, ip: ctx.ip, lastSeenAt: now, expiresAt })
      .returning({ id: sessions.id });
    return { id: row!.id, token, expiresAt };
  }

  /** The live session for a cookie token, or null (unknown, revoked, idle > 30 min, past 12 h). Touches `last_seen_at`. */
  async validateSession(token: string, now: Date = new Date()): Promise<{ id: string } | null> {
    const idleLimit = new Date(now.getTime() - SESSION_IDLE_MS);
    const [row] = await this.db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.lastSeenAt, idleLimit)))
      .returning({ id: sessions.id });
    return row ?? null;
  }

  async logout(sessionId: string, ctx: RequestCtx, now: Date = new Date()): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    await this.audit.record({ actor: 'owner', action: 'logout', target: sessionId, ip: ctx.ip });
  }

  async listSessions(now: Date = new Date()): Promise<SessionInfo[]> {
    const idleLimit = new Date(now.getTime() - SESSION_IDLE_MS);
    return this.db
      .select({ id: sessions.id, device: sessions.device, ip: sessions.ip, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.lastSeenAt, idleLimit)))
      .orderBy(desc(sessions.createdAt));
  }

  private async revokeOtherSessions(keepId: string | null, now: Date): Promise<void> {
    const where = keepId === null ? isNull(sessions.revokedAt) : and(isNull(sessions.revokedAt), ne(sessions.id, keepId));
    await this.db.update(sessions).set({ revokedAt: now }).where(where);
  }

  // --- Fresh TOTP (B14.5) ---

  /**
   * True if `code` is a valid, not yet used TOTP code. Wrong codes count toward
   * the lockout like failed logins; a locked account cannot pass.
   */
  async verifyFreshTotp(code: string | undefined, ctx: RequestCtx, now: Date = new Date()): Promise<boolean> {
    const o = await this.loadOwner();
    if (!o?.totpSecretEnc || !code) return false;
    if (o.lockedUntil && o.lockedUntil > now) return false;
    const step = checkTotp(this.box.decrypt(o.totpSecretEnc), code, o.totpLastStep, now.getTime());
    if (step !== null && (await this.claimStep(step))) return true;
    await this.registerFailure(ctx, now, 'fresh_totp_failed');
    return false;
  }

  // --- Security settings (B14.5, B14.6) ---

  async changePassword(current: string, next: string, sessionId: string, ctx: RequestCtx, now: Date = new Date()): Promise<'ok' | 'wrong_password' | 'weak_password'> {
    const o = await this.loadOwner();
    if (!o || !(await verifyPassword(o.passwordHash, current))) {
      await this.audit.record({ actor: 'owner', action: 'password_change_failed', ip: ctx.ip });
      return 'wrong_password';
    }
    if (next.length < MIN_PASSWORD_LENGTH) return 'weak_password';
    await this.db.update(owner).set({ passwordHash: await hashPassword(next), updatedAt: now }).where(eq(owner.id, 1));
    await this.revokeOtherSessions(sessionId, now);
    await this.audit.record({ actor: 'owner', action: 'password_change', ip: ctx.ip });
    return 'ok';
  }

  /** Replaces all recovery codes; the plain codes are returned once and never stored. */
  async regenerateRecoveryCodes(ctx: RequestCtx, actor = 'owner'): Promise<string[]> {
    const codes = newRecoveryCodes();
    await this.db.transaction(async (tx) => {
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.ownerId, 1));
      await tx.insert(recoveryCodes).values(codes.map((c) => ({ ownerId: 1, codeHash: sha256Hex(normaliseRecoveryCode(c)) })));
    });
    await this.audit.record({ actor, action: 'recovery_codes_change', ip: ctx.ip });
    return codes;
  }

  /** Step 1 of TOTP re-setup: a new secret waits (encrypted) until a code from it is confirmed. */
  async beginTotpSetup(ctx: RequestCtx): Promise<TotpEnrolment> {
    const o = await this.loadOwner();
    if (!o) throw new Error('no owner');
    const secret = newTotpSecret();
    const valueEnc = this.box.encrypt(secret);
    await this.db
      .insert(settings)
      .values({ key: PENDING_TOTP_KEY, valueEnc })
      .onConflictDoUpdate({ target: settings.key, set: { valueEnc, value: null, updatedAt: new Date() } });
    await this.audit.record({ actor: 'owner', action: 'totp_setup_started', ip: ctx.ip });
    return { secret, uri: totpUri(secret, o.email) };
  }

  /** Step 2: a valid code from the pending secret switches to it, issues new recovery codes and signs other sessions out. */
  async confirmTotpSetup(code: string, sessionId: string, ctx: RequestCtx, now: Date = new Date()): Promise<string[] | null> {
    const [pending] = await this.db.select().from(settings).where(eq(settings.key, PENDING_TOTP_KEY));
    if (!pending?.valueEnc) return null;
    const secret = this.box.decrypt(pending.valueEnc);
    const step = checkTotp(secret, code, null, now.getTime());
    if (step === null) return null;
    await this.db.update(owner).set({ totpSecretEnc: this.box.encrypt(secret), totpLastStep: step, updatedAt: now }).where(eq(owner.id, 1));
    await this.db.delete(settings).where(eq(settings.key, PENDING_TOTP_KEY));
    await this.revokeOtherSessions(sessionId, now);
    await this.audit.record({ actor: 'owner', action: 'totp_change', ip: ctx.ip });
    return this.regenerateRecoveryCodes(ctx);
  }

  // --- CLI (B14.1, B14.6): run by the operator, never over HTTP ---

  async seedOwner(email: string, password: string): Promise<{ enrolment: TotpEnrolment; recoveryCodes: string[] } | 'exists' | 'weak_password'> {
    if (password.length < MIN_PASSWORD_LENGTH) return 'weak_password';
    if (await this.loadOwner()) return 'exists';
    const secret = newTotpSecret();
    await this.db.insert(owner).values({ id: 1, email: normEmail(email), passwordHash: await hashPassword(password), totpSecretEnc: this.box.encrypt(secret) });
    const codes = await this.regenerateRecoveryCodes({ ip: null, device: null }, 'cli');
    await this.audit.record({ actor: 'cli', action: 'owner_seeded' });
    return { enrolment: { secret, uri: totpUri(secret, normEmail(email)) }, recoveryCodes: codes };
  }

  async resetPassword(password: string): Promise<'ok' | 'no_owner' | 'weak_password'> {
    if (password.length < MIN_PASSWORD_LENGTH) return 'weak_password';
    const rows = await this.db
      .update(owner)
      .set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(owner.id, 1))
      .returning({ id: owner.id });
    if (rows.length === 0) return 'no_owner';
    await this.revokeOtherSessions(null, new Date());
    await this.audit.record({ actor: 'cli', action: 'password_reset' });
    return 'ok';
  }

  async resetTotp(): Promise<{ enrolment: TotpEnrolment; recoveryCodes: string[] } | 'no_owner'> {
    const o = await this.loadOwner();
    if (!o) return 'no_owner';
    const secret = newTotpSecret();
    await this.db
      .update(owner)
      .set({ totpSecretEnc: this.box.encrypt(secret), totpLastStep: null, failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(owner.id, 1));
    await this.revokeOtherSessions(null, new Date());
    const codes = await this.regenerateRecoveryCodes({ ip: null, device: null }, 'cli');
    await this.audit.record({ actor: 'cli', action: 'totp_reset' });
    return { enrolment: { secret, uri: totpUri(secret, o.email) }, recoveryCodes: codes };
  }
}
