# Plan: Cane auto-trader (from intent/cane-auto-trader/spec.md rev 5, 2026-09-28)
From: spec.md rev 5.1 (approved by Zong, 2026-09-28); intent.md (approved
2026-09-25, amendment 1 2026-09-28); design_handoff_cane_auto_trader/ round 3.
Author: Claude (drafted for owner review). Approver: Zong (owner).
Status: draft rev 2 (2026-09-28) — owner answers applied: NestJS backend,
Jev docs, no TradingView parity export, no testnet soak, spec E10 fixed.
Tracking: ClickUp space "Cane", list "List" (one task per step below).
Rev 3 (2026-09-28): Jev limits known; first live strategy = BTCUSDT
futures; DB backup and custom domain skipped (owner); handed to Claude Code.
Rev 3.1 (2026-09-29, Claude Code, owner answers): repo =
`github.com/Olympus-Work/cane` (already created; local root folder `cane`);
indicator seeding pinned (see "Indicator seeding" below).
**Approved by Zong (owner), 2026-09-29: plan rev 3 and the S04 DB choices.**
Rev 3.2 (2026-09-29, owner): "testnet" in this plan means **Binance Demo
Trading** (demo.binance.com; spot REST `demo-api.binance.com`, USDⓈ-M REST
`demo-fapi.binance.com`). Binance now documents it as the USDⓈ-M testnet; for
spot it has live-identical filters and limits, unlike testnet.binance.vision.
Demo keys live only in the git-ignored `apps/server/.env` and are read by
integration tests only.

Money-affecting: yes (real capital, full auto). Repo holds only an initial
README commit; every path below is new.

## Tech stack (owner confirmed TypeScript + NestJS, 2026-09-28)
| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript end to end (Node 24 LTS) | One language for engine, API and UI; shared types between server and web; design suggests React + TS |
| Money math | `decimal.js` everywhere; DB `numeric` | Spec: no floats end to end. Lint rule bans `Number` arithmetic in `packages/core` money paths |
| Backend | **NestJS** (Fastify adapter), `@nestjs/schedule` for candle-close jobs, modules per domain | Owner choice; DI and module boundaries fit engine / exchange / auth / notify split; single Railway service |
| DB | PostgreSQL (Railway Hobby add-on), Drizzle ORM with SQL migration files | Durable state, restart-safe; migrations reviewable as plain SQL |
| Frontend | React + TypeScript + Vite, CSS variables from `tokens/`, small TH/EN i18n | Matches design handoff |
| Auth | `@node-rs/argon2` (argon2id), `otplib` (TOTP), DB-backed sessions, Nest guards for fresh-TOTP gates | Spec B14 |
| Jev | TypeSafe **JavaScript SDK** (or plain `fetch`) → `POST https://api.typesafe.ai/v1/systemone`, Bearer key from env `TYPESAFE_API_KEY`, model pinned (e.g. `jev-1.13.0`, not `jev-latest`) | Docs: docs.typesafe.ai; pinning keeps live == replay reproducible |
| Secrets at rest | AES-256-GCM (Node `crypto`), master key from Railway env `CANE_MASTER_KEY` | Spec Data table |
| Tests | Vitest (unit/property), Playwright (UI smoke + screenshots), Binance Spot + Futures **testnet** (integration) | Spec Acceptance 1–14 |
| Guardrails | gitleaks (pre-commit + CI), GitHub push protection, ESLint + tsc strict, `pnpm audit` in CI | Intent: public repo |

Alternatives considered: Python backend (rejected by owner; two languages
would duplicate the trade/strategy types the UI renders); plain Fastify
(replaced by NestJS per owner). NestJS stays a thin shell: trading rules
live in `packages/core`, never inside Nest services.

## Repo layout (new)
```
cane/                             (github.com/Olympus-Work/cane, public, AGPL-3.0)
├─ .gitignore                     *.pine, uncle-chaloke-*.md, *.zip, uploads/, .DS_Store, .env*, fixtures/private/
├─ .gitleaks.toml
├─ .github/workflows/ci.yml       lint, typecheck, test, gitleaks, build
├─ LICENSE                        AGPL-3.0
├─ README.md                      setup + "not financial advice, use at your own risk"
├─ CLAUDE.md                      conventions, commands, never-do list
├─ intent/cane-auto-trader/       intent.md, spec.md, plan.md, design.md, design handoff
├─ packages/core/                 PURE logic, no I/O: indicators, signals, sizing, leverage, flip rules
│  ├─ src/indicators/ema.ts, atr.ts, cdc-action-zone.ts, cdc-trail.ts
│  ├─ src/signals/evaluate.ts     B1–B4, B7 decisions from closed candles
│  ├─ src/features/confluence.ts  B8.1 feature extraction (long + mirrored short)
│  ├─ src/sizing/size.ts          B6 modes A/B/C, rounding, min notional
│  ├─ src/risk/leverage.ts        B9.2 liquidation check + auto-lowering
│  └─ test/                       unit + parity tests (fixtures/)
├─ packages/shared/               API DTOs, enums (states, exit reasons, events)
├─ apps/server/                   NestJS
│  ├─ src/binance/binance.module.ts   REST + user-data-stream clients (spot, usdm, algo orders), time sync, filters
│  ├─ src/jev/jev.module.ts           B8 request/response, timeout, typed validation
│  ├─ src/engine/engine.module.ts     scheduler, candle store, executor (orders, stops), reconciler
│  ├─ src/notify/notify.module.ts     LINE Messaging API, Telegram
│  ├─ src/auth/auth.module.ts         login, TOTP, sessions, lockout, recovery codes, guards
│  ├─ src/api/                        controllers: dashboard, strategies, kill-switch, settings, audit
│  ├─ src/db/schema.ts + migrations/
│  └─ src/cli/                        nest-commander: seed-owner, reset-password, reset-totp, replay
└─ apps/web/                      React app per design handoff (self-hosted fonts + icons)
```

## Order of work
Each step ends with its proof passing in CI before the next starts. Steps
1–3 touch no exchange and no money.

0. **Repo + guardrails.** `git init` locally first (GitHub remote added
   when the owner names the repo), `.gitignore`, LICENSE,
   README disclaimer, `CLAUDE.md`, gitleaks pre-commit + CI, push
   protection, CI skeleton. Proof: AC13 (CI blocks a commit with a fake
   key on a throwaway branch).
1. **Indicators + signal engine (`packages/core`).** EMA, Wilder ATR, CDC
   Action Zone (regime, first green/red), CDC ATR trail; `evaluate()` for
   B1–B4, B7 incl. warm-up (200 candles) and closed-candle-only. Replay CLI
   over candles from Binance public klines; replay report for BTC/ETH/SOL
   ≥ 2 y handed to the owner. The replay CLI bootstraps a Nest context
   **without** the Binance trading module or any API key (public klines
   only), so it cannot place orders even with a bug. Proof: AC1, AC2, AC4,
   plus a test that the replay context has no order-placing provider.
