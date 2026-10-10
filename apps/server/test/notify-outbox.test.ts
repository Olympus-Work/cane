import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { SecretBox } from '../src/auth/secret-box.js';
import type { NotifyFetch } from '../src/notify/channels.js';
import { MAX_ATTEMPTS, NotifyService, RETRY_DUE_MS } from '../src/notify/notify.service.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { DATABASE_URL, freshDb } from './support/db.js';

const fake = (...parts: string[]) => parts.join('-');
const LINE_TOKEN = fake('fixture', 'line', 'token', '1111');
const LINE_USER = fake('fixture', 'line', 'user', '2222');
const TG_TOKEN = fake('fixture', 'tg', 'token', '3333');
const TG_CHAT = fake('fixture', 'tg', 'chat', '4444');

const ok = { status: 200, text: async () => '{"ok":true}' };

/** Delivery runs in the background; give it room when the whole suite loads the machine. */
const waitFor = (check: () => Promise<void>) => vi.waitFor(check, { timeout: 8000 });

describe.skipIf(!DATABASE_URL)('notification outbox (B13.2, E12)', () => {
  let pool: pg.Pool;
  let db: NodePgDatabase;
  let settings: SettingsService;
  let fetchFn: ReturnType<typeof vi.fn<NotifyFetch>>;
  let service: NotifyService;
  const t0 = new Date('2030-01-01T12:00:00Z');
  const rows = async () => (await pool.query('select event, channel, message, status, attempts, last_error, sent_at from notifications order by id')).rows;

  beforeAll(async () => {
    pool = await freshDb();
    db = drizzle(pool);
    settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 5)));
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await pool.query('delete from notifications');
    await pool.query('delete from settings');
    fetchFn = vi.fn<NotifyFetch>(async () => ok);
    service = new NotifyService(db, settings, fetchFn);
  });

  const configure = async (which: 'line' | 'telegram' | 'both') => {
    if (which !== 'telegram') await settings.setSecrets({ line_channel_token: LINE_TOKEN, line_user_id: LINE_USER });
    if (which !== 'line') await settings.setSecrets({ telegram_bot_token: TG_TOKEN, telegram_chat_id: TG_CHAT });
  };
  const event = () => service.notify('entry_filled', 'S-01', { pair: 'BTCUSDT', side: 'long', qty: '0.01', price: '65000' });

  it('queues nothing and does not fail when no channel is configured', async () => {
    await event();
    expect(await rows()).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a channel needs both of its settings', async () => {
    await settings.setSecrets({ line_channel_token: LINE_TOKEN }); // no user ID
    await event();
    expect(await rows()).toEqual([]);
  });

  it('sends one message to every configured channel', async () => {
    await configure('both');
    await event();
    await waitFor(async () => expect((await rows()).every((r) => r.status === 'sent')).toBe(true));
    const r = await rows();
    expect(r.map((x) => x.channel).sort()).toEqual(['line', 'telegram']);
    expect(r[0]!.message).toContain('[Entry filled] S-01');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // The stored event reaches the channel: entry_filled colours both rich layouts green.
    const bodies = fetchFn.mock.calls.map(([, init]) => init.body).join('\n');
    expect(bodies).toContain('#16A34A');
    expect(bodies).toContain('🟢');
  });

  it('notify returns without waiting for the network', async () => {
    await configure('line');
    fetchFn.mockImplementation(() => new Promise(() => undefined)); // never answers
    await expect(Promise.race([event().then(() => 'returned'), new Promise((r) => setTimeout(() => r('blocked'), 1500))])).resolves.toBe('returned');
    expect((await rows())[0]!.status).toBe('pending');
  });

  it('notify never throws, even when the database is unusable', async () => {
    const broken = new NotifyService(
      { insert: () => { throw new Error('db down'); }, select: () => { throw new Error('db down'); } } as unknown as NodePgDatabase,
      { getSecret: async () => 'x' } as unknown as SettingsService,
      fetchFn,
    );
    await expect(broken.notify('entry_filled', 'S-01', {})).resolves.toBeUndefined();
  });

  it('a failing channel is retried on the schedule, then marked failed; the other channel is not held up', async () => {
    await configure('both');
    fetchFn.mockImplementation(async (url) => (url.includes('line.me') ? { status: 500, text: async () => '{"message":"boom"}' } : ok));
    await event();
    await waitFor(async () => expect((await rows()).some((r) => r.channel === 'telegram' && r.status === 'sent')).toBe(true));
    const start = new Date((await pool.query('select created_at from notifications limit 1')).rows[0].created_at);
    const line = async () => (await rows()).find((r) => r.channel === 'line')!;
    await waitFor(async () => expect((await line()).attempts).toBe(1));

    // Not due yet: 29 s after creation nothing more is sent.
    await service.deliverDue(new Date(start.getTime() + 29_000));
    expect((await line()).attempts).toBe(1);
    for (let n = 1; n < MAX_ATTEMPTS; n++) {
      await service.deliverDue(new Date(start.getTime() + RETRY_DUE_MS[n]!));
      expect((await line()).attempts).toBe(n + 1);
    }
    const last = await line();
    expect(last.status).toBe('failed');
    expect(last.last_error).toBe('HTTP 500: boom');
    // A failed row is never picked up again.
    await service.deliverDue(new Date(start.getTime() + 10 * 3_600_000));
    expect((await line()).attempts).toBe(MAX_ATTEMPTS);
  });

  it('a retry that succeeds ends as sent', async () => {
    await configure('telegram');
    fetchFn.mockImplementationOnce(async () => ({ status: 502, text: async () => 'bad gateway' })).mockImplementation(async () => ok);
    await event();
    await waitFor(async () => expect((await rows())[0]!.attempts).toBe(1));
    const start = new Date((await pool.query('select created_at from notifications')).rows[0].created_at);
    await service.deliverDue(new Date(start.getTime() + RETRY_DUE_MS[1]!));
    const r = (await rows())[0]!;
    expect(r.status).toBe('sent');
    expect(r.last_error).toBeNull();
    expect(r.sent_at).not.toBeNull();
  });

  it('two delivery runs at once never send the same row twice', async () => {
    await configure('line');
    fetchFn.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return ok;
    });
    await pool.query("insert into notifications (event, channel, message) values ('entry_filled', 'line', 'm')");
    const other = new NotifyService(db, settings, fetchFn);
    await Promise.all([service.deliverDue(t0), other.deliverDue(t0), service.deliverDue(t0)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stored text has no secrets: messages come from the whitelist and last_error hides the tokens', async () => {
    await configure('both');
    fetchFn.mockImplementation(async () => ({ status: 400, text: async () => JSON.stringify({ ok: false, description: `bad ${TG_TOKEN} ${TG_CHAT}`, message: `bad ${LINE_TOKEN}` }) }));
    await service.notify('order_rejected', 'S-01', { pair: 'BTCUSDT', reason: `key ${'A'.repeat(64)}`, apiKey: LINE_TOKEN, accountId: '123456789' });
    await waitFor(async () => expect((await rows()).every((r) => r.attempts >= 1)).toBe(true));
    const dump = JSON.stringify(await rows());
    for (const secret of [LINE_TOKEN, LINE_USER, TG_TOKEN, TG_CHAT, 'A'.repeat(64), '123456789']) expect(dump).not.toContain(secret);
  });

  it('sendTest reports the outcome and queues nothing', async () => {
    expect(await service.sendTest('telegram')).toEqual({ ok: false, error: 'This channel is not set up in Settings.' });
    await configure('telegram');
    expect(await service.sendTest('telegram')).toEqual({ ok: true });
    fetchFn.mockImplementation(async () => ({ status: 403, text: async () => '{"ok":false,"description":"Forbidden: bot was blocked"}' }));
    expect(await service.sendTest('telegram')).toEqual({ ok: false, error: 'HTTP 403: Forbidden: bot was blocked' });
    expect(await rows()).toEqual([]);
  });
});
