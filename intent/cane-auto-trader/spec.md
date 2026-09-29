# Spec: CDC auto-trader on Binance (spot + futures) driven by Jev
From: intent/cane-auto-trader/intent.md (approved 2026-09-25, amendment 1 2026-09-28).
Status: approved. Approved by: Zong (owner), 2026-09-28 (rev 5).
UI: design_handoff_cane_auto_trader/README.md + design.md (Claude Design
prototype, round 2 2026-09-28). Visual detail lives there; behaviour here.
Revision 2 (2026-09-27): aligned with the design handoff.
Revision 3 (2026-09-28): design round 2 reviewed; no behaviour change.
Revision 4 (2026-09-28): owner answered the 3 open questions (B10.1, B15.3,
B16.8).
Revision 5 (2026-09-28): IP restriction dropped (Railway Hobby, no static
outbound IP); intent amendment 1.
Revision 5.1 (2026-09-28, owner decision): E10 wording fixed; AC1–2 no
longer use a TradingView export (owner: skip, trade live directly).
Revision 5.2 (2026-09-29, owner decision in the S03 PR review): B8.1
feature details completed (the "lookbacks and thresholds" sentence was cut
off); B7.5 "with realised profit" means net PnL > 0. No other change.
Author: Claude (drafted for owner review). Approver: Zong (owner).

Defaults below were confirmed by the owner on 2026-09-25. Numeric defaults are configurable unless stated otherwise.

## Scope
In:
- Signal engine: CDC Action Zone + CDC ATR trailing stop on 1W / 1D / 4H,
  evaluated on closed candles only.
- Confluence feature extraction (code) + factor classification (Jev).
- Position sizing modes A / B / C, leverage auto-lowering, margin mode.
- Order execution on Binance Spot (long) and USDⓈ-M Futures (long/short),
  with exchange-side protective stops.
- Reconciliation with the exchange on start-up and periodically.
- Web app: login (email + password + TOTP), Dashboard, Strategies, Kill
  switch, Settings (Binance keys, LINE, Telegram).
- Notifications to LINE (Messaging API) and Telegram.
- Audit log.
- Offline replay command: runs the signal + sizing rules over historical
  candles and outputs the decisions it would have made (used as proof that
  live == replay).

Out:
- Automatic drawdown halt (owner decision).
- Multi-user, sign-up, email password reset.
- COIN-M futures, hedge (dual-side) position mode, non-USDT quote pairs.
- Transfers between spot and futures wallets.
- Manual order entry from the UI.
- Backtest optimisation / parameter search.
- Playbook sections 5 (mindset) and 6 (price targets / wave forecasts).

## Definitions
- **Pair**: a Binance symbol string, e.g. `BTCUSDT`. Spot `BTCUSDT` and
  futures `BTCUSDT` are the same pair.
- **Closed candle**: a kline whose close time is in the past, as reported by
  Binance. Candle times are UTC (1D closes 00:00 UTC = 07:00 Asia/Bangkok;
  1W closes Monday 00:00 UTC).
- **CDC Action Zone** (per timeframe, on close, no smoothing):
  `fast = EMA(close, 12)`, `slow = EMA(close, 26)`.
  `Bull = fast > slow`, `Bear = fast < slow`.
  `Green = Bull and close > fast`. `Red = Bear and close < fast`.
  `buyCond = Green and not Green[prev]`; `sellCond = Red and not Red[prev]`.
  **Regime** = `bullish` if the most recent `buyCond` is newer than the most
  recent `sellCond`, `bearish` if the reverse.
  **First green** = `buyCond` on a bar whose previous bar's regime was
  bearish. **First red** = `sellCond` on a bar whose previous regime was
  bullish.
- **CDC ATR trailing stop** (slow trail; ATR = Wilder ATR on close):
  `k = 2`, `n = 10`. With `t` = previous trail value:
  if `close > t` and `close[prev] > t` → `trail = max(t, close − k·ATR(n))`;
  if `close < t` and `close[prev] < t` → `trail = min(t, close + k·ATR(n))`;
  otherwise → `close − k·ATR(n)` if `close > t`, else `close + k·ATR(n)`.
