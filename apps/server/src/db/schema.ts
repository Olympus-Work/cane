import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Postgres schema (plan step 4). Rules:
 * - money, prices and quantities are `numeric` (read back as strings for decimal.js);
 * - candle times are UTC epoch milliseconds in `bigint`;
 * - wall-clock times are `timestamptz`;
 * - value sets are `text` + CHECK (easier to extend than pg enums);
 * - secrets are stored only as AES-256-GCM blobs (`*_enc`, `bytea`) or hashes.
 */

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const candleTime = (name: string) => bigint(name, { mode: 'number' });

/** SQL `col IN ('a', 'b')` for CHECK constraints. */
function oneOf(col: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
}

export const MARKETS = ['spot', 'futures'] as const;
export const SIDES = ['long', 'short'] as const;
export const TIMEFRAMES = ['4h', '1d', '1w'] as const;
export const STRATEGY_STATUSES = ['disabled', 'enabled', 'needs_attention', 'closed'] as const;
export const SIZING_MODES = ['A', 'B', 'C'] as const;
export const MARGIN_MODES = ['isolated', 'cross'] as const;
export const ENTRY_KINDS = ['primary', 'late', 'flip'] as const;
export const ORDER_PURPOSES = ['entry', 'stop', 'take_profit', 'exit', 'kill_switch', 'reconcile'] as const;
export const ORDER_SIDES = ['BUY', 'SELL'] as const;
export const POSITION_STATUSES = ['open', 'closed'] as const;
export const EXIT_REASONS = ['first_red', 'first_green', 'stop', 'take_profit', 'kill_switch', 'manual', 'liquidated'] as const;
export const NOTIFY_CHANNELS = ['line', 'telegram'] as const;
export const NOTIFY_STATUSES = ['pending', 'sent', 'failed'] as const;

// --- Auth (B14) ---

/** The single owner account (B14.1). `id = 1` enforces one row. */
export const owner = pgTable(
  'owner',
  {
    id: integer('id').primaryKey().default(1),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    totpSecretEnc: bytea('totp_secret_enc'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('owner_single_row', sql`${t.id} = 1`)],
);

/** DB-backed sessions (B14.4). Only a hash of the cookie token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: integer('owner_id').notNull().references(() => owner.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    device: text('device'),
    ip: text('ip'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('sessions_token_hash_uq').on(t.tokenHash)],
);

/** Single-use recovery codes (B14.6), stored as hashes. */
export const recoveryCodes = pgTable('recovery_codes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ownerId: integer('owner_id').notNull().references(() => owner.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// --- Settings (B15, B13, B8.4) ---

/**
 * Key/value settings. Secrets (Binance keys, LINE/Telegram tokens and IDs)
 * go in `value_enc` with a display `hint` (e.g. last 4 characters);
 * plain settings (e.g. Jev timeout) go in `value`. Exactly one is set.
 */
export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value'),
    valueEnc: bytea('value_enc'),
    hint: text('hint'),
    updatedAt: updatedAt(),
  },
  (t) => [check('settings_one_value', sql`(${t.value} is null) <> (${t.valueEnc} is null)`)],
);

// --- Trading (B3–B12) ---

/** Strategies (B10). ID format `S-NN`. */
export const strategies = pgTable(
  'strategies',
  {
    id: text('id').primaryKey(),
    pair: text('pair').notNull(),
    market: text('market', { enum: MARKETS }).notNull(),
    status: text('status', { enum: STRATEGY_STATUSES }).notNull().default('disabled'),
    attentionReason: text('attention_reason'),
    leverage: integer('leverage'),
    sizingMode: text('sizing_mode', { enum: SIZING_MODES }).notNull().default('B'),
    marginMode: text('margin_mode', { enum: MARGIN_MODES }),
    basePct: numeric('base_pct').notNull().default('10'),
    confidenceThreshold: numeric('confidence_threshold').notNull().default('0.70'),
    riskPct: numeric('risk_pct'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('strategies_id_format', sql`${t.id} ~ '^S-[0-9]{2,}$'`),
    check('strategies_pair_usdt', sql`${t.pair} ~ '^[A-Z0-9]+USDT$'`),
    check('strategies_market', oneOf(t.market, MARKETS)),
    check('strategies_status', oneOf(t.status, STRATEGY_STATUSES)),
    check('strategies_sizing_mode', oneOf(t.sizingMode, SIZING_MODES)),
    check('strategies_margin_mode', oneOf(t.marginMode, MARGIN_MODES)),
    // B10.1: futures need leverage 1–20 and a margin mode; spot has neither (mode B, 1x).
    check(
      'strategies_futures_fields',
      sql`(${t.market} = 'futures' and ${t.leverage} between 1 and 20 and ${t.marginMode} is not null)
        or (${t.market} = 'spot' and ${t.leverage} is null and ${t.marginMode} is null and ${t.sizingMode} = 'B')`,
    ),
    check('strategies_base_pct', sql`${t.basePct} between 5 and 20`),
    check('strategies_confidence', sql`${t.confidenceThreshold} between 0 and 1`),
    check('strategies_risk_pct', sql`(${t.sizingMode} = 'C') = (${t.riskPct} is not null) and (${t.riskPct} is null or ${t.riskPct} > 0)`),
    // B10.2: one active strategy per pair (spot and futures BTCUSDT are the same pair).
    uniqueIndex('strategies_one_active_per_pair')
      .on(t.pair)
      .where(sql`${t.status} in ('enabled', 'needs_attention')`),
  ],
);

/**
 * One row per evaluated closed candle (B1.2 idempotency key). `decision`
 * holds the core decision, including an exit (B7.4 records it like an entry).
 */
export const signals = pgTable(
  'signals',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    strategyId: text('strategy_id').notNull().references(() => strategies.id),
    timeframe: text('timeframe', { enum: TIMEFRAMES }).notNull(),
    candleOpenTime: candleTime('candle_open_time').notNull(),
    decision: jsonb('decision').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('signals_timeframe', oneOf(t.timeframe, TIMEFRAMES)),
    uniqueIndex('signals_idempotency_uq').on(t.strategyId, t.timeframe, t.candleOpenTime),
  ],
);

