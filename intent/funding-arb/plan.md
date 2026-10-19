# Plan: funding-rate arbitrage (from intent/funding-arb/spec.md, draft 2026-10-14)
From: intent/funding-arb/intent.md (approved by Zong, 2026-10-14); spec.md (draft,
B1–B60, thresholds set after F02).
Author: Claude Code (drafted for owner review). Approver: Zong (owner).
Status: draft (2026-10-15). F01 is detailed; later steps get their detail in the PR that
starts them, with this file updated first.
Tracking: ClickUp space "Cane", list "List", tasks F00–F17.

Money-affecting: yes, from F03 on. F01 and F02 read public market data only and never
load the order executor, the Binance trading module or API keys.

## Order of work
One step = one branch = one PR. A step's proof passes before the next step starts.

- **F00 Intent + spec.** Done for the intent (approved 2026-10-14). The spec moves to
  `approved` after F02 fills in its (proposed) numbers.
- **F01 Funding data ingestion: history + live.** Detail below.
- **F02 Backtest / replay CLI.** Detail below.
- **F03–F17.** Detail added when each starts. No order-placing step (F03, F05, F06)
  starts before the spec is approved.

## F01: funding data ingestion
Spec: B1–B3, Data `funding_rate`, Interfaces `/fapi/v1/fundingRate`,
`/fapi/v1/premiumIndex`, `/fapi/v1/fundingInfo`. Ticket: z8p2987e23.

### What it builds
1. **Core (`packages/core/src/funding.ts`), pure functions:**
   - `fundingApr(rate, intervalHours)` = `rate × (24 / interval_hours) × 365` (B3),
     decimal.js in and out.
   - `withIntervals(times)`: assigns each settled funding event its interval, read from
     the exchange's own timestamps: the gap to the previous event (the first event takes
     the gap to the next one). This is how B2 "read from the exchange, never assumed 8h"
     is met for history, where `/fapi/v1/fundingRate` returns no interval field.
   - `fundingGaps(events, from, to)`: the gap check (see "Gap rule").
2. **DB migration `0004_funding_rate`:** table `funding_rate` (symbol, funding_time UTC ms,
   rate numeric, mark_price numeric null, interval_hours integer), primary key
   (symbol, funding_time). Grants: `cane_app` read/write, `cane_readonly` read (F02's
   backtest reads through the read-only role, like the replay). Down file drops it.
3. **Server `src/funding/`:**
   - `FundingClient`: public REST only (no key, no signature), same fetch/retry/back-off
     pattern as `KlinesClient`. `fundingHistory(symbol, from, to)` pages
     `/fapi/v1/fundingRate` (limit 1000, startTime/endTime); `premiumIndex(symbol)`
     returns the predicted rate and next funding time; `fundingInfo()` returns the
     symbols whose interval or caps were adjusted.
   - `FundingStore`: upsert by (symbol, funding_time), read a symbol's range, latest row.
   - `FundingSync.sync(symbol, from, now)`: fetches the settlements after the newest
     stored event (everything from `from` when the table is empty) and gives them
     intervals continuing from that event; when `from` is older than the oldest stored
     event it also fills that earlier history. Upserts; re-running it adds nothing.
   - The retry/back-off GET that `KlinesClient` had is moved to
     `market-data/public-get.ts` and shared by both clients (no behaviour change).
