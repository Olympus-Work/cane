import { describe, expect, it } from 'vitest';
import { CLIENT_ORDER_ID_RE, ORDER_ACTIONS, clientOrderId, type OrderAction } from '../src/orders/client-order-id.js';

describe('clientOrderId', () => {
  it('builds the deterministic id <strategy_id>-<candle_open_time>-<action>', () => {
    expect(clientOrderId('S-01', 1727740800000, 'entry')).toBe('S-01-1727740800000-entry');
  });

  it('is deterministic and distinguishes action and candle time', () => {
    expect(clientOrderId('S-01', 1727740800000, 'entry')).toBe(clientOrderId('S-01', 1727740800000, 'entry'));
    expect(clientOrderId('S-01', 1727740800000, 'entry')).not.toBe(clientOrderId('S-01', 1727740800000, 'stop'));
    expect(clientOrderId('S-01', 1727740800000, 'entry')).not.toBe(clientOrderId('S-01', 1727740800001, 'entry'));
  });

  it.each(ORDER_ACTIONS)(
    'every action %s with a year-2100 candle matches the Binance regex and stays <= 36 chars',
    (action) => {
      const id = clientOrderId('S-999', 4102444800000, action);
      expect(id).toMatch(CLIENT_ORDER_ID_RE);
      expect(id.length).toBeLessThanOrEqual(36);
    },
  );

  it.each([
    ['S-1', 'one-digit strategy number'],
    ['s-01', 'lowercase prefix'],
    ['X-01', 'wrong prefix'],
    ['', 'empty strategy id'],
  ])('throws for strategy %s (%s)', (strategyId) => {
    expect(() => clientOrderId(strategyId, 1727740800000, 'entry')).toThrow();
  });

  it.each([
    [-1, 'negative'],
    [1.5, 'fractional'],
    [Number.NaN, 'NaN'],
    [Number.MAX_SAFE_INTEGER + 1, 'above safe integer'],
  ])('throws for candle time %s (%s)', (candleOpenTime) => {
    expect(() => clientOrderId('S-01', candleOpenTime, 'entry')).toThrow();
  });

  it("throws for an action that is not in ORDER_ACTIONS", () => {
    expect(() => clientOrderId('S-01', 1727740800000, 'buy' as OrderAction)).toThrow();
  });

  it('throws /too long/ when the id exceeds 36 characters', () => {
    expect(() => clientOrderId('S-' + '1'.repeat(20), 1727740800000, 'entry')).toThrow(/too long/);
  });
});

describe('CLIENT_ORDER_ID_RE', () => {
  it('rejects ids that are too long or contain invalid characters', () => {
    expect('a'.repeat(37)).not.toMatch(CLIENT_ORDER_ID_RE);
    expect('has space').not.toMatch(CLIENT_ORDER_ID_RE);
    expect('bad#char').not.toMatch(CLIENT_ORDER_ID_RE);
  });

  it('accepts a well-formed id', () => {
    expect('S-01-1727740800000-entry').toMatch(CLIENT_ORDER_ID_RE);
  });
});
