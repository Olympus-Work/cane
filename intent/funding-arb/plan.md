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
- **F02 Backtest / replay CLI.** Detail added when F02 starts.
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

## Risks
- `/fapi/v1/fundingRate` shares a 500 requests / 5 min / IP limit. A 2-year backfill is
  ~3 pages per symbol; each settlement costs 1 `fundingRate` + 1 `premiumIndex` request
  per symbol plus 1 `fundingInfo`, and a few retries while it is not published. Far
  below the limit.
- History older than Binance keeps, or a symbol listed less than 2 years ago, makes the
  coverage check fail; `check` reports it per symbol and the owner decides.

## Open questions
None open for F01. Resolved: live sync runs right after each settlement, not on a fixed
15-minute timer (owner, 2026-10-15).
