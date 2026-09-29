import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ENDPOINTS } from '../src/binance/endpoints.js';
import { hmacHex, type BinanceRestClient } from '../src/binance/rest.client.js';
import { UserDataStream, type StreamHandlers, type WebSocketLike, type WsFactory } from '../src/binance/user-data.stream.js';

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

class FakeWs implements WebSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((msg: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }

  receive(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function makeFactory() {
  const urls: string[] = [];
  const sockets: FakeWs[] = [];
  const factory: WsFactory = (url) => {
    urls.push(url);
    const ws = new FakeWs();
    sockets.push(ws);
    return ws;
  };
  return { urls, sockets, factory };
}

function makeRest() {
  return {
    request: vi.fn(async (_m: string, method: string, path: string) =>
      method === 'POST' && path === '/fapi/v1/listenKey' ? { listenKey: 'lk-1' } : {},
    ),
    serverNow: vi.fn(async () => 1_700_000_000_000),
  } as unknown as BinanceRestClient;
}

const creds = { apiKey: 'test-key', apiSecret: 'test-secret' };

interface Handlers extends StreamHandlers {
  onEvent: Mock<(event: unknown) => void>;
  onConnected: Mock<() => void>;
  onError: Mock<(err: Error) => void>;
}

function makeHandlers(): Handlers {
  return {
    onEvent: vi.fn(),
    onConnected: vi.fn(),
    onError: vi.fn(),
  };
}

describe('UserDataStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('futures: gets a listenKey and connects to /ws/<key>', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { urls, sockets, factory } = makeFactory();
    const stream = new UserDataStream('futures', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    expect(rest.request).toHaveBeenCalledWith('futures', 'POST', '/fapi/v1/listenKey', {}, 'key', 'safe');
    expect(urls[0]).toBe('wss://demo-fstream.binance.com/ws/lk-1');
    sockets[0]!.open();
    expect(handlers.onConnected).toHaveBeenCalledTimes(1);
  });

  it('futures: forwards order and algo events, ignores others', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { sockets, factory } = makeFactory();
    const stream = new UserDataStream('futures', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    sockets[0]!.open();
    sockets[0]!.receive(fixture.futures[1]!);
    expect(handlers.onEvent).toHaveBeenCalledTimes(1);
    const order = handlers.onEvent.mock.calls[0]![0] as { kind: string; status: string };
    expect(order.kind).toBe('order');
    expect(order.status).toBe('FILLED');
    sockets[0]!.receive({ e: 'ACCOUNT_UPDATE', E: 1 });
    expect(handlers.onEvent).toHaveBeenCalledTimes(1);
    const algo = fixture.futures.find((e) => (e as { e?: string }).e === 'ALGO_UPDATE');
    expect(algo).toBeDefined();
    sockets[0]!.receive(algo);
    expect(handlers.onEvent).toHaveBeenCalledTimes(2);
    expect((handlers.onEvent.mock.calls[1]![0] as { kind: string }).kind).toBe('algo');
  });

  it('futures: keepalive every 30 minutes', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { factory } = makeFactory();
    const stream = new UserDataStream('futures', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(rest.request).toHaveBeenCalledTimes(2);
    expect(rest.request).toHaveBeenCalledWith('futures', 'PUT', '/fapi/v1/listenKey', {}, 'key', 'safe');
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(rest.request).toHaveBeenCalledTimes(3);
    expect(rest.request).toHaveBeenNthCalledWith(3, 'futures', 'PUT', '/fapi/v1/listenKey', {}, 'key', 'safe');
  });

  it('futures: listenKeyExpired reconnects with a new key', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { urls, sockets, factory } = makeFactory();
    const stream = new UserDataStream('futures', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    sockets[0]!.receive({ e: 'listenKeyExpired', E: 1 });
    expect(sockets[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rest.request).toHaveBeenCalledTimes(2);
    expect(rest.request).toHaveBeenNthCalledWith(2, 'futures', 'POST', '/fapi/v1/listenKey', {}, 'key', 'safe');
    expect(urls.length).toBe(2);
  });

  it('reconnect back-off doubles and resets after success', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { urls, sockets, factory } = makeFactory();
    const stream = new UserDataStream('futures', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    expect(urls.length).toBe(1);
    sockets[0]!.close();
    await vi.advanceTimersByTimeAsync(999);
    expect(urls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(urls.length).toBe(2);
    sockets[1]!.close();
    await vi.advanceTimersByTimeAsync(1999);
    expect(urls.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(urls.length).toBe(3);
    sockets[2]!.open();
    expect(handlers.onConnected).toHaveBeenCalledTimes(1);
    sockets[2]!.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(urls.length).toBe(4);
  });

  it('stop() prevents reconnects and clears keepalive', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { urls, sockets, factory } = makeFactory();
    const stream = new UserDataStream('futures', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    stream.stop();
    expect(sockets[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(120 * 60 * 1000);
    expect(urls.length).toBe(1);
    expect(rest.request).not.toHaveBeenCalledWith('futures', 'PUT', '/fapi/v1/listenKey', {}, 'key', 'safe');
  });

  it('spot: subscribes with an HMAC signature on open', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { urls, sockets, factory } = makeFactory();
    const stream = new UserDataStream('spot', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    expect(urls[0]).toBe('wss://demo-ws-api.binance.com/ws-api/v3');
    sockets[0]!.open();
    await vi.advanceTimersByTimeAsync(0);
    const sent = JSON.parse(sockets[0]!.sent[0]!) as {
      id: string;
      method: string;
      params: { apiKey: string; timestamp: number; signature: string };
    };
    expect(sent.method).toBe('userDataStream.subscribe.signature');
    expect(sent.id).toBe('subscribe');
    expect(sent.params.apiKey).toBe('test-key');
    expect(sent.params.timestamp).toBe(1_700_000_000_000);
    expect(sent.params.signature).toBe(hmacHex('test-secret', 'apiKey=test-key&timestamp=1700000000000'));
    expect(handlers.onConnected).not.toHaveBeenCalled();
    sockets[0]!.receive({ id: 'subscribe', status: 200, result: { subscriptionId: 0 } });
    expect(handlers.onConnected).toHaveBeenCalledTimes(1);
  });

  it('spot: a failed subscribe closes and reconnects', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { urls, sockets, factory } = makeFactory();
    const stream = new UserDataStream('spot', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    sockets[0]!.open();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.receive({ id: 'subscribe', status: 401, error: { code: -2015, msg: 'Invalid API-key' } });
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(sockets[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(urls.length).toBe(2);
  });

  it('spot: forwards executionReport and listStatus, eventStreamTerminated reconnects', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { sockets, factory } = makeFactory();
    const stream = new UserDataStream('spot', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    sockets[0]!.open();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.receive({ id: 'subscribe', status: 200, result: { subscriptionId: 0 } });
    sockets[0]!.receive(fixture.spot[1]!);
    expect(handlers.onEvent).toHaveBeenCalledTimes(1);
    const order = handlers.onEvent.mock.calls[0]![0] as { kind: string; market: string };
    expect(order.kind).toBe('order');
    expect(order.market).toBe('spot');
    sockets[0]!.receive(fixture.spotOco[0]!);
    expect(handlers.onEvent).toHaveBeenCalledTimes(2);
    expect((handlers.onEvent.mock.calls[1]![0] as { kind: string }).kind).toBe('list');
    sockets[0]!.receive({ subscriptionId: 0, event: { e: 'eventStreamTerminated', E: 1 } });
    expect(sockets[0]!.closed).toBe(true);
  });

  it('a malformed event reports an error and keeps the stream open', async () => {
    const rest = makeRest();
    const handlers = makeHandlers();
    const { sockets, factory } = makeFactory();
    const stream = new UserDataStream('futures', ENDPOINTS.testnet, rest, () => creds, handlers, factory);
    await stream.start();
    sockets[0]!.open();
    const bad = structuredClone(fixture.futures[1]!) as { o: { z: string } };
    bad.o.z = 'abc';
    sockets[0]!.receive(bad);
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onEvent).not.toHaveBeenCalled();
    expect(sockets[0]!.closed).toBe(false);
  });

  it('listenKey failure reports an error and retries', async () => {
    const rest = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('down'))
        .mockImplementation(async (_m: string, method: string, path: string) =>
          method === 'POST' && path === '/fapi/v1/listenKey' ? { listenKey: 'lk-1' } : {},
        ),
      serverNow: vi.fn(async () => 1_700_000_000_000),
    } as unknown as BinanceRestClient;
    const handlers = makeHandlers();
    const { urls, factory: wsFactory } = makeFactory();
    const stream = new UserDataStream('futures', ENDPOINTS.testnet, rest, () => creds, handlers, wsFactory);
    await stream.start();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(urls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(urls.length).toBe(1);
  });
});
