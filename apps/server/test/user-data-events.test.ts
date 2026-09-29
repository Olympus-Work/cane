import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  parseFuturesEvent,
  parseSpotEvent,
} from '../src/binance/user-data-events.js';
import type { AlgoEvent, ListEvent, OrderEvent } from '../src/binance/user-data-events.js';

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/binance/user-data-events.json', import.meta.url)),
    'utf8',
  ),
) as {
  futures: unknown[];
  spot: unknown[];
  spotOco: unknown[];
};

function asOrder(event: unknown): OrderEvent {
  expect(event).not.toBeNull();
  expect(event).not.toBe('listen_key_expired');
  expect(event).not.toBe('stream_terminated');
  expect((event as { kind: string }).kind).toBe('order');
  return event as OrderEvent;
}

describe('parseFuturesEvent', () => {
  it('parses an ORDER_TRADE_UPDATE NEW ack', () => {
    const event = asOrder(parseFuturesEvent(fixture.futures[0]));
    expect(event.market).toBe('futures');
    expect(event.symbol).toBe('BTCUSDT');
    expect(event.status).toBe('NEW');
    expect(event.clientId).toBe('ev-1790668977859-entry');
    expect(event.clientId.endsWith('-entry')).toBe(true);
    expect(event.orderType).toBe('MARKET');
    expect(event.side).toBe('BUY');
    expect(event.exchangeId).toBe('28608514096');
    expect(event.executedQty.toString()).toBe('0');
    expect(event.fee).toBeNull();
    expect(event.realizedPnl).not.toBeNull();
    expect(event.realizedPnl!.toString()).toBe('0');
    expect(event.eventTime).toBe(1790668978050);
  });

  it('parses an ORDER_TRADE_UPDATE FILLED trade', () => {
    const event = asOrder(parseFuturesEvent(fixture.futures[1]));
    expect(event.status).toBe('FILLED');
    expect(event.executedQty.toString()).toBe('0.002');
    expect(event.lastFillQty.toString()).toBe('0.002');
    expect(event.lastFillPrice.toString()).toBe('83986.4');
    expect(event.fee).not.toBeNull();
    expect(event.fee!.asset).toBe('USDT');
    expect(event.fee!.amount.toString()).toBe('0.06718912');
    expect(event.side).toBe('BUY');
    expect(event.exchangeId).toBe('28608514096');
  });

  it('parses ALGO_UPDATE events', () => {
    const first = parseFuturesEvent(fixture.futures[2]);
    expect(first).not.toBeNull();
    expect(first).not.toBe('listen_key_expired');
    expect(first).not.toBe('stream_terminated');
    expect((first as AlgoEvent).kind).toBe('algo');
    const algo = first as AlgoEvent;
    expect(algo.market).toBe('futures');
    expect(algo.symbol).toBe('BTCUSDT');
    expect(algo.status).toBe('NEW');
    expect(algo.orderType).toBe('STOP_MARKET');
    expect(algo.triggerPrice.toString()).toBe('58816');
    expect(algo.clientId).toBe('ev-1790668977859-stop');
    expect(algo.clientId.endsWith('-stop')).toBe(true);
    expect(algo.exchangeId).toBe('1000000222553171');

    const later = parseFuturesEvent(fixture.futures[5]);
    expect((later as AlgoEvent).kind).toBe('algo');
    expect((later as AlgoEvent).status).toBe('CANCELED');
  });

  it('parses the exit fill with realized PnL', () => {
    const event = asOrder(parseFuturesEvent(fixture.futures[4]));
    expect(event.clientId).toBe('ev-1790668977859-exit');
    expect(event.clientId.endsWith('-exit')).toBe(true);
    expect(event.status).toBe('FILLED');
    expect(event.side).toBe('SELL');
    expect(event.realizedPnl).not.toBeNull();
    expect(event.realizedPnl!.toString()).toBe('-0.0722');
  });

  it('returns null for other event types and the sentinel for listenKeyExpired', () => {
    expect(parseFuturesEvent({ e: 'ACCOUNT_UPDATE' })).toBeNull();
    expect(parseFuturesEvent({ e: 'listenKeyExpired', E: 1 })).toBe('listen_key_expired');
  });

  it('throws on invalid decimal or side fields', () => {
    const badQty = structuredClone(fixture.futures[1]);
    (badQty as { o: Record<string, unknown> }).o.z = 'abc';
    expect(() => parseFuturesEvent(badQty)).toThrow('Invalid ORDER_TRADE_UPDATE field z');

    const badSide = structuredClone(fixture.futures[1]);
    (badSide as { o: Record<string, unknown> }).o.S = 'HOLD';
    expect(() => parseFuturesEvent(badSide)).toThrow('Invalid ORDER_TRADE_UPDATE field S');
  });
});