/** Jev request + response or failure per signal (B8.5). `request` holds only B8.1 features, side and timeframe (B8.2). */
export const jevCalls = pgTable(
  'jev_calls',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    strategyId: text('strategy_id').notNull().references(() => strategies.id),
    signalId: bigint('signal_id', { mode: 'number' }).references(() => signals.id),
    side: text('side', { enum: SIDES }).notNull(),
    timeframe: text('timeframe', { enum: TIMEFRAMES }).notNull(),
    model: text('model').notNull(),
    request: jsonb('request').notNull(),
    response: jsonb('response'),
    error: text('error'),
    latencyMs: integer('latency_ms'),
    fallback: boolean('fallback').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('jev_calls_side', oneOf(t.side, SIDES)),
    check('jev_calls_timeframe', oneOf(t.timeframe, TIMEFRAMES)),
  ],
);

/** Positions the system opened. At most one open position per strategy. */
export const positions = pgTable(
  'positions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    strategyId: text('strategy_id').notNull().references(() => strategies.id),
    market: text('market', { enum: MARKETS }).notNull(),
    pair: text('pair').notNull(),
    side: text('side', { enum: SIDES }).notNull(),
    status: text('status', { enum: POSITION_STATUSES }).notNull().default('open'),
    entryKind: text('entry_kind', { enum: ENTRY_KINDS }).notNull(),
    signalTimeframe: text('signal_timeframe', { enum: TIMEFRAMES }).notNull(),
    signalCandleOpenTime: candleTime('signal_candle_open_time').notNull(),
    qty: numeric('qty').notNull(),
    entryPrice: numeric('entry_price').notNull(),
    stopPrice: numeric('stop_price').notNull(),
    takeProfitPrice: numeric('take_profit_price'),
    leverage: integer('leverage'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('positions_market', oneOf(t.market, MARKETS)),
    check('positions_side', oneOf(t.side, SIDES)),
    check('positions_status', oneOf(t.status, POSITION_STATUSES)),
    check('positions_entry_kind', oneOf(t.entryKind, ENTRY_KINDS)),
    check('positions_signal_timeframe', oneOf(t.signalTimeframe, TIMEFRAMES)),
    check('positions_spot_long_only', sql`${t.market} = 'futures' or ${t.side} = 'long'`),
    check('positions_qty_positive', sql`${t.qty} > 0`),
    check('positions_closed_at', sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`),
    uniqueIndex('positions_one_open_per_strategy').on(t.strategyId).where(sql`${t.status} = 'open'`),
  ],
);

/** Orders placed by the system. Binance limits client order IDs to 36 chars. */
export const orders = pgTable(
  'orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    strategyId: text('strategy_id').notNull().references(() => strategies.id),
    signalId: bigint('signal_id', { mode: 'number' }).references(() => signals.id),
    positionId: bigint('position_id', { mode: 'number' }).references(() => positions.id),
    clientOrderId: text('client_order_id').notNull(),
    exchangeOrderId: text('exchange_order_id'),
    market: text('market', { enum: MARKETS }).notNull(),
    pair: text('pair').notNull(),
    side: text('side', { enum: ORDER_SIDES }).notNull(),
    // `type` and `status` are Binance values stored as reported (spot, USDⓈ-M and
    // Algo orders use different sets that Binance extends), so no CHECK.
    type: text('type').notNull(),
    purpose: text('purpose', { enum: ORDER_PURPOSES }).notNull(),
    status: text('status').notNull(),
    qty: numeric('qty').notNull(),
    price: numeric('price'),
    stopPrice: numeric('stop_price'),
    filledQty: numeric('filled_qty').notNull().default('0'),
    avgFillPrice: numeric('avg_fill_price'),
    reduceOnly: boolean('reduce_only').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_client_order_id_uq').on(t.clientOrderId),
    check('orders_client_order_id_format', sql`${t.clientOrderId} ~ '^[.A-Z:/a-z0-9_-]{1,36}$'`),
    check('orders_market', oneOf(t.market, MARKETS)),
    check('orders_side', oneOf(t.side, ORDER_SIDES)),
    check('orders_purpose', oneOf(t.purpose, ORDER_PURPOSES)),
    check('orders_qty_positive', sql`${t.qty} > 0`),
    check('orders_filled_qty', sql`${t.filledQty} >= 0 and ${t.filledQty} <= ${t.qty}`),
    index('orders_strategy_idx').on(t.strategyId),
  ],
);

/** Closed round trips with everything the trade detail shows (B16.5–16.6). */
export const trades = pgTable(
  'trades',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    positionId: bigint('position_id', { mode: 'number' }).notNull().references(() => positions.id),
    strategyId: text('strategy_id').notNull().references(() => strategies.id),
    jevCallId: bigint('jev_call_id', { mode: 'number' }).references(() => jevCalls.id),
    market: text('market', { enum: MARKETS }).notNull(),
    pair: text('pair').notNull(),
    side: text('side', { enum: SIDES }).notNull(),
    entryKind: text('entry_kind', { enum: ENTRY_KINDS }).notNull(),
    signalTimeframe: text('signal_timeframe', { enum: TIMEFRAMES }).notNull(),
    trend1w: text('trend_1w'),
    qty: numeric('qty').notNull(),
    entryPrice: numeric('entry_price').notNull(),
    exitPrice: numeric('exit_price').notNull(),
    exitReason: text('exit_reason', { enum: EXIT_REASONS }).notNull(),
    sizingMode: text('sizing_mode', { enum: SIZING_MODES }).notNull(),
    sizePct: numeric('size_pct').notNull(),
    leverageConfigured: integer('leverage_configured'),
    leverageUsed: integer('leverage_used'),
    jevFallback: boolean('jev_fallback').notNull().default(false),
    grossPnl: numeric('gross_pnl').notNull(),
    fees: numeric('fees').notNull(),
    funding: numeric('funding').notNull().default('0'),
    netPnl: numeric('net_pnl').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('trades_position_uq').on(t.positionId),
    check('trades_market', oneOf(t.market, MARKETS)),
    check('trades_side', oneOf(t.side, SIDES)),
    check('trades_entry_kind', oneOf(t.entryKind, ENTRY_KINDS)),
    check('trades_signal_timeframe', oneOf(t.signalTimeframe, TIMEFRAMES)),
    check('trades_exit_reason', oneOf(t.exitReason, EXIT_REASONS)),
    check('trades_sizing_mode', oneOf(t.sizingMode, SIZING_MODES)),
    index('trades_closed_at_idx').on(t.closedAt),
  ],
);

// --- Notifications (B13) and audit ---

/** Outbox of notification messages. `message` is already redacted (B13.3). */
export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    event: text('event').notNull(),
    channel: text('channel', { enum: NOTIFY_CHANNELS }).notNull(),
    message: text('message').notNull(),
    status: text('status', { enum: NOTIFY_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    check('notifications_channel', oneOf(t.channel, NOTIFY_CHANNELS)),
    check('notifications_status', oneOf(t.status, NOTIFY_STATUSES)),
    index('notifications_pending_idx').on(t.status).where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Append-only audit log (spec Data, Interfaces). UPDATE, DELETE and TRUNCATE
 * are blocked by a trigger and not granted to the app role (see the roles
 * migration). `before` / `after` are stored with secrets already redacted.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    target: text('target'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
);

// --- Market data ---

/** Closed-candle cache (public data). Spot and futures klines differ, so market is part of the key. */
export const candles = pgTable(
  'candles',
  {
    market: text('market', { enum: MARKETS }).notNull(),
    pair: text('pair').notNull(),
    timeframe: text('timeframe', { enum: TIMEFRAMES }).notNull(),
    openTime: candleTime('open_time').notNull(),
    closeTime: candleTime('close_time').notNull(),
    open: numeric('open').notNull(),
    high: numeric('high').notNull(),
    low: numeric('low').notNull(),
    close: numeric('close').notNull(),
    volume: numeric('volume').notNull(),
  },
  (t) => [
    primaryKey({ name: 'candles_pk', columns: [t.market, t.pair, t.timeframe, t.openTime] }),
    check('candles_market', oneOf(t.market, MARKETS)),
    check('candles_timeframe', oneOf(t.timeframe, TIMEFRAMES)),
    check('candles_times', sql`${t.closeTime} > ${t.openTime}`),
  ],
);
