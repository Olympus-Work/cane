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

Money-affecting: yes (real capital, full auto). Repo holds only an initial
README commit; every path below is new.

## Tech stack (owner confirmed TypeScript + NestJS, 2026-09-28)
| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript end to end (Node 22 LTS) | One language for engine, API and UI; shared types between server and web; design suggests React + TS |
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
   probability of yes; `present` = probability ≥ threshold (0.70). Model
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
10. **Web app.** Rebuild screens from the design handoff (not copy the
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
| 12 | Key with withdrawal permission rejected (mocked Binance permission API + one testnet check) | step 8 |
| 13 | CI run on a throwaway branch with a fake key fails at gitleaks | step 0 |
| 14 | `flip.test.ts`: all cases in AC14 both directions | step 3 |
Plus: `pnpm lint && pnpm typecheck && pnpm test` green on every PR;
Playwright smoke + owner screenshot review for the UI.

## Open questions
1. ~~GitHub repo name and account~~ — resolved 2026-09-29: repo
   `github.com/Olympus-Work/cane`; owner allowed pushing branches and
   opening PRs (owner merges).
2. Formal approval of this plan — owner deferred and handed work to
   Claude Code on 2026-09-28. Ask the owner to approve (Status line) before
   any step that touches the exchange (S05+).

Resolved 2026-09-28 (owner): TypeScript + NestJS; Jev docs =
docs.typesafe.ai, key ready (Railway env only), limits ~1,200 RPM /
~250k tokens/s; no TradingView parity export; no testnet soak; spec E10
fixed (rev 5.1); replay isolation; first live strategy BTCUSDT futures;
no DB backup; default Railway domain.
