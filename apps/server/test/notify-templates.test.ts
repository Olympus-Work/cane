import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { NotifyEvent } from '../src/engine/ports.js';
import { renderMessage, scrub } from '../src/notify/templates.js';

describe('notify templates', () => {
  it('renders entry_filled with strategy id in whitelist order', () => {
    const out = renderMessage(
      'entry_filled',
      'S-01',
      {
        pair: 'BTCUSDT',
        side: 'long',
        kind: 'new',
        qty: '0.012',
        price: '65000.5',
        stop: '63000',
        takeProfit: null,
        sizePct: 10,
        factors: 2,
        leverage: 5,
      },
    );
    expect(out).toBe(
      [
        '[Entry filled] S-01',
        'pair: BTCUSDT',
        'side: long',
        'kind: new',
        'qty: 0.012',
        'price: 65000.5',
        'stop: 63000',
        'sizePct: 10',
        'leverage: 5',
        'factors: 2',
      ].join('\n'),
    );
  });

  it('renders exit_filled without strategy id (no trailing space)', () => {
    const out = renderMessage(
      'exit_filled',
      null,
      {
        pair: 'ETHUSDT',
        side: 'short',
        reason: 'first_green',
        qty: '1.5',
        entry: '3000',
        exit: '2900',
        grossPnl: '150',
        fees: '2.1',
        funding: '-0.4',
        netPnl: '147.5',
      },
    );
    expect(out).toBe(
      [
        '[Exit filled]',
        'pair: ETHUSDT',
        'side: short',
        'reason: first_green',
        'qty: 1.5',
        'entry: 3000',
        'exit: 2900',
        'grossPnl: 150',
        'fees: 2.1',
        'funding: -0.4',
        'netPnl: 147.5',
      ].join('\n'),
    );
  });

  it('renders system_started with env', () => {
    expect(renderMessage('system_started', null, { env: 'testnet' })).toBe('[System started]\nenv: testnet');
  });

  it('drops unknown fields', () => {
    const out = renderMessage('order_rejected', null, {
      pair: 'BTCUSDT',
      apiKey: 'abc',
      apiSecret: 'def',
      token: 'xyz',
      accountId: '123456789',
      email: 'owner@example.com',
      password: 'hunter2',
    });
    expect(out).toContain('pair: BTCUSDT');
    for (const forbidden of [
      'apiKey',
      'apiSecret',
      'token',
      'accountId',
      'email',
      'password',
      'owner@example.com',
      'hunter2',
      'abc',
      'def',
      'xyz',
      '123456789',
    ]) {
      expect(out).not.toContain(forbidden);
    }
  });

  it('redacts token-like runs of 32+ characters, not 31', () => {
    const out = renderMessage('order_rejected', null, { reason: `auth failed for key ${'A'.repeat(64)}` });
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('AAAA');

    expect(scrub('A'.repeat(31))).toBe('A'.repeat(31));
    expect(scrub('A'.repeat(32))).toBe('[redacted]');
  });

  it('redacts LINE-style user IDs and sha256-looking hashes', () => {
    const lineId = `U${'0123456789abcdef'.repeat(2)}`;
    expect(lineId).toHaveLength(33);
    const out = renderMessage('order_rejected', null, { reason: `sent to ${lineId}` });
    expect(out).toContain('[redacted]');
    expect(out).not.toContain(lineId);

    const hash = 'a'.repeat(64);
    const out2 = renderMessage('settings_changed', null, { what: `updated ${hash}` });
    expect(out2).toContain('[redacted]');
    expect(out2).not.toContain(hash);
  });

  it('truncates long text to 200 characters ending in ...', () => {
    const out = renderMessage('order_rejected', null, { reason: 'x '.repeat(200) });
    const value = out.split('\n')[1]!.slice('reason: '.length);
    expect(value).toHaveLength(200);
    expect(value.endsWith('...')).toBe(true);
  });

  it('redacts before truncating so no token fragment survives', () => {
    const out = renderMessage('order_rejected', null, { reason: `${'B'.repeat(150)} ${'C'.repeat(100)}` });
    expect(out).toContain('[redacted]');
    expect(out).not.toMatch(/B{32,}/);
    expect(out).not.toMatch(/C{32,}/);
  });

  it('renders a non-empty [TITLE] first line for every NotifyEvent', () => {
    const all = {
      entry_filled: true,
      exit_filled: true,
      stop_triggered: true,
      tp_triggered: true,
      jev_fallback: true,
      order_rejected: true,
      order_skipped_min_notional: true,
      sizing_reduced: true,
      leverage_lowered: true,
      reconcile_mismatch: true,
      flip_to_short: true,
      flip_to_long: true,
      system_started: true,
      login_failed_lockout: true,
      login_success: true,
      settings_changed: true,
      kill_switch: true,
      replay_diff: true,
    } satisfies Record<NotifyEvent, true>;
    const events = Object.keys(all) as NotifyEvent[];
    expect(events).toHaveLength(18);
    for (const event of events) {
      const out = renderMessage(event, null, {});
      const first = out.split('\n')[0]!;
      expect(first.startsWith('[')).toBe(true);
      expect(first.length).toBeGreaterThan(1);
    }
  });

  it('renders the daily replay-diff summary (plan S13)', () => {
    const out = renderMessage('replay_diff', 'S-01', { day: '2026-10-09', what: 'BTCUSDT futures: 6/6 match' });
    expect(out).toBe('[Live vs replay check] S-01\nday: 2026-10-09\nwhat: BTCUSDT futures: 6/6 match');
  });

  it('renders booleans and numbers in whitelist order', () => {
    const out = renderMessage('login_failed_lockout', null, { minutes: 15, reason: true });
    expect(out).toBe('[Login locked after failed attempts]\nreason: true\nminutes: 15');
  });

  it('never contains the words undefined or null', () => {
    const outputs = [
      renderMessage('entry_filled', 'S-01', {
        pair: 'BTCUSDT',
        side: 'long',
        kind: 'new',
        qty: '0.012',
        price: '65000.5',
        stop: '63000',
        takeProfit: null,
        sizePct: 10,
        factors: 2,
        leverage: 5,
      }),
      renderMessage('exit_filled', null, {
        pair: 'ETHUSDT',
        side: 'short',
        reason: 'first_green',
        qty: '1.5',
        entry: '3000',
        exit: '2900',
        grossPnl: '150',
        fees: '2.1',
        funding: '-0.4',
        netPnl: '147.5',
      }),
      renderMessage('system_started', null, { env: 'testnet' }),
    ];
    for (const out of outputs) {
      expect(out).not.toContain('undefined');
      expect(out).not.toContain('null');
    }
  });
});