- **R** (risk per unit) = `|entry price − stop price|`.

## Behavior

### B1 Signal evaluation
1. The engine evaluates each enabled strategy only after a candle of the
   relevant timeframe has closed, using closed candles only. A still-open
   candle never produces a signal.
2. Evaluation for a closed candle happens at most once per strategy per
   timeframe per candle (idempotent on `strategy_id + timeframe + candle_open_time`).
3. Warm-up: a timeframe is usable only when at least 200 closed candles are
   available; otherwise the strategy shows
   `warming_up` and places no orders.

### B2 Trend filter (1W)
1. Long entries are allowed only when the 1W regime (last closed 1W candle)
   is `bullish`. Short entries are allowed only when it is `bearish`.
2. The 1W filter gates entries only; it never forces an exit.

### B3 Primary entry (1D)
Given an enabled strategy with no open position on its pair:
1. **Long** (spot or futures): when the last closed 1D candle is a first
   green and B2 allows longs → size per B6 and open a long at market.
2. **Short** (futures only): when the last closed 1D candle is a first red
   and B2 allows shorts → size per B6 and open a short at market.
3. A spot strategy ignores first-red entry signals.
4. Immediately after the entry fill, place the protective stop per B5.

### B4 Late entry (4H fallback) — the Cane Rule
1. If the 1D regime already favours a direction but its first green/red
   bar is not the last closed 1D candle (strategy enabled mid-trend, or
   the signal was missed), the system does **not** enter on 1D.
2. Instead it waits for a first green (long) / first red (short) on a
   closed 4H candle while the 1D regime and the 1W filter still agree.
3. At that 4H signal: stop = 4H CDC ATR trail; if the trail is on the wrong
   side of price, stop = `close ∓ 2·ATR(10)` on 4H. Take-profit = entry ±
   2R. Entry is placed only if both orders can be placed.
4. Late entries use base size only, with no confluence bonus
  .
5. A late-entry position is closed at whichever comes first: take-profit,
   stop, or the 1D exit signal (B7).

### B5 Protective stop (every position)
1. Every open position has an exchange-side stop order at all times
   (spot: stop-loss sell for the strategy's quantity; futures: reduce-only
   stop-market).
2. Primary entries: initial stop = 1D CDC ATR trail at the signal candle.
   If the trail is on the wrong side of price, initial stop =
   `close − 2·ATR(10)` (long) / `close + 2·ATR(10)` (short) on 1D.
3. After each closed 1D candle the stop is moved to the new trail value,
   only in the position's favour (never widened).
4. Futures: the new stop is placed before the old one is cancelled. Spot
   (balance locked by the old stop): the old stop is cancelled and the new
   one placed immediately; if placing fails, retry per E3 and alert.

### B6 Sizing
1. Jev classifies three factors for the signal candle (B8). A factor is
   *present* if Jev returns `present = true` with `confidence ≥ 0.70`.
2. `size_pct = base_pct + 20 × present_factors`, capped at 100.
   `base_pct` default = 10 (allowed range 5–20).
3. Equity: spot = total spot wallet value in USDT; futures = USDⓈ-M wallet
   margin balance in USDT. Both read from Binance at sizing time.
4. Mode **B** (default): notional = `size_pct% × equity`;
   margin used = notional / leverage.
   Mode **A**: margin = `size_pct% × equity`; notional = margin × leverage.
   Mode **C**: `risk_pct` is an input when the strategy is created and means
   the risk at full confluence (size_pct = 100). Effective risk =
   `risk_pct × size_pct / 100` (e.g. risk_pct 2%, base only 10% → 0.2%;
   all three factors → 2%).
   notional = `(effective_risk% × equity) / R × entry price`.
   Spot uses mode B semantics with leverage = 1.
5. If free balance is below the required amount, size is reduced to the
   free balance and a `sizing_reduced` notification is sent
  .
6. Quantity is rounded **down** to the symbol's step size; prices to its
   tick size. If the result is below the symbol's minimum notional, no
   order is placed and `order_skipped_min_notional` is notified.

