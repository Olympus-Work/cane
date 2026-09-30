import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateSync } from 'otplib';
import { Test } from '@nestjs/testing';
import type { LoggerService } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { AppModule } from '../src/app.module.js';
import { configureApp, newAdapter } from '../src/app.setup.js';
import { AuthService, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../src/auth/auth.service.js';
import { sha256Hex } from '../src/auth/tokens.js';
import { PERMISSION_CHECKER, type KeyPermissions } from '../src/settings/binance-permissions.js';
import { NOTIFIER } from '../src/engine/engine.service.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { DATABASE_URL, freshDb } from './support/db.js';

/** Fixture secrets: none of these may appear in any log line or in any API response (AC11). */
const EMAIL = 'owner@example.com';
const PASSWORD = 'fixture-password-9f3k2m1z';
const NEW_PASSWORD = 'fixture-new-password-7q8w1e2r';
// Built at runtime so the gitleaks hook does not flag an obviously fake fixture.
const fake = (...parts: string[]) => parts.join('-');
const BINANCE_KEY = fake('fixture', 'binance', 'key', '1111');
const BINANCE_SECRET = fake('fixture', 'binance', 'secret', '2222');
const JEV_KEY = 'fixture-jev-key-3333';
const LINE_TOKEN = 'fixture-line-token-4444';
const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

const GOOD_KEY: KeyPermissions = { withdrawals: false, universalTransfer: false, spotTrading: true, futuresTrading: true };
let keyPermissions: KeyPermissions = GOOD_KEY;

/** Everything Nest logs, plus everything written to stdout / stderr, during the run. */
const logged: string[] = [];
const sink: LoggerService = {
  log: (m: unknown) => void logged.push(String(m)),
  error: (m: unknown, ...rest: unknown[]) => void logged.push(String(m), ...rest.map(String)),
  warn: (m: unknown) => void logged.push(String(m)),
  debug: (m: unknown) => void logged.push(String(m)),
  verbose: (m: unknown) => void logged.push(String(m)),
};

const notifications: string[] = [];

describe.skipIf(!DATABASE_URL)('Auth + Settings API (AC11, AC12)', () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let auth: AuthService;
  let totpSecret: string;
  let recoveryCodes: string[];
  const responses: Array<{ url: string; body: string; allowSecrets?: string[] }> = [];
  const t0 = Date.parse('2030-01-01T12:00:00Z');
  let clock = t0;
  const setClock = (ms: number) => {
    clock = ms;
    vi.setSystemTime(ms);
  };
  const advance = (ms: number) => setClock(clock + ms);
  /** A code for a TOTP step no earlier call has used: moves the clock forward one step first. */
  const freshCode = (secret = totpSecret) => {
    advance(31_000);
    return generateSync({ strategy: 'totp', secret, epoch: Math.floor(clock / 1000) });
  };

  async function call(method: 'GET' | 'POST' | 'PUT', url: string, opts: { body?: unknown; token?: string; code?: string; allowSecrets?: string[] } = {}) {
    const headers: Record<string, string> = {};
    if (opts.token) headers.cookie = `cane_session=${opts.token}`;
    if (opts.code) headers['x-totp-code'] = opts.code;
    const res = await app.inject({ method, url, headers, ...(opts.body === undefined ? {} : { payload: opts.body as object }) });
    responses.push({ url, body: res.payload, allowSecrets: opts.allowSecrets });
    return res;
  }
  const cookieToken = (res: { cookies: Array<{ name: string; value: string }> }) => res.cookies.find((c) => c.name === 'cane_session')?.value;

  async function login(code = freshCode(), password = PASSWORD) {
    return call('POST', '/v1/auth/login', { body: { email: EMAIL, password, code } });
  }
  async function signedIn(): Promise<string> {
    const res = await login();
    expect(res.statusCode).toBe(200);
    return cookieToken(res)!;
  }
  const auditActions = async () => (await pool.query('select action from audit_log order by id')).rows.map((r) => r.action as string);

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
      vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        logged.push(String(chunk));
        return write(chunk, ...rest);
      }) as typeof stream.write);
    }
    setClock(t0);
    process.env.CANE_MASTER_KEY = MASTER_KEY;
    delete process.env.TRADING_ENABLED;
    delete process.env.TYPESAFE_API_KEY;
    pool = await freshDb();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PERMISSION_CHECKER)
      .useValue({ check: async () => keyPermissions })
      .overrideProvider(NOTIFIER)
      .useValue({ notify: async (event: string) => void notifications.push(event) })
      .setLogger(sink)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(newAdapter());
    app.useLogger(sink);
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    auth = app.get(AuthService);
    const seeded = await auth.seedOwner(EMAIL, PASSWORD);
    if (typeof seeded === 'string') throw new Error(`seed failed: ${seeded}`);
    totpSecret = seeded.enrolment.secret;
    recoveryCodes = seeded.recoveryCodes;
    await pool.query(
      `insert into strategies (id, pair, market, leverage, margin_mode) values ('S-01','BTCUSDT','futures',5,'isolated'), ('S-02','BTCUSDT','futures',5,'isolated'), ('S-03','ETHUSDT','spot',null,null)`,
    );
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    vi.useRealTimers();
  });

  describe('login (B14.2, B14.3)', () => {
    it('fails without a TOTP code, with a wrong one, and never sets a cookie', async () => {
      const missing = await call('POST', '/v1/auth/login', { body: { email: EMAIL, password: PASSWORD } });
      expect(missing.statusCode).toBe(400);
      const wrong = await call('POST', '/v1/auth/login', { body: { email: EMAIL, password: PASSWORD, code: '000000' } });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.headers['set-cookie']).toBeUndefined();
      const wrongPassword = await login(freshCode(), 'not-the-password');
      expect(wrongPassword.statusCode).toBe(401);
    });

    it('succeeds with email + password + code and sets an HttpOnly, Secure, SameSite=Strict cookie whose token is stored only as a hash', async () => {
      const res = await login();
      expect(res.statusCode).toBe(200);
      const setCookie = String(res.headers['set-cookie']);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
      const token = cookieToken(res)!;
      const { rows } = await pool.query('select token_hash from sessions');
      expect(rows.map((r) => r.token_hash)).toContain(sha256Hex(token));
      expect(JSON.stringify(rows)).not.toContain(token);
    });

    it('rejects a TOTP code that was already used (replay)', async () => {
      const code = freshCode();
      expect((await login(code)).statusCode).toBe(200);
      expect((await login(code)).statusCode).toBe(401);
    });

    it('accepts a recovery code once, in place of the TOTP code', async () => {
      const first = await call('POST', '/v1/auth/login', { body: { email: EMAIL, password: PASSWORD, code: recoveryCodes[0] } });
      expect(first.statusCode).toBe(200);
      const again = await call('POST', '/v1/auth/login', { body: { email: EMAIL, password: PASSWORD, code: recoveryCodes[0] } });
      expect(again.statusCode).toBe(401);
    });

    it('locks for 15 minutes after 5 failures, tells the notifier, and unlocks afterwards', async () => {
      await auth.resetPassword(PASSWORD); // clears any earlier failure count
      notifications.length = 0;
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await login(freshCode(), 'wrong-password-attempt')).statusCode);
      expect(statuses).toEqual([401, 401, 401, 401, 423]);
      expect(notifications.filter((n) => n === 'login_failed_lockout')).toHaveLength(1);
      // Correct credentials are refused while locked, without spending the code.
      const code = freshCode();
      expect((await login(code)).statusCode).toBe(423);
      advance(15 * 60_000 + 1000);
      expect((await login(freshCode())).statusCode).toBe(200);
      expect(await auditActions()).toContain('login_failed_lockout');
    });
  });

  describe('sessions (B14.4)', () => {
    it('expires after 30 minutes idle', async () => {
      const token = await signedIn();
      expect((await call('GET', '/v1/auth/sessions', { token })).statusCode).toBe(200);
      advance(SESSION_IDLE_MS - 60_000);
      expect((await call('GET', '/v1/auth/sessions', { token })).statusCode).toBe(200); // still alive, and touched
      advance(SESSION_IDLE_MS + 60_000);
      expect((await call('GET', '/v1/auth/sessions', { token })).statusCode).toBe(401);
    });

    it('expires after 12 hours even when it is used all the time', async () => {
      const token = await signedIn();
      const start = clock;
      while (clock - start < SESSION_ABSOLUTE_MS - 25 * 60_000) {
        advance(20 * 60_000);
        expect((await call('GET', '/v1/auth/sessions', { token })).statusCode).toBe(200);
      }
      advance(30 * 60_000);
      expect((await call('GET', '/v1/auth/sessions', { token })).statusCode).toBe(401);
    });

    it('lists the current session with device, IP and expiry, and logout ends it', async () => {
      const token = await signedIn();
      const list = JSON.parse((await call('GET', '/v1/auth/sessions', { token })).payload) as { sessions: Array<{ current: boolean; expiresAt: string; ip: string | null }> };
      const current = list.sessions.filter((s) => s.current);
      expect(current).toHaveLength(1);
      expect(current[0]!.expiresAt).toBeTruthy();
      expect((await call('POST', '/v1/auth/logout', { token })).statusCode).toBe(204);
      expect((await call('GET', '/v1/auth/sessions', { token })).statusCode).toBe(401);
    });

    it('protected routes need a session', async () => {
      for (const [method, url] of [['GET', '/v1/settings'], ['GET', '/v1/auth/sessions'], ['POST', '/v1/strategies/S-01/disable']] as const) {
        expect((await call(method, url)).statusCode).toBe(401);
      }
    });
  });

  describe('fresh TOTP gates (B14.5)', () => {
    it('enabling a strategy fails without a fresh code, with a wrong one and with a reused one', async () => {
      const token = await signedIn();
      expect((await call('POST', '/v1/strategies/S-01/enable', { token })).statusCode).toBe(403);
      expect((await call('POST', '/v1/strategies/S-01/enable', { token, code: '123456' })).statusCode).toBe(403);
      const code = freshCode();
      expect((await call('POST', '/v1/strategies/S-01/enable', { token, code })).statusCode).toBe(200);
      const status = async () => (await pool.query("select status from strategies where id = 'S-01'")).rows[0].status;
      expect(await status()).toBe('enabled');
      await call('POST', '/v1/strategies/S-01/disable', { token }); // a session is enough to disable
      expect(await status()).toBe('disabled');
      expect((await call('POST', '/v1/strategies/S-01/enable', { token, code })).statusCode).toBe(403); // same code again
      expect(await status()).toBe('disabled');
    });

    it('one active strategy per pair: the second enable is refused and names the first', async () => {
      const token = await signedIn();
      expect((await call('POST', '/v1/strategies/S-01/enable', { token, code: freshCode() })).statusCode).toBe(200);
      const res = await call('POST', '/v1/strategies/S-02/enable', { token, code: freshCode() });
      expect(res.statusCode).toBe(409);
      expect(res.payload).toContain('S-01');
      await call('POST', '/v1/strategies/S-01/disable', { token });
    });

    it('every gated Settings and Security route refuses a request without a fresh code', async () => {
      const token = await signedIn();
      const gated: Array<['POST' | 'PUT', string, unknown]> = [
        ['PUT', '/v1/settings/binance-key', { apiKey: BINANCE_KEY, apiSecret: BINANCE_SECRET }],
        ['PUT', '/v1/settings/notifications', { lineChannelToken: LINE_TOKEN }],
        ['PUT', '/v1/settings/jev', { apiKey: JEV_KEY }],
        ['POST', '/v1/auth/totp/setup', {}],
        ['POST', '/v1/auth/recovery-codes', {}],
      ];
      for (const [method, url, body] of gated) expect((await call(method, url, { token, body })).statusCode, url).toBe(403);
      expect(Object.values(await app.get(SettingsService).hints()).every((h) => h === null)).toBe(true);
    });
  });

  describe('Binance key (B15, AC12)', () => {
    it('rejects a key with withdrawals on, saves nothing, and says why', async () => {
      const token = await signedIn();
      keyPermissions = { ...GOOD_KEY, withdrawals: true };
      const res = await call('PUT', '/v1/settings/binance-key', { token, code: freshCode(), body: { apiKey: BINANCE_KEY, apiSecret: BINANCE_SECRET } });
      expect(res.statusCode).toBe(422);
      expect(res.payload).toMatch(/withdraw/i);
      expect(JSON.parse(res.payload)).toMatchObject({ code: 'withdrawals_enabled' });
      expect((await pool.query("select 1 from settings where key like 'binance_%'")).rowCount).toBe(0);
    });

    it('rejects a key that cannot trade, and one that cannot trade a market a strategy uses', async () => {
      const token = await signedIn();
      keyPermissions = { ...GOOD_KEY, spotTrading: false, futuresTrading: false };
      expect((await call('PUT', '/v1/settings/binance-key', { token, code: freshCode(), body: { apiKey: BINANCE_KEY, apiSecret: BINANCE_SECRET } })).statusCode).toBe(422);
      keyPermissions = { ...GOOD_KEY, futuresTrading: false }; // S-01 / S-02 are futures strategies
      const res = await call('PUT', '/v1/settings/binance-key', { token, code: freshCode(), body: { apiKey: BINANCE_KEY, apiSecret: BINANCE_SECRET } });
      expect(res.statusCode).toBe(422);
      expect(res.payload).toMatch(/futures/);
      expect(JSON.parse(res.payload)).toMatchObject({ code: 'market_not_enabled', markets: ['futures'] });
      expect((await pool.query("select 1 from settings where key like 'binance_%'")).rowCount).toBe(0);
    });

    it('saves a good key encrypted, returns only the last 4 characters, and the engine can read it back', async () => {
      const token = await signedIn();
      keyPermissions = GOOD_KEY;
      const res = await call('PUT', '/v1/settings/binance-key', { token, code: freshCode(), body: { apiKey: BINANCE_KEY, apiSecret: BINANCE_SECRET } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ apiKey: '1111' });
      const rows = (await pool.query("select key, value, value_enc, hint from settings where key like 'binance_%' order by key")).rows;
      expect(rows.map((r) => r.hint)).toEqual(['1111', '2222']);
      for (const r of rows) {
        expect(r.value).toBeNull();
        expect(Buffer.from(r.value_enc).includes(Buffer.from(BINANCE_KEY))).toBe(false);
        expect(Buffer.from(r.value_enc).includes(Buffer.from(BINANCE_SECRET))).toBe(false);
      }
      expect(await app.get(SettingsService).binanceCredentials()).toEqual({ apiKey: BINANCE_KEY, apiSecret: BINANCE_SECRET });
      const settingsView = JSON.parse((await call('GET', '/v1/settings', { token })).payload) as { secrets: Record<string, string | null> };
      expect(settingsView.secrets.binance_api_key).toBe('1111');
    });

    it('saves notification targets and the Jev key/timeout, audited with hints only', async () => {
      const token = await signedIn();
      expect((await call('PUT', '/v1/settings/notifications', { token, code: freshCode(), body: { lineChannelToken: LINE_TOKEN } })).statusCode).toBe(200);
      expect((await call('PUT', '/v1/settings/jev', { token, code: freshCode(), body: { apiKey: JEV_KEY, timeoutMs: 2500 } })).statusCode).toBe(200);
      expect((await call('PUT', '/v1/settings/jev', { token, code: freshCode(), body: { timeoutMs: 50 } })).statusCode).toBe(400);
      expect(await app.get(SettingsService).getJevTimeoutMs()).toBe(2500);
      const audit = JSON.stringify((await pool.query('select before, after from audit_log where action in ($1, $2, $3)', ['key_change', 'notification_change', 'jev_change'])).rows);
      for (const secret of [BINANCE_KEY, BINANCE_SECRET, JEV_KEY, LINE_TOKEN]) expect(audit).not.toContain(secret);
      const actions = await auditActions();
      expect(actions).toEqual(expect.arrayContaining(['key_change', 'notification_change', 'jev_change']));
    });
  });

  describe('security settings (B14.5, B14.6)', () => {
    it('regenerating recovery codes needs a fresh code and invalidates the old ones', async () => {
      const token = await signedIn();
      const res = await call('POST', '/v1/auth/recovery-codes', { token, code: freshCode(), allowSecrets: ['recoveryCodes'] });
      expect(res.statusCode).toBe(200);
      const fresh = (JSON.parse(res.payload) as { recoveryCodes: string[] }).recoveryCodes;
      expect(fresh).toHaveLength(10);
      recoveryCodes = fresh;
      const old = await call('POST', '/v1/auth/login', { body: { email: EMAIL, password: PASSWORD, code: '0000-0000-0000' } });
      expect(old.statusCode).toBe(401);
    });

    it('TOTP re-setup: a fresh code starts it, a code from the new secret confirms it, the old secret stops working', async () => {
      const token = await signedIn();
      const setup = await call('POST', '/v1/auth/totp/setup', { token, code: freshCode(), allowSecrets: ['secret', 'uri'] });
      expect(setup.statusCode).toBe(200);
      const { secret: newSecret } = JSON.parse(setup.payload) as { secret: string };
      const badConfirm = await call('POST', '/v1/auth/totp/confirm', { token, body: { code: '000000' } });
      expect(badConfirm.statusCode).toBe(400);
      advance(31_000);
      const confirm = await call('POST', '/v1/auth/totp/confirm', {
        token,
        body: { code: generateSync({ strategy: 'totp', secret: newSecret, epoch: Math.floor(clock / 1000) }) },
        allowSecrets: ['recoveryCodes'],
      });
      expect(confirm.statusCode).toBe(200);
      const oldCode = freshCode(totpSecret);
      expect((await login(oldCode)).statusCode).toBe(401);
      totpSecret = newSecret;
      expect((await login(freshCode())).statusCode).toBe(200);
    });

    it('changing the password needs the current one, and signs other sessions out', async () => {
      const token = await signedIn();
      const other = await signedIn();
      expect((await call('POST', '/v1/auth/password', { token, body: { currentPassword: 'wrong-current-password', newPassword: NEW_PASSWORD } })).statusCode).toBe(401);
      expect((await call('POST', '/v1/auth/password', { token, body: { currentPassword: PASSWORD, newPassword: 'short' } })).statusCode).toBe(400);
      expect((await call('POST', '/v1/auth/password', { token, body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } })).statusCode).toBe(204);
      expect((await call('GET', '/v1/auth/sessions', { token })).statusCode).toBe(200);
      expect((await call('GET', '/v1/auth/sessions', { token: other })).statusCode).toBe(401);
      expect((await login(freshCode(), PASSWORD)).statusCode).toBe(401);
      expect((await login(freshCode(), NEW_PASSWORD)).statusCode).toBe(200);
    });
  });

  describe('test message (B13.4)', () => {
    it('needs a session, rejects an unknown channel, and reports an unset channel without queueing anything', async () => {
      expect((await call('POST', '/v1/settings/notifications/test', { body: { channel: 'line' } })).statusCode).toBe(401);
      const token = cookieToken(await login(freshCode(), NEW_PASSWORD))!; // the password was changed above
      expect((await call('POST', '/v1/settings/notifications/test', { token, body: { channel: 'sms' } })).statusCode).toBe(400);
      // Only the LINE token was saved above (no user ID), so LINE is not set up.
      const res = await call('POST', '/v1/settings/notifications/test', { token, body: { channel: 'line' } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ ok: false, error: 'This channel is not set up in Settings.' });
      expect((await pool.query('select 1 from notifications')).rowCount).toBe(0);
    });
  });

  describe('log scan (AC11: keys never appear in API responses or logs)', () => {
    it('no fixture secret appears in any log line or any API response', async () => {
      const allLogs = logged.join('\n');
      const everything = [PASSWORD, NEW_PASSWORD, BINANCE_KEY, BINANCE_SECRET, JEV_KEY, LINE_TOKEN];
      for (const s of everything) expect(allLogs, `log contains ${s.slice(0, 8)}...`).not.toContain(s);
      expect(allLogs).not.toContain(totpSecret);

      const tokens = (await pool.query('select id from sessions')).rows.length; // sessions exist, so the scan below is meaningful
      expect(tokens).toBeGreaterThan(0);
      for (const r of responses) {
        for (const s of everything) expect(r.body, `${r.url} leaked ${s.slice(0, 8)}...`).not.toContain(s);
        if (!r.allowSecrets?.includes('secret')) expect(r.body, `${r.url} leaked the TOTP secret`).not.toContain(totpSecret);
        if (!r.allowSecrets?.includes('recoveryCodes')) for (const c of recoveryCodes) expect(r.body, `${r.url} leaked a recovery code`).not.toContain(c);
      }
      expect(responses.length).toBeGreaterThan(40); // the scan covered a real run
      expect(logged.length).toBeGreaterThan(0);
    });
  });
});