2. **Sizing + leverage (`packages/core`).** B6 modes A/B/C, rounding to
   step/tick, min notional, free-balance cap; B9.2 liquidation check with
   auto-lowering. Proof: AC7, AC8 (table-driven + property tests).
3. **Confluence features + flip rule (`packages/core`).** B8.1 features
   (long + mirrored short), B7.5 flip decision given Jev output. Proof:
   feature unit tests on hand-made candle series; AC14 with a stubbed Jev.
4. **DB schema + migrations.** Tables: owner, sessions, recovery_codes,
   settings (encrypted blobs), strategies, signals (idempotency key
   `strategy_id+timeframe+candle_open_time`), orders (client order ID),
   positions, trades, jev_calls, notifications, audit_log (append-only,
   DB role without UPDATE/DELETE), candles. Separate diff from logic.
   Proof: migrate up/down on a fresh DB in CI.
5. **Binance adapter (testnet only).** Time sync (E11), exchange filters,
   spot + USDⓈ-M orders, user data streams, deterministic client order IDs,
   query-before-resend (E1), back-off retries (E3), margin mode + leverage
   set/verify (B9.1). Futures stops via the **Algo Order API** (see Risks).
   Spot stops: STOP_LOSS on spot; spot late entries with TP use an **OCO**
   order list (stop + TP share one locked balance). Proof: AC5, integration
   tests on testnet for entry → stop → trail move → exit, partial fill (E2),
   stop filled before exit (E7).
6. **Engine loop + reconciler.** Scheduler fires after 4H/1D/1W close
   (+ grace for Binance kline finalisation), evaluates enabled strategies,
   executes, trails stops (B5.3–5.4, futures place-then-cancel). Reconciler
   on start + every 5 min (B12). Proof: AC6 on testnet (kill the process
   mid-entry, restart, reconciler repairs; every position has a stop).
7. **Jev client.** `POST /v1/systemone` with `state` = the B8.1 features
   serialised as text (side, timeframe, numbers only), three **Noul**
   questions (one per factor). Mapping to spec B8.3: `confidence` = Noul
   probability of yes; `present` = probability ≥ 0.5 (the strategy threshold
   applies to `confidence`; see "Jev client choices in S07"). Model
   pinned. 3 s default timeout (setting), fallback to base size, request +
   response stored per trade. Proof: AC9 (timeout, 5xx, invalid shape,
   valid), plus one live call from a dev shell with the owner's key.
   Limits (owner, 2026-09-28): ~1,200 requests/min, ~250,000 tokens/s —
   far above need (3 questions per signal, a few signals per day); no
   client-side throttling beyond a simple concurrency cap.
8. **Auth + Settings API.** Seed CLI, login (email + password + TOTP),
   lockout, sessions, fresh-TOTP gates, recovery codes, Binance key save
   with permission check, notification targets, audit log. Proof: AC11,
   AC12; log-scan test greps all logs from the test run for key/secret/
   token fixtures.
9. **Notifications.** LINE push + Telegram, retry without blocking trading,
   test-message endpoint, message redaction. Proof: unit tests on templates
   (no secrets, no full IDs); manual test message to both channels.
9.5. **Strategy + Dashboard API** (owner choice B, 2026-09-30: S09 left
    no step for the backend the web screens call). Strategy list/create/
    edit/close (B10), Dashboard data (status, equity, PnL, open positions,
    trade history, trade detail, audit log, 30-day strategy PnL, daily
    activity for the heatmap), needs-attention list. The kill switch API
    stays in step 11. Proof: API tests on Postgres against spec B10, B16.
10. **Web app**, delivered in two PRs (owner, 2026-09-30):
    **10a** app shell, TH/EN + theme, Login and Settings (their API exists
    since S08/S09); **10b** Dashboard, Strategies, Kill switch screens on
    top of step 9.5. 10a ships before 9.5 so the owner can test Settings.
    Rebuild screens from the design handoff (not copy the
    prototype): Login, Dashboard (+ heatmap Asia/Bangkok, trade drawer),
    Strategies, Kill switch, Settings. Self-host Poppins, Noto Sans Thai,
    JetBrains Mono, Font Awesome. Proof: Playwright smoke per page in TH/EN,
    screenshots compared by the owner with the prototype; no request to a
    third-party CDN on authenticated pages (Playwright network assertion).
11. **Kill switch end to end.** Proof: AC10 on testnet with a manual
    position the system did not open (must stay untouched).
12. **Deploy to Railway and go live** (no testnet soak — owner decision
    2026-09-28). Postgres add-on, env vars, HTTPS, `BINANCE_ENV=live`,
    `TRADING_ENABLED=true`; owner enters the live key in Settings and
    enables strategies one by one (TOTP). **First strategy: BTCUSDT,
    USDⓈ-M futures** (defaults: 5x ceiling, isolated, mode B). Default
    `*.up.railway.app` domain. Capital sizing is the owner's
    choice (intent). Proof: health check green, `system_started` received on
    LINE + Telegram, reconciler clean on first run.
13. **Live == replay watch (30 days).** Daily replay-diff job as a
    scheduled job inside the same Railway service (no extra service). It
    runs the replay path over yesterday's closed candles and compares with
    live decisions read through a **read-only DB role**; a failure only
    notifies, never affects trading. Proof: AC3; every mismatch explained
    in `intent/cane-auto-trader/live-log.md`.

## Approach and alternatives
- **Pure core, thin shell.** All trading rules live in `packages/core` as
  pure functions of (candles, strategy config, Jev result, account
  snapshot). Live engine and replay CLI call the same functions, which is
  what makes AC3 (live == replay) provable. Alternative (logic inside the
  executor) rejected: untestable without an exchange.
- **Indicator seeding (owner, 2026-09-29)** — the spec Definitions do not
  fix it, so it follows the Pine built-ins: `EMA(n)` first value = SMA of
  the first n closes, then `α = 2/(n+1)`; `ATR(n)` = Wilder RMA of True
  Range (`max(high−low, |high−close[prev]|, |low−close[prev]|)`; first bar
  `high−low`), RMA first value = SMA of the first n TR; the trail uses the
  Pine `nz(trail[prev], 0)` start (first bar with ATR defined → `max(0, close − k·ATR)`).
  Values before a series is defined are "not available", never 0.
- **Spec readings in S01 code (Claude Code, 2026-09-29; confirmed by the
  owner 2026-09-29):**
  - Regime is `null` until at least one buyCond and one sellCond exist
    (Pine `barssince` = na). A null 1W regime blocks entries (B2).
  - E4 "market data gap" = the newest candle that should have closed is
    missing, or the last two closed candles are not adjacent. Older
    exchange-side gaps in history do not block (they are listed in the
    replay report).
  - B5.3 trail move also requires the new trail to be on the protective
    side of the last close (a trail that flipped above price is not placed
    as a long stop).
  - B7.1/7.2 exits trigger on `firstRed` / `firstGreen` exactly as defined.
    A long still open while the 1D regime is already bearish (e.g. after a
    data gap) keeps its exchange stop and waits for the next signal.
  - B4 late entries may repeat within one 1D regime after a stop / take-
    profit exit, each on a new 4H first signal (B7.4 "new signal").
  - B7.4: the 1D candle that closed a position is consumed. A plain entry
    keyed to it is never taken later (e.g. at the next 4H evaluation); the
    opposite side opens on that candle only through the flip (B7.5, S03).
    The live engine (S06) must record the exit's signal key like an entry's.
  - B5.3: trailing uses only 1D candles that closed after the entry was
    decided (`OpenPosition.openedAt`), so a 4H late entry is not tightened
    by the 1D candle that closed before it.
  Neither guard changed the 2024-09-29 → 2026-09-29 replay report.
