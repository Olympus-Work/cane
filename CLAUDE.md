# CLAUDE.md

Before changing code, read `intent/cane-auto-trader/spec.md` (behaviour, source of truth) and `plan.md` (steps + proof).

## Commands

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @cane/core test
```

`pnpm --filter @cane/core test` runs tests for one package.

## Layout and boundaries

- All trading rules live in `packages/core` as pure functions: no I/O, no Nest, no clock, no env.
- `apps/server` is a thin NestJS shell that calls core.
- The replay CLI and the daily replay-diff must never load the order executor, the Binance trading module or API keys.
- ESM everywhere — relative imports end in `.js`.

## Conventions

- TypeScript strict.
- Money, prices and quantities use decimal.js (never JS number arithmetic) and DB `numeric`.
- Candle times are UTC milliseconds.
- Only closed candles are evaluated.
- Every order carries a deterministic client order ID: `<strategy_id>-<candle_open_time>-<action>`.
- Binance USD-M stops use the Algo Order API (old STOP_MARKET on `/fapi/v1/order` fails with -4120).
- Spot late entries with take-profit use OCO.
- Tests use Vitest, next to each package in `test/`.

## Process

- One plan step = one branch = one PR.
- The step's proof in plan.md must pass before the next step.
- A separate session reviews.
- The owner merges — agents never merge.
- If code reality contradicts plan.md, update plan.md first.
- Code and artifacts are in English.

## Never

- Commit `*.pine`, `uncle-chaloke-*.md` or anything under `reference/`.
- Put real keys, secrets, account IDs, balances or trade history in any file, commit, log, test fixture, notification or issue tracker.
- Log secrets or return them to the browser.
- Skip or bypass the gitleaks hook (`--no-verify`) except the documented AC13 proof on a throwaway branch.
- Place orders from unclosed candles.
- Set `TRADING_ENABLED=true` or `BINANCE_ENV=live` outside the production deploy.