describe('parseSpotEvent', () => {
  it('parses an executionReport NEW ack', () => {
    const event = asOrder(parseSpotEvent(fixture.spot[0]));
    expect(event.market).toBe('spot');
    expect(event.status).toBe('NEW');
    expect(event.symbol).toBe('BTCUSDT');
    expect(event.clientId).toBe('ev-1790668977859-sentry');
    expect(event.exchangeId).toBe('68754212388');
    expect(event.fee).toBeNull();
    expect(event.realizedPnl).toBeNull();
  });

  it('parses an executionReport FILLED trade', () => {
    const event = asOrder(parseSpotEvent(fixture.spot[1]));
    expect(event.market).toBe('spot');
    expect(event.status).toBe('FILLED');
    expect(event.executedQty.toString()).toBe('0.0002');
    expect(event.lastFillPrice.toString()).toBe('84081.19');
    expect(event.fee).not.toBeNull();
    expect(event.fee!.asset).toBe('BTC');
    // toString() would render 0.0000002 in scientific notation, so compare values.
    expect(event.fee!.amount.equals(new Decimal('0.0000002'))).toBe(true);
    expect(event.realizedPnl).toBeNull();
  });

  it('parses OCO listStatus frames and leg reports', () => {
    const first = parseSpotEvent(fixture.spotOco[0]);
    expect(first).not.toBeNull();
    expect(first).not.toBe('stream_terminated');
    expect((first as ListEvent).kind).toBe('list');
    const list = first as ListEvent;
    expect(list.market).toBe('spot');
    expect(list.status).toBe('EXECUTING');
    expect(list.clientId).toBe('ev-1790669035013-oco');
    expect(list.exchangeId).toBe('4114945');
    expect(list.legClientIds).toHaveLength(2);
    expect(list.legClientIds[0]).toBe('ev-1790669035013-stop');
    expect(list.legClientIds[1]).toBe('ev-1790669035013-tp');

    const done = parseSpotEvent(fixture.spotOco[3]);
    expect((done as ListEvent).kind).toBe('list');
    expect((done as ListEvent).status).toBe('ALL_DONE');

    const legStop = asOrder(parseSpotEvent(fixture.spotOco[1]));
    expect(legStop.clientId).toBe('ev-1790669035013-stop');
    expect(legStop.status).toBe('NEW');
    const legTp = asOrder(parseSpotEvent(fixture.spotOco[2]));
    expect(legTp.clientId).toBe('ev-1790669035013-tp');
    expect(legTp.status).toBe('NEW');
  });

  it('returns null for request responses and other events, the sentinel for termination', () => {
    expect(parseSpotEvent({ id: 's', status: 200, result: { subscriptionId: 0 } })).toBeNull();
    expect(
      parseSpotEvent({ subscriptionId: 0, event: { e: 'outboundAccountPosition' } }),
    ).toBeNull();
    expect(
      parseSpotEvent({ subscriptionId: 0, event: { e: 'eventStreamTerminated', E: 1 } }),
    ).toBe('stream_terminated');
  });
});