### B7 Exit
1. Long: close the full position on the first red of the closed 1D candle,
   or when the stop / take-profit fills.
2. Short: close the full position on the first green of the closed 1D
   candle, or when the stop / take-profit fills.
3. On exit, all remaining orders of that position are cancelled.
4. After an exit, the next entry on that pair needs a new signal (B3/B4),
   except the flip in B7.5.
5. **Flip (futures strategies only, both directions).** When a position is
   closed by the opposite 1D signal **with realised profit** (after fees and
   funding) — a long closed by a first red, or a short closed by a first
   green — the system evaluates the opposite position on the same candle
   instead of treating the signal as automatically valid ("แดงหลอก / เขียวหลอก"
   — false signal — check):
   - Jev classifies the opposite side's factors (B8) on that candle;
   - the new position opens only if at least 2 of those factors are present;
   - the 1W filter (B2) does not apply to a flip, because right after a
     position closes the 1W regime usually still favours the old direction;
   - size per B6; stop per B5; notified as `flip_to_short` / `flip_to_long`.
   No flip if the position closed at a loss, by stop or take-profit, or on
   a spot strategy, or if Jev fails.
   The exit itself still happens immediately on the signal (per playbook);
   the false-signal check only decides whether to open the opposite side.

### B8 Jev classification
1. Code computes features from the 1D candles up to and including the
   signal candle (long side; short side mirrored):
   - **Channel breakout**: pivot highs (5 bars left / 5 right) in the last
     60 bars; least-squares line through all of them (at least 3); slope
     (% of the mean pivot price per bar); touch count (pivots within 1% of
     the line); % that close is above the line.
   - **Capitulation**: within the 10 bars before the signal: longest run of
     bearish candles with body ≥ 1.5 × ATR(14) (ATR at that bar); count of
     gap-downs (open < previous low); max volume of those 10 bars ÷ average
     volume of the 20 bars before them.
   - **Higher low**: last two pivot lows (5/5) within 120 bars; % change.
   - Short mirrors: ascending-channel breakdown; euphoria (bullish big
     bodies, gap-ups, volume spike); lower high.
   A pivot is strictly higher (lower) than the 5 bars on each side and
   counts only once 5 bars after it have closed, up to the signal candle.
   Lookbacks and thresholds above are fixed in code (owner, 2026-09-29).
2. Jev receives only these market-derived features plus side and
   timeframe — never balances, keys, account IDs or order data.
3. Jev returns, per factor: `present: bool`, `confidence: 0..1`.
4. If Jev returns an error, an invalid shape, or no answer within 3 s
  : all factors = not present (base size), entry
   proceeds, `jev_fallback` is notified and recorded on the trade. The
   timeout is a setting in Settings (default 3 s).
5. The request, response (or failure), and resulting size are stored with
   the trade and shown on the Dashboard.

### B9 Leverage and margin mode (futures)
1. Before a strategy's first order, the system sets the symbol's margin
   mode (default isolated) and leverage on Binance, and verifies them.
2. Before each entry, the system computes the expected liquidation price.
   If the stop is not closer to entry than the liquidation price by at
   least 1% of entry price, leverage is lowered one
   step at a time (configured leverage is the ceiling, floor 1x) until it
   is; if even 1x fails the check, the entry is skipped and notified.
3. In mode B, lowering leverage does not change notional, only margin used.
4. Margin mode and leverage edits on a strategy with an open position are
   rejected (Binance does not allow margin-mode change with open
   positions/orders) and take effect on the next entry.

### B10 Strategies
1. Create: pair, market (spot / futures, form default futures), and for
   futures: leverage (1–20, default 5; 20x is a
   hard maximum even where Binance allows more), sizing mode
   (default B), margin mode (default isolated), `base_pct` (5–20, default
   10), confidence threshold (0–1, default 0.70), `risk_pct` (mode C only,
   default 2). New strategies start `disabled` and get an ID `S-NN`.
   The form shows a live sizing preview (base only / 2 factors / 3 factors)
   from current equity.