- **Spec readings in S02 code (Claude Code, 2026-09-29; confirmed by the
  owner 2026-09-29):**
  - Order of work in `planEntry`: size_pct → for each leverage from the
    ceiling down to 1x, build the final order (target notional → free-
    balance cap B6.5 → rounding B6.6) and run the B9.2 check on that final
    size and its bracket; the first leverage that passes is used. (PR #3
    review: checking before the cap missed a cap that crosses into a lower
    bracket where liquidation sits closer.)
  - Liquidation price = Binance isolated one-way formula
    `(WB + cum − side·Q·EP) / (Q·MMR − side·Q)` with WB = initial margin and
    the symbol's leverage bracket (maintenance margin = notional × MMR −
    cum), fees ignored. Cross margin
    uses the same estimate (its real liquidation is the same or further
    away, so the check is conservative).
  - A leverage above the notional's bracket maximum is also lowered
    (`leverage_lowered`); no bracket for the notional → skip.
  - Rounding: quantity down to step; stop to tick *away* from price
    (long down, short up) and take-profit *towards* price, so the rounded
    stop never crosses entry and the liquidation check uses the price sent.
  - Minimums: below `minQty` or `minNotional` after rounding → skip with
    `order_skipped_min_notional`.
  - Free balance cap: spot compares the notional with free quote balance;
    futures compares margin with available margin and reduces notional to
    `free × leverage`. Fees are not reserved (to revisit in S05/S06 if
    Binance rejects orders for margin).
  - size_pct cap 100 is never reached with base ≤ 20 (max 80); kept as
    written.
