import { describe, expect, it } from 'vitest';
import { AuditController } from '../src/audit/audit.controller.js';

interface Row {
  id: number;
  at: Date;
  actor: string;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

function makeRow(id: number): Row {
  return {
    id,
    at: new Date('2026-02-06T10:00:00Z'),
    actor: 'owner',
    action: 'login',
    target: null,
    before: null,
    after: { ok: true },
    ip: '1.2.3.4',
  };
}

function fakeDb(rows: Row[]) {
  const stub = {
    lastLimit: undefined as number | undefined,
    select: () => stub,
    from: () => stub,
    where: () => stub,
    orderBy: () => stub,
    limit: (n: number) => {
      stub.lastLimit = n;
      return Promise.resolve(rows);
    },
  };
  return stub;
}

describe('AuditController.list', () => {
  it('defaults limit to 50 (queries for 51)', async () => {
    const db = fakeDb([]);
    await new AuditController(db as never).list();
    expect(db.lastLimit).toBe(51);
  });

  it('rejects limit out of 1..100', async () => {
    for (const limit of ['0', '101', 'abc']) {
      const p = new AuditController(fakeDb([]) as never).list(limit);
      await expect(p).rejects.toMatchObject({ response: { code: 'bad_limit' } });
    }
  });

  it('rejects a non-integer before', async () => {
    const p = new AuditController(fakeDb([]) as never).list(undefined, 'abc');
    await expect(p).rejects.toMatchObject({ response: { code: 'bad_before' } });
  });

  it('paginates: returns limit items and nextBefore when more exist', async () => {
    const db = fakeDb([makeRow(3), makeRow(2), makeRow(1)]);
    const res = await new AuditController(db as never).list('2');
    expect(res.items).toHaveLength(2);
    expect(res.nextBefore).toBe(res.items[1]?.id);
  });

  it('returns nextBefore null when no further row exists', async () => {
    const db = fakeDb([makeRow(1)]);
    const res = await new AuditController(db as never).list('2');
    expect(res.items).toHaveLength(1);
    expect(res.nextBefore).toBeNull();
  });

  it('serialises at as an ISO string', async () => {
    const db = fakeDb([makeRow(1)]);
    const res = await new AuditController(db as never).list('1');
    expect(res.items[0]?.at).toBe('2026-02-06T10:00:00.000Z');
  });
});