2. Only one enabled strategy per pair. Enabling a second one on the same
   pair is rejected with a message naming the existing strategy.
3. Enable requires a fresh TOTP code. On enable, B1 warm-up and B4 apply.
4. Disable: no new entries; the open position stays and keeps being
   managed (stop, exit).
5. Close: cancel the strategy's orders, market-close its position, mark it
   `closed`. History is kept.
7. Editing a strategy with an open position: pair, market, leverage and
   margin mode are locked (shown with the reason); other fields apply to
   the next entry.
8. The list shows per strategy: current price and 24h change, state (with
   the reason when `needs_attention`, e.g. "Order rejected: insufficient
   margin"), position summary, 30-day realised PnL (daily series +
   total), sizing mode, leverage ceiling and leverage in use, margin mode.
6. Only USDT-quoted pairs that are listed on the selected market can be
   chosen.

### B11 Kill switch
1. One click + one confirmation while logged in (no TOTP).
2. Effect: disable all strategies, cancel all orders the system placed,
   market-close all system-managed positions (spot: sell only the
   quantity the strategy holds; futures: reduce-only close).
3. Positions or balances not opened by the system are not touched.
4. Sends `kill_switch` notification with the result per pair; failures are
   retried per E3 and listed on the Dashboard until resolved.
5. Trading stays off until strategies are re-enabled one by one (each with
   TOTP). A "Trading stopped" banner shows on every page and the status is
   `stopped_by_kill_switch` until the first strategy is re-enabled.
6. The kill switch is reachable from every page (header on desktop, sticky
   bottom bar on mobile).

### B12 Reconciliation
1. On start-up and every 5 minutes, the system
   compares its recorded positions and open orders with Binance.
2. The exchange is the source of truth. On mismatch for a pair (missing
   stop, unknown position, quantity differs): the strategy is marked
   `needs_attention`, no new entries are placed on that pair, a missing
   stop is re-placed for the quantity actually held, and
   `reconcile_mismatch` is notified.
3. Positions opened manually by the owner on a pair with an enabled
   strategy count as a mismatch (B12.2).

### B13 Notifications
1. Events: `entry_filled`, `exit_filled` (with PnL incl. fees/funding),
   `stop_triggered`, `tp_triggered`, `jev_fallback`, `order_rejected`,
   `order_skipped_min_notional`, `sizing_reduced`, `leverage_lowered`,
   `reconcile_mismatch`, `flip_to_short`, `flip_to_long`, `kill_switch`, `login_failed_lockout`,
   `login_success`, `settings_changed`, `system_started`.
2. Each event goes to every configured channel (LINE Messaging API push,
   Telegram bot). A failed channel is retried; it never blocks trading.
3. Messages never contain keys, tokens, TOTP data or full account IDs.
4. Settings has a "send test message" per channel.

### B14 Auth and session
1. Single owner account created by a CLI / env seed; no sign-up route.
2. Login = email + password + TOTP; all three required.
3. 5 failed attempts → locked for 15 minutes, with a
   `login_failed_lockout` notification.
4. Session expires after 30 minutes idle and 12 hours absolute.
   Cookies: HttpOnly, Secure, SameSite=Strict. Settings → Security shows the
   active session (device, IP, signed-in time, expiry) with Sign out.
5. Fresh TOTP required for: changing Binance keys, changing notification
   targets, enabling a strategy, re-setting up TOTP, regenerating recovery
   codes. Changing the password requires the current password.
6. 10 single-use recovery codes are shown once at TOTP setup. Password and TOTP reset only via Railway CLI command.

### B15 Settings: Binance keys
1. Keys are entered in Settings, encrypted before storage with a key from
   the Railway environment, and never returned to the browser (shown as
   last 4 characters).
2. On save, the system checks the key's permissions via Binance and
   rejects a key that has withdrawal permission enabled or lacks the
   needed trading permission, with a clear message.
3. No IP restriction is required or checked (Railway Hobby has no static
   outbound IP; intent amendment 1). Owner verified 2026-09-28: an
   unrestricted HMAC key can enable Futures and Spot & Margin trading. The B15.2 check
   (trading permission present for each market used) catches an unusable
   key. Accepted risk: a leaked key can trade from anywhere; withdrawals and
   universal transfer stay disabled.