4. **CLI `funding-cli.js`** (`pnpm --filter @cane/server funding`):
   `backfill --symbols BTCUSDT,ETHUSDT --days 730` and
   `check --symbols BTCUSDT,ETHUSDT --days 730` (row count, first/last time, interval
   changes, gaps; exit code 1 when any gap). DB: `DATABASE_URL`. README "Deploy" step 9
   has the commands. The CLI module loads
   only the funding and DB modules, never trading, settings or keys (isolation test,
   like the replay-diff's).
5. **Live sync inside the server** (owner, 2026-10-15: right after each settlement):
   `FundingSyncScheduleModule` ticks every minute for the symbols in
   `FUNDING_SYNC_SYMBOLS` (comma list). Unset = off, which is the default until the
   strategy exists. A symbol syncs once at start, then at the next settlement time
   announced by `/fapi/v1/premiumIndex` plus 60 s. If that settlement is not published
   yet it retries every minute, for up to 30 minutes, then logs a warning and moves on
   to the next settlement. A failed request backs off 5 minutes. Failures are logged and
   never touch trading. After a sync it cross-checks the newest interval against
   `/fapi/v1/fundingInfo` and logs a warning when they differ.

### Gap rule
Binance settles funding every 1, 2, 4 or 8 hours per symbol, and a symbol's interval
can change. Funding times are compared after rounding to the minute (some historic
events carry a few ms of offset). Between two consecutive stored events with gap `d`:
- `d` is not one of 1, 2, 4, 8 hours → **gap**.
- `d` is a multiple (2× or more) of the gap before it **and** of the gap after it, and
  those two are equal → **gap** (one or more events missing inside a steady interval;
  a real interval change lasts longer than one event).
- Coverage: the first event must be within one interval of `from`, the last within one
  interval of `to` (minus the time not yet settled).

### Proof (F01)
- Unit tests: `fundingApr` (8h, 4h, 1h, negative rate), `withIntervals`, `fundingGaps`
  (steady 8h, change 8h→4h, one event missing, ms offsets, coverage at both ends).
- Client tests on recorded Binance response shapes: paging across 1000-row pages, empty
  `markPrice` in old rows, 429 with Retry-After, 4xx error.
- DB: migrate up/down test updated (new table, grants for both roles).
- Sync test on Postgres: first run backfills, second run is a no-op, an interval change
  is stored on the new rows only.
- Isolation test: the funding CLI context has no order-placing, settings or key provider.
- **Owner run (needs Binance access, not reachable from the CI sandbox):**
  `funding backfill` then `funding check` for BTCUSDT and ETHUSDT over 730 days on a
  dev database; the `check` output (row counts, first/last time, no gaps) is pasted into
  the F01 PR and ClickUp. This is AC1.

### Not in F01
- Storing predicted funding or `premiumIndex` snapshots (no spec field needs it yet;
  F10 reads it live).
- Choosing symbols from the whitelist (F15). Until then `FUNDING_SYNC_SYMBOLS` lists them.
- Any order, account or keyed endpoint.

## F02: backtest / replay CLI
Spec: B3–B6, B14, B17 (evidence only), B23, B26–B27.5, AC2, Open questions 2 and 3.
Started 2026-10-19 (owner: "start F02"). Choices below are Claude Code's and await the
owner's OK in the PR.

### What it builds
1. **Core (`packages/core/src/funding/arb.ts`), pure functions** that F10 (live) will
   reuse, so backtest and live share one definition (B27):
   - `avgFundingApr(events, n)`: mean of `fundingApr(rate, interval_hours)` over the last
     `n` settled events; `null` with fewer than `n`.
   - `roundTripCostPct(costs)` = 2 × spot fee + 2 × perp fee + slippage allowance (B6).
   - `breakevenDays(costPct, avgApr)` = `costPct / (avgApr / 365)`; `null` when
     `avgApr <= 0` (B5).
   - `arbEntry(events, params, costs)` (B4 + B5) and `arbExit(events, params)` (B14), each
     with a reason.
   - `capitalUsed(notional, leverage, costs, bnbTrades)` = spot notional + perp margin +
     BNB buffer (B26, B23) and `netApr(netPnl, capital, days)` = `net / capital × 365 / days`.
   - `simulateArb(input)`: walks the settled events of one symbol (model below) and
     returns the pairs with their PnL parts and margin stress.
2. **Kline interval `1h`** for market data only: `KlinesClient` and `KlineCache` accept
   `1h` (type `KlineInterval`). The core `Timeframe` of the directional strategy is
   unchanged.
3. **Server `src/funding-backtest/`:** `FundingBacktestService` reads `funding_rate`
   through the read-only `cane_replay` user (`REPLAY_DATABASE_URL`, as the replay-diff)
   with the F01 `FundingStore`, loads spot and USDⓈ-M 1h klines from the public
   `KlineCache`, runs `simulateArb` for every parameter set and symbol, and
   `formatBacktestReport` writes Markdown. The module has its own read-only pool and never
   imports `DbModule`, trading, settings or keys (isolation test).
4. **CLI `funding-backtest-cli.js`** (`pnpm --filter @cane/server funding-backtest`):
   `--symbols BTCUSDT,ETHUSDT --days 730` plus comma lists that form a grid (every
   combination is one parameter set): `--n 3,9,21 --entry-apr 5,10,15 --exit-apr 0,3
   --k 3 --breakeven-days 10`. Costs and risk: `--spot-fee 0.075 --perp-fee 0.045
   --slippage 0.05 --leverage 2 --mmr 0.5 --bnb-trades 10 --notional 10000`. Percent
   options are in % (APR in % / yr). `--out <file>` writes the report instead of stdout.
   The defaults are those values (18 parameter sets).

### Model
- **Decision points:** every settled funding event, right after it settles. Decisions
  start once `N` events exist in the window.
- **Entry (B4, B5):** flat, `avg_funding_apr(N) >= entry_apr_min`, last rate > 0, and
  `breakevenDays <= max_breakeven_days`. Both legs fill at the open of the 1h candle of
  that settlement hour (spot and perp each at its own price). That settlement's funding is
  not earned.
- **Size:** `notional / spot price` for both legs (same quantity, delta-neutral). No
  step-size rounding; the backtest is about rates, not filters.
- **Funding (B13):** each later settlement pays the short `qty × mark × rate` (negative
  rate = the short pays). Mark = the row's `mark_price`, else the perp 1h open.
- **Exit (B14):** at a settlement, `avg_funding_apr(N) < exit_apr_min` or the last `K`
  rates are all negative. Both legs close at that hour's 1h opens; that settlement was
  earned.
- **Costs (B6):** each fill pays its fee on its notional (spot fee on spot fills, perp
  fee on perp fills); half the round-trip slippage allowance at entry, half at exit. The
  defaults are the spec's BNB-discounted reference with perp at the taker rate
  (conservative; B9 tries maker first).
- **Basis PnL (B26):** spot PnL + perp PnL excluding funding.
- **Capital used (B26):** notional + notional / leverage + BNB buffer, where the buffer is
  `bnb_buffer_trades × 2 fills × notional × fee` per wallet (B23). It counts for the
  **whole window**, flat or not: the capital is reserved for the strategy, which is the
  fair comparison with holding USDT (B27.5). Net APR = `net / capital used × 365 / days`.
  Everything scales with `notional`, so the APR does not depend on it.
- **Margin stress (B17, spec Open question 3):** while a pair is open, the highest perp
  1h high gives the worst margin ratio `qty × high × mmr / (qty × entry / leverage +
  qty × (entry − high))` (≥ 100% when the margin is gone) and the max adverse move. The
  report shows both per pair and counts pairs that would cross L1/L2/L3 (40/60/80%,
  proposed). No rebalance is simulated, so the numbers are the worst case without one.
- **Open at the window end:** marked to market at the last 1h close with exit costs, and
  flagged `open`.
- **Data holes:** funding gaps (F01 `fundingGaps`) are listed in the report. A settlement
  without a 1h candle on either market makes no decision (an open pair stays open, its
  funding uses the mark price or the last perp price); the count is in the report.

### Report
Assumptions, then per symbol the data loaded (funding rows, interval changes, gaps,
missing candles). Then one table of all parameter sets ranked by combined net APR (all
symbols together), with per-symbol rows: pairs, days in a pair %, funding, fees,
slippage, basis, net, net APR, hurdle met (≥ 6%, B27.5), worst margin ratio. Then the
pairs and margin stress of the top-ranked set that meets the hurdle (else the top set).
Money in USDT, 2 decimals; rates in %.

### Proof (F02)
- Core unit tests: `avgFundingApr`, `roundTripCostPct`, `breakevenDays`, every entry and
  exit reason, and `simulateArb` on hand-made series (opens after N, funding sign and
  mark fallback, exit on APR and on K negatives, fees and slippage, basis, open at end,
  missing candle, margin ratio, capital used, net APR).
- Server tests: the service on a fake store and fake klines (2 symbols × 3 parameter
  sets → ranking, hurdle flag, gaps listed), CLI option parsing, and an isolation test:
  the backtest context has no `DbModule` and no order-placing, settings or key provider.
- **Owner run (AC2; needs the F01 data and Binance public access):**
  `REPLAY_DATABASE_URL=… pnpm --filter @cane/server funding-backtest --out
  intent/funding-arb/backtest-report.md` with the defaults. The report is committed in
  this PR. The owner picks the set; its `entry_apr_min`, `exit_apr_min`, N, K and
  `max_breakeven_days` go into spec.md (B4, B5, B14, B48) and lose their **(proposed)**
  tag. The L1/L2/L3 values follow from the margin stress table.

### Not in F02
- Scanner score weights, liquidity thresholds and `min_consistency` (spec Open
  question 8): liquidity needs order-book depth, which has no history, and the score
  needs the F14 scanner. Proposed: move them to F14 (owner question 1 below).
- Execution choices (leg order, maker timeout, retries): testnet in F05.
- Simulating the L2 rebalance or the BNB price risk of the buffer.

## Risks
- `/fapi/v1/fundingRate` shares a 500 requests / 5 min / IP limit. A 2-year backfill is
  ~3 pages per symbol; each settlement costs 1 `fundingRate` + 1 `premiumIndex` request
  per symbol plus 1 `fundingInfo`, and a few retries while it is not published. Far
  below the limit.
- History older than Binance keeps, or a symbol listed less than 2 years ago, makes the
  coverage check fail; `check` reports it per symbol and the owner decides.

- F02: the first backtest run fetches the full 1h kline history of each symbol on both
  markets (about 140 public requests for BTC and ETH). It is cached under `data/klines/`
  like the replay's, so later runs fetch only new candles.

## Open questions
None open for F01. Resolved: live sync runs right after each settlement, not on a fixed
15-minute timer (owner, 2026-10-15).

F02 (owner):
1. Scanner score weights, liquidity thresholds and `min_consistency` move from F02 to
   F14 (see "Not in F02")?
2. Capital used counts for the whole window, flat or not (see Model). OK?
3. The per-coin capital cap (B7, B34) is read as the notional of each leg. OK?
