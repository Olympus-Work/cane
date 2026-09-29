import { ConflictException, Controller, HttpCode, Inject, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuditService } from '../audit/audit.service.js';
import { FreshTotpGuard, SessionGuard } from '../auth/guards.js';
import { ctxOf, type AuthedRequest } from '../auth/http.js';
import { DB } from '../db/db.module.js';
import { strategies } from '../db/schema.js';

const UNIQUE_VIOLATION = '23505';

/** Drizzle wraps the driver error, so the Postgres code can sit on `cause`. */
const pgCode = (e: unknown): string | undefined => (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;

/**
 * Enable / disable only (S08). Create, edit, close and the B1 warm-up belong to
 * later steps (plan.md, "Auth and Settings choices in S08").
 */
@Controller('v1/strategies')
@UseGuards(SessionGuard)
export class StrategiesController {
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase,
    private readonly audit: AuditService,
  ) {}

  /** B10.3 (fresh TOTP) and B10.2 (one active strategy per pair). */
  @Post(':id/enable')
  @HttpCode(200)
  @UseGuards(FreshTotpGuard)
  async enable(@Param('id') id: string, @Req() req: AuthedRequest) {
    const [s] = await this.db.select().from(strategies).where(eq(strategies.id, id));
    if (!s || s.status === 'closed') throw new NotFoundException('No such strategy');
    if (s.status === 'enabled') return { id, status: s.status };
    try {
      await this.db.update(strategies).set({ status: 'enabled', attentionReason: null, updatedAt: new Date() }).where(eq(strategies.id, id));
    } catch (e) {
      if (pgCode(e) !== UNIQUE_VIOLATION) throw e;
      const [other] = await this.db
        .select({ id: strategies.id })
        .from(strategies)
        .where(and(eq(strategies.pair, s.pair), inArray(strategies.status, ['enabled', 'needs_attention']), ne(strategies.id, id)));
      throw new ConflictException(`${s.pair} is already used by ${other?.id ?? 'another strategy'}`);
    }
    await this.audit.record({ actor: 'owner', action: 'strategy_enable', target: id, before: { status: s.status }, after: { status: 'enabled' }, ip: ctxOf(req).ip });
    return { id, status: 'enabled' };
  }

  /** B10.4: no new entries; an open position stays managed. Needs a session only. */
  @Post(':id/disable')
  @HttpCode(200)
  async disable(@Param('id') id: string, @Req() req: AuthedRequest) {
    const [s] = await this.db.select().from(strategies).where(eq(strategies.id, id));
    if (!s || s.status === 'closed') throw new NotFoundException('No such strategy');
    if (s.status === 'disabled') return { id, status: s.status };
    await this.db.update(strategies).set({ status: 'disabled', updatedAt: new Date() }).where(eq(strategies.id, id));
    await this.audit.record({ actor: 'owner', action: 'strategy_disable', target: id, before: { status: s.status }, after: { status: 'disabled' }, ip: ctxOf(req).ip });
    return { id, status: 'disabled' };
  }
}