### B16 Dashboard
1. Status: `running` / `stopped_by_kill_switch` / `exchange_unreachable`,
   and last sync time.
2. Stat cards: spot equity, futures equity, today's realised PnL, total
   realised PnL (+ trade count), open positions (spot / futures count).
3. Alerts: strategies needing attention, Jev fallback used, exchange
   unreachable, exchange key error — each links to where it is fixed.
4. Open positions: pair, market, side, qty, entry, mark + 24h change,
   unrealised PnL (value and %), stop, take-profit, liquidation price and
   leverage (futures).
5. Trade history: time, pair, market, side, entry → exit, net realised PnL
   (incl. fees and funding), exit reason (first red / first green / stop /
   take-profit / kill switch / flip).
6. Trade detail: signal timeframe (1D / 4H late entry), 1W trend at entry,
   the three factors with Jev confidence and present/not present,
   threshold, size formula result, sizing mode, leverage used (and
   "lowered from X to Y"), Jev fallback flag, PnL breakdown (gross, fees,
   funding, net).
7. Audit log view (secrets never shown).
8. Consistency heatmap: per day for the last 12 months (mobile: 16 weeks)
   — trades, wins, losses, realised PnL, activity level (0 / 1 / 2 / 3 /
   ≥4 trades). Day boundary = Asia/Bangkok (00:00 ICT). Thai view uses
   Buddhist-era dates.
9. When data is stale (exchange unreachable) the last values are shown
   dimmed with the error banners; loading and empty states exist for every
   table.
10. Mobile shows only Dashboard and Kill switch; Strategies and Settings are
    desktop only.

## Data
| Item | Class | Where | Retention | Rules |
|---|---|---|---|---|
| Binance API key + secret | restricted | DB, encrypted | until replaced | never logged, never sent to browser/notifications |
| Encryption master key | restricted | Railway env only | — | never in DB or repo |
| LINE channel token, Telegram bot token, chat/user IDs | restricted | DB, encrypted | until replaced | never logged |
| Password hash (argon2id) | restricted | DB | account life | — |
| TOTP secret, recovery code hashes | restricted | DB, encrypted | account life | — |
| Owner email | pii | DB | account life | not in logs or notifications |
| Session tokens | restricted | DB/cookie | expiry | not logged |
| Session metadata (device, IP) | pii | DB | session life + audit | shown only to the owner |
| Strategies, orders, positions, trades, PnL | internal | DB | indefinite | not in repo |
| Jev requests/responses | internal (market data only) | DB | indefinite | contain no account data |
| Candles / market data | public | DB cache | rolling | — |
| Audit log | internal | DB, append-only | indefinite | secrets redacted |

Data leaving the boundary: Binance (orders), Jev (market features only),
LINE and Telegram (trade notifications: pair, side, qty, price, PnL).

## Interfaces
- Binance Spot REST + user data stream; USDⓈ-M Futures REST + user data
  stream; public market data (klines). Every order carries a deterministic
  client order ID: `<strategy_id>-<candle_open_time>-<action>`.
- Jev API: request = features (B8.1), side, timeframe; response = typed
  per-factor `present` + `confidence`.
- LINE Messaging API (push) and Telegram Bot API (sendMessage).
- Web app pages: Login, Dashboard, Strategies (list / create / edit /
  enable / disable / close), Kill switch, Settings (Binance keys,
  Notifications, Security: password, TOTP, recovery codes).
- CLI: seed owner account; reset password; reset TOTP; replay
  (`pair, market, date range` → list of decisions).
- Audit events (who, when, what, before/after with secrets redacted):
  login success/failure/lockout, logout, strategy create/edit/enable/
  disable/close, kill switch, key change, notification change, TOTP/
  password/recovery-code change, reconciliation mismatch.

## Non-functional
- Signal evaluation and order placement complete within 2 minutes after a
  candle closes.