- **Spec readings in S03 code (Claude Code, 2026-09-29; confirmed by the
  owner 2026-09-29):** B8.1 details were cut off in spec.md ("Lookbacks and
  thresholds above are."); the owner confirmed these and spec.md rev 5.2
  now states them:
  - Pivot high/low (5/5): strictly higher/lower than the 5 bars on each
    side; confirmed only when 5 bars exist after it up to the signal candle.
  - Channel: least-squares line through *all* pivot highs in the last 60
    bars (≥ 3 needed); slope as % of the mean pivot price per bar; a
    "touch" is a pivot within 1% of the line; % that the signal close is
    above the line.
  - Capitulation: the 10 bars before the signal; big body = bearish body ≥
    1.5 × ATR(14) at that bar; gap-down = open < previous low; volume spike
    = max volume of the 10 bars ÷ average volume of the 20 bars before them.
  - Higher low: last two confirmed pivot lows within 120 bars, % change.
  - Short side = the same code on the price mirror (highs ↔ lows, negated),
    so every feature reads "more / > 0 favours the side".
  - Flip: profit means realised PnL after fees and funding > 0 (zero is no
    flip); the flip's stop is the B5.2 stop on the same 1D candle
    (`primaryStop`), without the 1W filter.
  - S06 wiring note (PR #4 review): `confluenceFeatures` takes a bare
    signal index and cannot enforce B1.1 itself; the engine must pass the
    index from `lastClosedIndex(candles1d, nowMs)` (the signal candle of
    the decision), exactly as `decide()` does.
- **DB choices in S04 (Claude Code, 2026-09-29; confirmed by the owner
  2026-09-29):**
  - Schema in `apps/server/src/db/schema.ts`; drizzle-kit generates the
    up SQL, drizzle's migrator applies it. Drizzle has no down migrations,
    so each migration has a hand-written `migrations/down/<tag>.sql`, run
    by `src/db/migrate.ts` (newest first, one transaction each). CI checks
    that `drizzle-kit generate` produces nothing (schema == migrations) and
    runs up → down → up on a fresh Postgres service container.
  - Value sets are `text` + CHECK, not pg enums (easier to extend).
    Money/prices/quantities `numeric`; candle times `bigint` UTC ms.
  - Append-only audit_log: a trigger blocks UPDATE/DELETE/TRUNCATE for
    every user (the Railway user is a superuser, which bypasses GRANTs),
    **and** the app role has only SELECT + INSERT on it.
  - Roles `cane_app` (server) and `cane_readonly` (replay / replay-diff:
    SELECT on strategies, signals, jev_calls, positions, orders, trades,
    candles — no auth tables, no settings) are NOLOGIN group roles created
    by the migration. S12 creates login users in them and points the
    server and the replay-diff at those users. Each later migration that
    adds a table grants it to these roles.
  - B10.2 "one enabled strategy per pair" = partial unique index on `pair`
    where status is `enabled` or `needs_attention` (spot and futures share
    a pair). One open position per strategy = partial unique index.
  - Secrets are stored only as AES-GCM `bytea` (`*_enc`) or hashes; session
    cookies are stored as a hash of the token.
- **Binance Demo Trading probe (Claude Code, 2026-09-29, before S05 code):**
  one Demo key works for both spot and USDⓈ-M (canTrade on both; one-way
  mode). Server clock skew ~60 ms.
  - USDⓈ-M Algo Order API works (`POST/GET/DELETE /fapi/v1/algoOrder`,
    `algoType=CONDITIONAL`, `clientAlgoId`); STOP_MARKET on `/fapi/v1/order`
    fails with -4120 exactly as on live.
  - Spot OCO works (`POST /api/v3/orderList/oco`, `listClientOrderId`;
    cancel via `DELETE /api/v3/orderList`). Prices far from market fail
    `PERCENT_PRICE_BY_SIDE` (-1013); a 2R take-profit can hit this on
    volatile pairs, so S05 surfaces -1013 as an order rejection (E3).
  - **Spot user data stream:** the REST listenKey endpoints
    (`/api/v3/userDataStream`) return HTTP 410; Binance retired them on
    2026-02-20. S05 uses the WebSocket API `userDataStream.subscribe.signature`
    for spot. USDⓈ-M still uses `POST /fapi/v1/listenKey` (works on Demo).
  - `/sapi/v1/account/apiRestrictions` (B15.2 permission check) returns 404
    on Demo, so AC12's "one testnet check" cannot run on Demo; S08 proves
    B15.2 with the mocked permission API only and one manual check with the
    live key at go-live (S12).
  - **Settings save on Demo (fix found while preparing AC10, 2026-10-08;
    needs owner OK):** with `BINANCE_ENV=testnet` the save used that 404
    endpoint, so no Demo key could ever be saved. On testnet the checker
    now reads trade permission from the account endpoints Demo serves:
    spot `GET /api/v3/account` (`canTrade`), USDⓈ-M `GET /fapi/v3/account`
    (a key without Futures is rejected by Binance). A market whose call is
    rejected counts as "cannot trade" there; a key rejected by both is
    refused. Withdrawals and universal transfer do not exist on Demo, so
    that part of B15.2 is checked on live only. Live is unchanged.
- **Binance adapter choices in S05 (Claude Code, 2026-09-29; confirmed by
  the owner 2026-09-29, incl. mark-price stops, the AC12 proof change and
  local-only integration tests):**
  - Futures stops and take-profits trigger on **mark price**
    (`workingType=MARK_PRICE`): liquidation also uses mark price, so the
    B9.2 1% buffer between stop and liquidation holds. Spot stops trigger on
    last price (spot has no mark price).
  - Every placement is **query-before-send** by client ID (E1): one extra
    signed GET per order, and a restart or a timeout never sends a second
    order. A duplicate-ID rejection (spot -2010, USDⓈ-M -4116) is resolved
    by the same query. Binance only rejects duplicate IDs among *open*
    orders, so the query is what stops a filled market order being re-sent.
  - Spot BUY fees are charged in the bought coin (Demo check: 0.1% of BTC).
    The spot position and its stop use the **received** quantity (filled −
    base-asset commission, from `myTrades`), rounded down to the step; the
    dust left over stays in the wallet.
  - Exits: USDⓈ-M closes the whole one-way position reduce-only and sends
    nothing if it is already flat (E7). Spot cancels its stop / OCO first,
    subtracts what those orders already sold (E7), and never sells more
    than the free balance, so the owner's other holdings stay untouched
    (B11.3). A reduce-only algo stop is **not** cancelled by Binance when
    the position closes (Demo check), so B7.3 cancelling is always done.
  - `TRADING_ENABLED` is checked inside the adapter: every order-placing
    call and every margin/leverage change throws unless it is true. Reads
    and cancels are allowed. Integration tests pass `tradingEnabled: true`
    to the adapter in-process with `BINANCE_ENV=testnet` endpoints; no env
    var is set.
  - Retries (E3): reads and cancels retry 429/418/5xx/network with back-off
    (5 attempts, `Retry-After` honoured); placements are sent once and an
    unclear outcome is resolved by query-before-resend (3 attempts). The
    10-minute retry loop for exits and stops belongs to the engine (S06).
  - E2 partial fill: Demo market orders always fill in full, so the proof
    is a unit test — the adapter reports the filled quantity of an
    EXPIRED/partial order and a retry never re-sends the rest. Sizing the
    stop to that quantity is the engine's job (S06).
  - User data: spot via the WebSocket API `userDataStream.subscribe.signature`
    (HMAC works on Demo); USDⓈ-M via listenKey + 30-min keepalive. Every
    (re)connect calls `onConnected` so the engine reconciles missed events.
- **Engine and reconciler choices in S06 (Claude Code, 2026-09-29; confirmed
  by the owner 2026-09-29, all four: client order ID candle + `bail`, no
  resend of an entry Binance never received, unknown/manual positions
  flagged only, in-process AC6 kill):**
  - **Client order ID candle = the evaluated 4H candle** (spec Interfaces
    left "candle" open). Keying orders to the *signal* candle collides: a 4H
    late entry and a later 1D event can share an open time, and query-before-
    send would then treat the old order as the new one (e.g. a trail move
    cancelling the only stop). Each strategy is evaluated once per 4H candle,
    so each action is used at most once per ID time. New action `bail` = the
    E6 close of an entry whose fill already crossed its stop. Reconciler
    repairs use the time of the repair.
  - Evaluation: a 1-minute timer; each strategy is evaluated once per closed
    4H candle, 30 s after the close, with `nowMs` = the 4H close — the
    replay's evaluation time, so AC3 compares like with like. The evaluation
    is recorded in `signals` (4H key); a 1D entry/exit also claims its 1D key
    (B7.4, same as the replay). A data gap (E4) is not recorded and is
    retried on the next tick. Candles come from the replay's `KlineCache`
    (live public klines; Demo klines are identical). The `candles` table stays
    unused for now. Plain `setInterval` instead of `@nestjs/schedule`.
  - Crash safety (AC6): every order row is written before its send; the
    entry plan is written into the signal's decision JSON before the send.
    Only a Binance rejection marks an entry `REJECTED`; any other failure
    leaves it `PENDING`. On start-up the reconciler asks Binance: filled →
    record the position and place its stop; never received → `NOT_SENT` +
    `order_rejected` (no resend: the signal may be stale). Unbooked exits are
    finished the same way.
  - Reconciler (B12): unknown position → mismatch only, no orders (B11.3);
    quantity differs → mismatch, stop kept for what is held; missing stop →
    mismatch + stop re-placed; position gone on Binance → booked as stop /
    take-profit (from the protective order), liquidated (E9, force-order
    history) or manual (mismatch). A mismatch is notified once per distinct
    reason. Spot cannot see manual holdings (balances are not positions), so
    it checks only that the recorded quantity is still held.
  - "Is the stop open" uses Binance's open-order lists: the single algo-order
    query reports NEW for ~2 s after a cancel (Demo check).
  - PnL (trades): USDⓈ-M gross = Binance realised PnL of the fills, fees =
    USDT commissions, net = gross − fees + funding (income history). Spot
    gross = (avg sell − avg buy) × sold, fees include the base-asset entry
    fee at its fill price; fees paid in a third asset (BNB) are not valued.
    New columns on `positions` keep the entry details (size %, 1W trend, Jev
    call, fallback, leverage ceiling) for the trade record (B16.6).
  - Ports until later steps: Jev = "not configured" (B8.4 fallback, so no
    flips) until S07; notifications are logged until S09. `EngineModule` is
    not imported by `AppModule` until S08 provides the key from Settings;
    with `TRADING_ENABLED` not `true` nothing starts, not even the reconciler.
  - AC6 proof: the "kill" is simulated in-process (the entry call dies right
    after Binance accepted the order) and a fresh set of objects over the
    same DB plays the restarted process; Demo + Postgres, local only.
- **Jev client choices in S07 (Claude Code, 2026-09-29; confirmed by the
  owner 2026-09-30, except retry and concurrency cap, which the owner made
  configurable, see below):**
  - **`present` = Noul ≥ 0.5, `confidence` = the Noul value**, not
    `present` = Noul ≥ 0.70 as in step 7. The confidence threshold is a
    per-strategy setting (B10) and `presentFactorCount` already applies it to
    `confidence`; a fixed 0.70 in the client would silently raise any
    strategy threshold below 0.70.
  - Plain `fetch`, no SDK; **retry is off by default** (the SDK's backoff on
    429 would break the 3 s budget). Owner 2026-09-30: `JEV_MAX_RETRIES`
    (env, default 0) allows that many extra attempts on network error, 429
    or 5xx, with no delay between them; the 3 s budget is one timer over all
    attempts, so retries only spend what is left. The budget covers connect,
    response and body.
    Timeout = `timeout`; network error or any non-2xx (incl. 429) = `error`;
    bad JSON, a missing factor, a non-Noul answer or a value outside [0,1] =
    `invalid_response`. All map to base size + `jev_fallback` (executor).
  - Model pinned to `jev-1.13.0`; the model string in the response is stored
    per call. The timeout is a constructor option (default 3 s) until S08 adds
    the Setting.
  - Concurrency cap is off by default (3 questions per signal, a few signals
    a day, against 1,200 requests/min). Owner 2026-09-30:
    `JEV_MAX_CONCURRENCY` (env, default 0 = unlimited) caps in-flight
    calls; a call waiting for a slot does not start its 3 s budget until it
    has one.
  - Stored request = model, state text and questions (never headers or the
    key). State is fixed-order `name: value` lines from the B8.1 features;
    question wording lives in `apps/server/src/jev/jev.client.ts` and is
    behaviour: change it only with a plan update.
  - No `JevModule`: the client is one class built by a factory in
    `EngineModule` (key from env `TYPESAFE_API_KEY`; no key = the
    `UnavailableJev` fallback). S08 moves the key into Settings.
  - AC9 proof: `jev.client.test.ts` covers the client side (timeout, 5xx/429,
    network error, invalid shapes, valid, factor order) and that every failure
    counts as 0 factors. The `jev_fallback` notification and the `jev_calls`
    row are written by the executor (S06 code), which has no unit test
    without Binance; the live call is `test/integration/jev-live.test.ts`
    (local only, like S05/S06).
- **Auth and Settings choices in S08 (Claude Code, 2026-09-30; fresh-TOTP
  and strategy-enable choices given by the owner 2026-09-30, all the rest
  confirmed by the owner 2026-09-30):**
  - **Fresh TOTP = a code sent with the request itself** (header
    `x-totp-code`), checked against the owner's secret, on top of a valid
    session. No step-up window and no state in `sessions`.
  - **A TOTP code is accepted once** (RFC 6238 §5.2): migration 0003 adds
    `owner.totp_last_step`; a code whose time step is <= it is rejected. A
    login and a gated action in the same 30 s step therefore need two
    different codes; the UI says "wait for the next code". Window is +-1 step.
  - Lockout: 5 consecutive failed logins set `locked_until = now + 15 min`
    (one atomic UPDATE); while locked every attempt fails without checking
    the password or code. A success resets the counter. Email, password and
    code failures give the same message (no hint about which was wrong).
  - Sessions: 256-bit random token in an HttpOnly, Secure, SameSite=Strict
    cookie; only the SHA-256 of the token is stored. Idle 30 min
    (`last_seen_at`), absolute 12 h (`expires_at`). Recovery codes: 10 random
    codes, stored as SHA-256, single use.
  - Secrets in Settings: AES-256-GCM, random 12-byte IV per write, stored as
    `iv | tag | ciphertext`; `hint` is the last 4 characters. Master key
    `CANE_MASTER_KEY` = 32 bytes as base64 or hex; the server refuses to
    start without it once Settings is in use.
  - B15.2 permission check goes through a `BinancePermissionChecker` port
    (`GET /sapi/v1/account/apiRestrictions`); mocked in tests (the endpoint
    404s on Demo), one manual live check at S12.
  - **Strategy enable (owner choice):** no plan step owns the strategy API,
    so S08 ships only `POST /v1/strategies/:id/enable` and `.../disable`
    with the fresh-TOTP guard, the B10.2 one-per-pair rule and an audit row.
    Create/edit/close and B1 warm-up stay with S10/S11. This is what AC11's
    "enable without fresh TOTP fails" is proved on.
  - Keys move into Settings. The Jev key and timeout are read per call, so a
    change applies at once (default timeout 3 s; `TYPESAFE_API_KEY` stays as
    a local-dev fallback). **The Binance key is read once when the engine
    starts** (S06 builds its REST client and user-data streams from it), so
    a new Binance key takes effect after a restart; the Settings screen must
    say so. Making that live is left to S11/S12 (kill switch, deploy).
    EngineModule joins AppModule but stays inert while `TRADING_ENABLED` is
    not `true`.
  - `trustProxy` is on (Fastify trusts `X-Forwarded-For` from any peer) so the
    session list and audit log show the client IP behind Railway. S12 must
    check the service is reachable only through Railway's proxy.
  - Log-scan proof: a test replaces the Nest logger with a capturing sink for
    the whole run, uses fixture secrets (keys, password, TOTP secret, session
    token, recovery codes) and asserts none appears in any log line or any
    API response body.
- **Notification choices in S09 (Claude Code, 2026-09-30; confirmed by the
  owner 2026-09-30):**
  - `Notifier.notify` only writes one `notifications` outbox row per
    configured channel and returns; it never throws and never waits for the
    network, so trading cannot be blocked (B13.2). A worker (every 15 s)
    delivers pending rows.
  - Retry: 5 attempts in total, due at 0, 30 s, 2 min, 5 min and 15 min after
    the row was created; then `failed` with the last error. A channel that is
    down does not delay the other channel or later events.
  - A channel is "configured" when its two Settings exist (LINE: channel token
    + user ID; Telegram: bot token + chat ID). No channel configured = the
    event is only logged.
  - Messages are English plain text built by one pure function per event from
    a whitelist of fields (pair, side, qty, prices, PnL, reason, ...). Values
    are cut to 200 characters and anything that looks like a token (32+
    token characters) becomes `[redacted]`; unknown fields are dropped. Keys,
    tokens, TOTP data, account IDs and the owner email are never fields.
  - Stored `last_error` is the HTTP status plus the provider's short error
    text, with every configured secret replaced by `***`; the request URL
    (Telegram's contains the bot token) is never stored or logged.
  - Test message: `POST /v1/settings/notifications/test` `{channel}` (session
    only, no fresh TOTP, since it changes nothing) sends at once and returns
    `{ok}` or the error text.
  - New events from B13.1: `login_success` (from S08's login) and
    `settings_changed` (key, notification and Jev changes, saying which
    setting, never the value). `kill_switch` arrives with S11.
  - Proof: template unit tests (whitelist, redaction, no secrets or full
    IDs), channel tests with a fake fetch (LINE push body, Telegram body,
    HTTP failure), outbox tests on Postgres (retry schedule, one channel down,
    `notify` never throws), and the manual test message to both channels
    (owner, once, with real tokens).
- **Strategy + Dashboard choices in S09.5 (Claude Code, 2026-09-30; close
  scope given by the owner 2026-09-30, the rest awaits owner confirmation):**
  - All routes need a session (`SessionGuard`); none needs fresh TOTP except
    the existing enable. Money, prices and quantities are JSON **strings**.
  - **Close (owner choice):** `POST /v1/strategies/:id/close` closes only a
    strategy with no open position (status `closed` + audit row). With an
    open position it answers 409 `position_open`; cancelling orders and
    market-closing goes through `Executor.exit` and arrives with the kill
    switch in S11, so no order code is added in S09.5.
  - `POST /v1/strategies` creates `S-NN` (max + 1, at least 2 digits, inside
    one transaction under a Postgres advisory lock, so two creates never
    race), status
    `disabled`. Validation gives 400 with `{code, message}` (never a CHECK
    500): spot has no leverage or margin mode and sizing B; futures default
    5x, `isolated`, mode B; `base_pct` 5–20; threshold 0–1; `risk_pct` only in
    mode C. The pair must be listed and TRADING on the chosen market (B10.6),
    checked through the `ExchangeReader` port.
  - `PATCH /v1/strategies/:id`: with an open position, pair, market, leverage
    and margin mode answer 409 `locked_field` naming the field; other fields
    apply from the next entry. A `closed` strategy cannot be edited (404).
    Changing pair on an enabled strategy is refused (disable first).
  - `GET /v1/strategies` (B10.8): per strategy the row, `attentionReason`,
    price and 24h change, position summary (qty, entry, side, unrealised PnL
    when the exchange answered), `pnl30d` = `{total, daily:[{day,pnl}]}` for
    the last 30 Bangkok days (days without trades give `"0"`), leverage in
    use (open position's leverage, else null). `closed` strategies are listed
    last.
  - `GET /v1/strategies/sizing-preview?market&sizingMode&basePct&leverage` (B10.1): current
    equity of the market plus, for 0 / 2 / 3 present factors, `sizePct` (core
    `sizePct`) and `notional` / `margin` (core `targetNotional`). Mode C
    depends on the stop distance, so its notional and margin are `null`.
    While Binance is unreachable the last good equity is used and `stale` is
    true (B16.9).
  - **Exchange reads go through an `ExchangeReader` port** (like
    `PERMISSION_CHECKER`): `snapshot()` returns spot and futures equity,
    24h ticker per symbol, and per-position mark, liquidation price and
    unrealised PnL; `isListed(market, pair)`. The real adapter reads the key
    from Settings on each call and uses `BinanceTrading` with trading off
    (reads only); tests use a fake. The adapter caches a good snapshot for
    15 s; a small state service keeps the last good snapshot and its time, and
    when a refresh fails it returns those values with `stale: true` (B16.9)
    and the error kind: `no_key` (nothing saved), `key_rejected` (Binance
    refused the key) or `unreachable`. The first two show the key-error alert.
  - `GET /v1/dashboard`: `{status, lastSyncAt, stale, cards, alerts,
    positions}`. `status` is `running` or `exchange_unreachable`;
    `stopped_by_kill_switch` arrives with S11. Cards: spot and futures equity,
    today's and total realised PnL (Bangkok day, sum of `trades.net_pnl` in
    SQL), trade count, open positions per market. Alerts: `needs_attention`
    strategies (with reason), Jev fallback used **in the last 24 h**,
    exchange unreachable, key error; each carries a `link` route name.
  - `GET /v1/trades?limit&before` (newest first, `before` = trade id, limit
    1–100, default 50) and `GET /v1/trades/:id` (B16.5–16.6, including the
    three factors and Jev confidence read from the stored Jev call, PnL
    breakdown, "lowered from X to Y"). `GET /v1/audit-log?limit&before`
    likewise; rows are stored redacted already.
  - `GET /v1/dashboard/heatmap?days` (default 365, max 400): per Bangkok day
    with at least one trade, `{day, trades, wins, losses, pnl, level}`; win
    = net PnL > 0, loss = < 0, a flat trade counts as a trade only; level is
    0 / 1 / 2 / 3 / 4 for 0 / 1 / 2 / 3 / >= 4 trades. Grouping and summing
    are done in SQL on `numeric` (`closed_at AT TIME ZONE 'Asia/Bangkok'`).
  - B1 warm-up needs no API: the engine already reports `warming_up` from the
    candle count every tick, and enabling stays as in S08.
  - Proof: API tests on Postgres against B10 and B16 (create/edit/close,
    B10.2 conflict, locked fields, PnL and heatmap on hand-computed trades
    around the 00:00 ICT boundary), exchange faked, plus a test that no
    response contains a key fixture.
- **Web Dashboard / Strategies / Kill switch choices in S10b (Claude Code,
  2026-10-04; awaits owner confirmation):**
  - No router library: the shell keeps the current page in state (Dashboard,
    Strategies, Settings, Kill switch). The shell owns the 10 s dashboard poll
    so the status pill and the page share one request. Below 768 px only
    Dashboard and Kill switch exist (B16.10): no nav, a sticky kill bar, a
    16-week heatmap, 2-column stat cards and position cards instead of the
    wide table.
  - **Kill switch endpoint is S11's.** The screen and confirm modal are built
    against a proposed contract: `POST /v1/kill-switch` (session only, no
    TOTP) → `{activatedAt, results:[{pair, market, what, status:
    closed|cancelled|failed}], untouched:[{pair, market}]}`. Until S11 the
    server answers 404 and the modal says it is not available yet. The
    Dashboard also understands `status: 'stopped_by_kill_switch'` (S11 will
    return it); the "Trading stopped" banner shows for that or for a result
    received in this tab, and clears when a strategy is enabled from the UI.
    S11 may change the contract; it updates this plan first.
  - **State badge** comes from the API's `status` plus the position: enabled
    without a position = "Waiting for signal". "Warming up" is not shown:
    the engine knows it (S06) but no API field carries it. Add one when the
    owner wants it.
  - **Close** is offered on every non-closed strategy. With an open position
    the server answers 409 `position_open` (S09.5) and the dialog says to use
    the kill switch until S11 adds the market close.
  - **Pair input** is free text, upper-cased, checked against `^[A-Z0-9]{1,20}USDT$` (same as the server)
    in the browser and against Binance by the server (B10.6). There is no
    pair-list endpoint, so no search dropdown. A pair already used by an
    enabled / needs-attention strategy is flagged from the loaded list.
  - **Trade drawer**: the API has no previous / next trade id, so the flip
    note is shown for `entryKind: 'flip'` without the "Previous trade" link,
    and the "Flipped" note on the closing trade is not shown (no `flip` exit
    reason exists; the closing trade's reason is first red / first green).
    Factor names are the core codes (`channel_breakout`, …) mapped to labels.
    The Jev timeout in the fallback note is the current Setting; the trade
    record does not store the one that applied (B8.5 asks for it; add the
    column if the owner wants exactness).
  - Exit reasons `manual` and `liquidated` (in the DB, not in the design)
    get the labels "Manual" / "Liquidated".
  - Proof: component tests per screen (Vitest), plus Playwright smoke per
    page in TH and EN with the API mocked, a same-origin network assertion
    on every authenticated page, and screenshots for the owner to compare
    with the prototype.
- **Kill switch choices in S11 (Claude Code, 2026-10-05; awaits owner
  confirmation):**
  - **Contract unchanged** from S10b: `POST /v1/kill-switch` (session only,
    no TOTP) → `{activatedAt, results:[{pair, market, what, status:
    closed|cancelled|failed}], untouched:[{pair, market}]}`. `untouched` is
    the exchange snapshot's open futures positions that no system position
    accounts for (B11.3); spot balances are not listed (a spot wallet always
    holds assets the system did not buy). The snapshot for `untouched` is
    read fresh, past the reader's 15 s cache: the first AC10 run
    (2026-10-08) listed the just-closed BTCUSDT as untouched from a cached
    pre-kill snapshot. If that fresh read fails, `untouched` is `null` and
    the page says Binance could not be read to list them. An older
    snapshot is not used, and an empty list is not shown, because either
    could misreport (PR #19 review).
  - **Where it runs:** `EngineService` keeps the store, executor and mutex
    and exposes `killAll()`; the controller sits in its own module
    (`KillSwitchModule`) imported only by `AppModule`, so the replay
    context never reaches it. Each strategy is handled under the same
    `KeyedMutex` key as the engine tick, so a kill cannot race a half-done
    entry.
  - **Order per strategy:** set `disabled` first (no new entries), cancel
    every open or pending order of the strategy (entries too, not only
    stops), then market-close the position through
    `Executor.exit(..., 'kill_switch', key, 'kill')`. A `closed` strategy is
    skipped. The position's own quantity is the cap: futures close
    `min(|positionAmt|, position.qty)` reduce-only, spot sells only the
    strategy's quantity (already so).
  - **Bounded request (E3):** the kill pass retries for 15 s, not the
    10 minutes of normal exits. A pair that still fails is returned as
    `failed`, the strategy becomes `needs_attention` (still blocks entries)
    with `order_rejected` sent and listed on the Dashboard, and pressing
    the kill switch again retries it. The retry reuses the pending `-kill`
    order row (same client order ID, query before resend), so it never
    sends a second close. The reconciler books a `-kill` order that filled
    anyway.
  - **Status survives restarts without a new table:** `stopped_by_kill_switch`
    when the newest `kill_switch` audit row is newer than the newest
    `strategy_enable` audit row; the first re-enable clears it (B11.5).
  - **Engine off** (`TRADING_ENABLED` not true or no key saved): strategies
    are still disabled and the audit row written; a strategy holding a
    position is reported `failed` with the reason, never a 500.
  - New notification event `kill_switch` (one
    notification per pair with its result, so `scrub()` never cuts a long list). Audit row `kill_switch` with the results.
  - Proof: tests with a faked exchange incl. a manual futures position on
    the same pair that must stay untouched, an entry order pending at kill,
    a failing close, engine off, and the status derivation.
  - **AC10 passed on Binance Demo, 2026-10-08 (owner run 2, with the
    fresh-snapshot fix).**
    - Setup: the system held a BTCUSDT futures long (S-01) and its Algo
      stop. The manual position was ETHUSDT futures, on a different pair
      because one-way mode would merge same-pair positions.
    - Result: the kill closed BTCUSDT, cancelled its stop and disabled
      S-01, and wrote the `kill_switch` audit row. ETHUSDT was unchanged on
      Binance and was the only `untouched` entry.
    - Run 1 had listed the closed BTCUSDT in `untouched` too (cached
      snapshot); it was fixed before run 2.
    - Not checked live: the per-pair notification, because no LINE or
      Telegram channel was configured locally. Unit tests cover it.
    - The system position was opened with a local script (claimSignal +
      `Executor.enter`, as in the Demo integration test) rather than a
      market signal.
- **Deploy choices in S12 (Claude Code, 2026-10-08; the owner deployed
  with them on 2026-10-09):**
  - **The server serves the web build** (`apps/web/dist`, via
    `@fastify/static`) from the same origin as the API. The session cookie
    is `secure` and `sameSite=strict`, and the web calls relative `/v1`
    paths, so a separate web service on another host would break login.
    The server serves the build only when `apps/web/dist` exists, so dev
    (Vite proxy) and the HTTP tests are unchanged. `/v1/*` and `/health`
    still win, and an unknown `/v1` path is still a JSON 404. There is no
    SPA fallback because the web has no URL routes.
  - **Railway settings live in the dashboard, not in a file.** Railway
    deprecated `railway.json`/`railway.toml` ("Config as Code", legacy
    services until 2026-12-01). Its replacement (`.railway/railway.ts`)
    needs another dependency for one service. The README lists the exact
    values:
    - build: `pnpm install --frozen-lockfile && pnpm build`
    - pre-deploy: `node apps/server/dist/db-cli.js up`
    - start: `node apps/server/dist/main.js`, plain node with no `.env`
      line in the log (PR #16 review)
    - healthcheck: `/health`
  - **Migrations run as Railway's superuser; the server runs as a login
    user in `cane_app`.** `db-cli` reads `MIGRATION_DATABASE_URL`, falling
    back to `DATABASE_URL`, so the pre-deploy step can use the superuser
    while `DATABASE_URL` names the app user. The owner creates the login
    users (`cane_app`, and `cane_readonly` for S13) once in Railway's
    psql. The README gives the SQL with placeholder passwords; real
    passwords never go in a file.
  - **First deploy without trading.** `TRADING_ENABLED` stays unset until
    the owner has logged in, set LINE and Telegram, and saved the live
    key. That save is the one manual live B15.2 check: a key with
    Withdrawals on must be rejected. Then the owner sets
    `TRADING_ENABLED=true` and redeploys. The service must have only its
    Railway HTTPS domain and no TCP proxy (the `trustProxy` check).
  - **S12 live on Railway, 2026-10-09 (owner run). Proof passed except
    Telegram, which the owner sets up later.**
    - Railway's monorepo detection created two services (`@cane/web`,
      `@cane/server`). The owner deleted `@cane/web` and set the README
      values on `@cane/server`: start `node apps/server/dist/main.js`
      instead of the detected `pnpm --filter @cane/server start`, and the
      detected watch path `/apps/server/**` was cleared. One replica,
      serverless off, only the generated `*.up.railway.app` domain, no TCP
      proxy.
    - The first deploy failed in pre-deploy because no variables were set.
      After setting them, `migrate up: done` ran and the server started.
    - `/health` returned `{"status":"ok"}` and `/` showed Login (the web
      build is served).
    - The owner created `cane_server` (in `cane_app`) and `cane_replay` (in
      `cane_readonly`, for S13) and pointed `DATABASE_URL` at
      `cane_server`. `seed-owner` from the Railway dashboard Console and
      the first login both worked through that user.
    - LINE: the test message was delivered. Telegram is not set up yet, so
      `system_started` on Telegram is still open.
    - B15.2 (AC12) live check: the owner reports that a key with
      Withdrawals on was rejected. The error text was not recorded. The
      live key was then saved; only one `Settings changed: Binance key`
      notification was sent.
    - With `TRADING_ENABLED=true`: LINE got `[System started] env: live`,
      the log shows `engine started` with no ERROR or WARN, and the
      reconciler sent no notification. No strategy existed at that point,
      so the first reconcile had nothing to compare.
    - First strategy S-01: BTCUSDT USDⓈ-M futures, 5x, isolated, mode B,
      enabled with TOTP; status "waiting for signal", no notification.
    - Open follow-ups (PR #22 review):
      - Telegram: set it up and confirm a test message or
        `system_started` on Telegram.
      - Reconcile with a real position: after S-01 holds a position, note
        one restart (any redeploy) with the reconciler quiet and the stop
        still on Binance.
      - Error text not recorded: the B15.2 rejection text was not checked
        live against design.md item 19. Paste it here if a key is ever
        rejected again.
- **Replay isolation (owner OK 2026-09-28):** replay and the daily diff
  share only `packages/core` (rules) and read live records; they never
  load the order executor or keys, and use a read-only DB role.
- **Exchange is the source of truth** (B12). DB records intent and
  history; reconciler corrects the DB, never the reverse.
- **Idempotency** at two layers: DB unique key on the signal, and the
  deterministic client order ID `<strategy_id>-<candle_open_time>-<action>`
  queried before any resend.
- **Stops always on the exchange.** If the server dies, stops remain.
  Rollback therefore never needs to touch open positions.
- **Candle source:** REST klines after close (plus a short grace delay),
  not the kline websocket, to guarantee closed candles only. Websocket
  only for user data (fills) and mark price display.
- **Correctness of indicators (AC1–2, spec rev 5.1):** unit tests encode
  the spec Definitions (EMA seeding, Wilder ATR, all trail branches, regime
  transitions) on hand-built series. No TradingView export (owner
  decision). Accepted risk: a subtle difference from the Pine reference
  (e.g. EMA seed) would not be caught before live; mitigated by the replay
  report the owner can eyeball against charts, and by AC3 in production.
- **Feature flag:** env `TRADING_ENABLED` (default `false`) gates every
  order-placing call in addition to per-strategy enable. `BINANCE_ENV`
  (`testnet` default | `live`) selects endpoints. Both documented in
  README.
- **Separation of duties:** the owner is the only human. Each PR is
  written by one Claude session and reviewed by a separate session
  (REVIEW.md checklist) before the owner merges. Claude never merges.

## Risks
| Risk | Mitigation |
|---|---|
| Futures conditional orders moved to the **Algo Order API** (cutover 2025-12-09; old `STOP_MARKET` on `/fapi/v1/order` fails with -4120). Algo orders use their own IDs and query/cancel endpoints | Build stops on the Algo Order endpoints from day one; map `clientAlgoId` to our deterministic ID; reconciler queries open algo orders too. Re-verify docs at step 5 |
| Spot stop + TP both lock the same balance | OCO order list for spot late entries; plain STOP_LOSS otherwise |
| Unrestricted API key (amendment 1): a leak can trade from anywhere | Withdrawals + universal transfer off (checked on save); key encrypted with env master key; never logged (log-scan test); Railway env access limited to owner; rotate key on any suspicion |
| Wrong trade from a logic bug | Formula unit tests (AC1–2), testnet integration tests (steps 5–6, 11), `TRADING_ENABLED` flag, exchange-side stops cap loss per position. No soak and no Pine parity check (owner decision): first live trades are the first real-world check |
| Indicator differs from the Pine reference | Accepted risk (owner, 2026-09-28); replay report for owner review before enabling strategies |
| Jev model changes behaviour (`jev-latest` moves) | Pin model version; store model string per call |
| No DB backup (owner skipped, 2026-09-28) | Positions and orders recoverable from Binance (source of truth); trade history, Jev records and audit log would be lost. Accepted risk; revisit if Railway backups become available on the plan |
| Railway Hobby: single instance, restarts, platform outage | Restart-safe state; reconciler on start; stops on exchange; `system_started` notification after every restart |
| Binance rate limits / outage (E3) | Weight-aware client, back-off, no new entries while unavailable |
| Jev early-access API changes or goes away | Typed validation; any failure = base size (B8.4); Jev never gates exits |
| Liquidation before stop | B9.2 check with 1% buffer; isolated margin default |
| Kline not final right at close | Grace delay + verify `closeTime < now` and candle count before evaluating |
| Public repo leaks config or data | gitignore, gitleaks pre-commit + CI, push protection; fixtures contain public market data only |
| Precision errors | `decimal.js` only; ESLint rule forbids arithmetic on `number` in money modules; DB `numeric` |

**Rollback in 15 minutes:** (1) Kill switch in the UI — cancels system
orders, closes system positions, disables strategies. (2) Or without the
UI: set `TRADING_ENABLED=false` on Railway (redeploy < 2 min) — no new
orders; existing exchange stops keep protecting positions. (3) Bad
deploy: Railway "rollback to previous deployment". DB migrations are
forward-only but additive (no destructive change in the same release as
the code that needs it).

## Out of scope (this plan)
Everything listed as Out in spec.md; also: horizontal scaling, a second
exchange, mobile Strategies/Settings screens (spec B16.10), backtest
optimisation.

## Proof (maps to spec Acceptance criteria)
| AC | Proof | Where |
|---|---|---|
| 1 | `cdc-action-zone.test.ts` (formula cases) + replay report BTC/ETH/SOL ≥ 2 y | step 1 |
| 2 | `cdc-trail.test.ts`: all three branches, Wilder ATR | step 1 |
| 3 | Daily replay-diff job, 30 days live; `live-log.md` explains every diff | step 13 |
| 4 | `evaluate.test.ts`: open candle → no decision | step 1 |
| 5 | Integration: same signal twice → one order (DB unique + client ID) | step 5 |
| 6 | Reconciler test on testnet incl. crash mid-entry | step 6 |
| 7 | `size.test.ts` table: A/B/C × 0–3 factors × lev 1/5; property test: qty ≤ free balance, multiple of step | step 2 |
| 8 | `leverage.test.ts`: 5x liquidation inside stop → lower lev or skip | step 2 |
| 9 | `jev.client.test.ts`: timeout / error / bad shape → base size + `jev_fallback` | step 7 |
| 10 | Testnet E2E: kill switch; manual position untouched | step 11 |
| 11 | Auth tests + log-scan test | step 8 |
| 12 | Key with withdrawal permission rejected (mocked Binance permission API; Demo has no permission API, so one manual check with the live key at go-live) | step 8, step 12 |
| 13 | CI run on a throwaway branch with a fake key fails at gitleaks | step 0 |
| 14 | `flip.test.ts`: all cases in AC14 both directions | step 3 |
Plus: `pnpm lint && pnpm typecheck && pnpm test` green on every PR;
Playwright smoke + owner screenshot review for the UI.

## Open questions
1. ~~GitHub repo name and account~~ — resolved 2026-09-29: repo
   `github.com/Olympus-Work/cane`; owner allowed pushing branches and
   opening PRs (owner merges).
2. ~~Formal approval of this plan~~ — resolved 2026-09-29: owner approved
   plan rev 3 (Status line) before S05.

Resolved 2026-09-28 (owner): TypeScript + NestJS; Jev docs =
docs.typesafe.ai, key ready (Railway env only), limits ~1,200 RPM /
~250k tokens/s; no TradingView parity export; no testnet soak; spec E10
fixed (rev 5.1); replay isolation; first live strategy BTCUSDT futures;
no DB backup; default Railway domain.
