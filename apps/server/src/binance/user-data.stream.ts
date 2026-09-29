import type { BinanceEndpoints, BinanceMarket } from './endpoints.js';
import { hmacHex, type BinanceCredentials, type BinanceRestClient } from './rest.client.js';
import { parseFuturesEvent, parseSpotEvent, type UserDataEvent } from './user-data-events.js';

/** The part of the WHATWG WebSocket this stream uses (Node 22 global `WebSocket`). */
export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((msg: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type WsFactory = (url: string) => WebSocketLike;

export interface StreamHandlers {
  onEvent(event: UserDataEvent): void;
  /** Called after every (re)connect: events may have been missed, so the caller reconciles (B12). */
  onConnected(): void;
  onError(err: Error): void;
}

/** USDⓈ-M listenKeys expire after 60 min without a keepalive. */
const LISTEN_KEY_KEEPALIVE_MS = 30 * 60 * 1000;
const MAX_BACKOFF_MS = 60_000;

/**
 * One user data stream (fills, order and algo updates) for one market.
 * Spot uses the WebSocket API `userDataStream.subscribe.signature` (the REST
 * listenKey is retired); USDⓈ-M uses a listenKey stream kept alive every 30
 * minutes. Any close or expiry reconnects with back-off until `stop()`.
 */
export class UserDataStream {
  private ws: WebSocketLike | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private failures = 0;

  constructor(
    private readonly market: BinanceMarket,
    private readonly endpoints: BinanceEndpoints,
    private readonly rest: BinanceRestClient,
    private readonly credentials: () => BinanceCredentials,
    private readonly handlers: StreamHandlers,
    private readonly wsFactory: WsFactory = (url) => new WebSocket(url) as unknown as WebSocketLike,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearKeepalive();
    this.ws?.close();
    this.ws = null;
  }

  private async connect(): Promise<void> {
    try {
      if (this.market === 'futures') await this.connectFutures();
      else this.connectSpot();
    } catch (err) {
      this.handlers.onError(err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
    }
  }

  private async connectFutures(): Promise<void> {
    const body = (await this.rest.request('futures', 'POST', '/fapi/v1/listenKey', {}, 'key', 'safe')) as { listenKey?: unknown };
    if (typeof body.listenKey !== 'string') throw new Error('Invalid listenKey response');
    const ws = this.open(`${this.endpoints.futuresStream}/ws/${body.listenKey}`);
    ws.onopen = () => {
      this.failures = 0;
      this.handlers.onConnected();
    };
    ws.onmessage = (msg) => {
      const event = this.parse(() => parseFuturesEvent(JSON.parse(String(msg.data))));
      if (event === 'listen_key_expired') ws.close();
      else if (event) this.handlers.onEvent(event);
    };
    this.clearKeepalive();
    this.keepalive = setInterval(() => {
      this.rest.request('futures', 'PUT', '/fapi/v1/listenKey', {}, 'key', 'safe').catch((err: unknown) => {
        this.handlers.onError(err instanceof Error ? err : new Error(String(err)));
      });
    }, LISTEN_KEY_KEEPALIVE_MS);
  }

  private connectSpot(): void {
    const ws = this.open(this.endpoints.spotWsApi);
    ws.onopen = () => {
      this.subscribeSpot(ws).catch((err: unknown) => {
        this.handlers.onError(err instanceof Error ? err : new Error(String(err)));
        ws.close();
      });
    };
    ws.onmessage = (msg) => {
      const data = this.parse(() => JSON.parse(String(msg.data)) as unknown);
      const reply = data as { id?: unknown; status?: unknown } | null;
      if (reply?.id === 'subscribe') {
        if (reply.status === 200) {
          this.failures = 0;
          this.handlers.onConnected();
        } else {
          this.handlers.onError(new Error(`spot user data subscribe failed: status ${String(reply.status)}`));
          ws.close();
        }
        return;
      }
      const event = this.parse(() => parseSpotEvent(data));
      if (event === 'stream_terminated') ws.close();
      else if (event) this.handlers.onEvent(event);
    };
  }

  private async subscribeSpot(ws: WebSocketLike): Promise<void> {
    const { apiKey, apiSecret } = this.credentials();
    const timestamp = await this.rest.serverNow('spot');
    // Signature over the params sorted by name (Binance WebSocket API signing).
    const signature = hmacHex(apiSecret, `apiKey=${apiKey}&timestamp=${timestamp}`);
    ws.send(
      JSON.stringify({ id: 'subscribe', method: 'userDataStream.subscribe.signature', params: { apiKey, timestamp, signature } }),
    );
  }

  private open(url: string): WebSocketLike {
    const ws = this.wsFactory(url);
    this.ws = ws;
    ws.onerror = () => this.handlers.onError(new Error(`${this.market} user data stream error`));
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.clearKeepalive();
      this.scheduleReconnect();
    };
    return ws;
  }

  private parse<T>(fn: () => T): T | null {
    try {
      return fn();
    } catch (err) {
      this.handlers.onError(err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.failures++;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.failures - 1));
    setTimeout(() => {
      if (!this.stopped && !this.ws) void this.connect();
    }, delay);
  }

  private clearKeepalive(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }
}