- Single Railway service; restart-safe (state in DB, reconciliation on
  start). Railway Hobby plan; no static outbound IP, no Binance IP whitelist.
- All money values are decimals (no floats), end to end.
- Public repo: secret scanning in pre-commit and CI must pass; no config
  containing account data is committed.
- UI language: Thai and English, switchable by the user.
- Dashboard data refreshes at least every 10 s while open (design
  handoff); prices may stream.

## Edge cases and failure modes
- **E1 Duplicate signal / restart mid-step**: idempotency key (B1.2) and
  client order ID prevent a second order; before re-sending after a
  timeout, the system queries the order by client order ID.
- **E2 Partial fill**: protective stop is sized to the filled quantity;
  remaining quantity of a market order is not re-sent.
- **E3 Binance unavailable / rate limited / order rejected**: no new
  entries while unavailable; exits and stop placement are retried with
  back-off for up to 10 minutes, then
  `order_rejected` + `needs_attention`.
- **E4 Market data gap** (missing candle): no signal for that timeframe
  until the gap is filled from REST.
- **E5 Jev unavailable**: B8.4.
- **E6 Stop above price at entry** (long) / below (short): B4.3, B5.2.
- **E7 Stop filled between candle close and exit order**: exit order is
  not sent; position is marked closed from the fill.
- **E8 Symbol delisted / trading halted**: strategy → `needs_attention`,
  notify; no automatic action beyond keeping the stop.
- **E9 Liquidation despite checks**: recorded as `liquidated`, notified,
  strategy → `needs_attention`.
- **E10 Key revoked / permission removed**: all strategies →
  `needs_attention`, notify, Settings shows the error.
- **E11 Clock skew**: server time is synced with Binance server time
  before signing requests.
- **E12 Notification channel down**: B13.2.

## Acceptance criteria
1. Signal engine unit tests reproduce the Definitions formulas exactly
   (EMA seed, regime, first green/red) on hand-built candle series, and a
   replay over ≥ 2 years of 1D data for BTCUSDT, ETHUSDT, SOLUSDT is
   produced for the owner to read. (No TradingView export — owner decision
   2026-09-28; accepted risk: no bar-by-bar check against the Pine
   reference.)
2. Trail unit tests reproduce the Definitions formula (Wilder ATR, all
   three branches) on hand-built series.
3. Live decisions over the first 30 days equal replay decisions for the
   same candles (every mismatch explained).
4. No order is placed from an unclosed candle (test with a mocked open
   candle).
5. Sending the same signal twice produces exactly one order (test).
6. Every open position has an exchange-side stop, verified by
   reconciliation, at every check.
7. Sizing tests: modes A/B/C × 0–3 factors × leverage 1/5 give the
   expected notional and margin; rounding never exceeds step size/free
   balance; below min notional → no order.
8. Liquidation check: a case where 5x would put liquidation inside the
   stop results in lower leverage or a skipped entry (test).
9. Jev timeout / error / invalid response → base size + `jev_fallback`
   (test).
10. Kill switch closes all system positions and cancels all system orders
    on testnet, and touches nothing else.
11. Auth: login without TOTP fails; lockout after 5 failures; enabling a
    strategy without fresh TOTP fails; keys never appear in API responses
    or logs (log scan test).
12. A Binance key with withdrawal permission is rejected on save.
13. Secret scanner runs in CI and blocks a test commit containing a fake key.
14. Flip tests: profitable long closed by first red + 2 short factors →
    short opens (1W ignored); same with 1 factor, a losing exit, a stop exit,
    a spot strategy, or a Jev failure → no flip. Mirror cases for short → long.

## Open questions
None. Resolved by the owner (Zong) on 2026-09-28:
1. B10.1 leverage: 1–20, 20x is the hard maximum.
2. B15.3 IP restriction: not used (Railway Hobby). Claude Design: remove
   both "not IP-restricted" variants and the prototype chip row.
   Owner verified 2026-09-28: an unrestricted HMAC key can enable both
   Futures and Spot & Margin trading.
3. B16.8 heatmap day boundary: Asia/Bangkok.
