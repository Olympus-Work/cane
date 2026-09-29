# Cane

Cane is a personal, single-user auto-trader for Binance Spot (long only) and USD-M Futures (long and short). It trades the CDC Action Zone (EMA 12/26) and CDC ATR trailing stop on 1W/1D/4H closed candles, with confluence factors classified by the Jev API (TypeSafe System One). It includes a web UI for monitoring, strategies, a kill switch and settings.

## Disclaimer

> **Not financial advice. Use at your own risk.**
>
> This software places real orders with real money, fully automatically. It can lose all capital in the account. There is no warranty (see LICENSE). The authors are not responsible for losses. Test on Binance testnet first. You are responsible for whether you may legally use Binance in your country.

## Status

Cane is under active development. See `intent/cane-auto-trader/plan.md` for the step-by-step plan. It is not ready for live trading.

## Repository layout

- `packages/core` — pure trading rules: indicators, signals, sizing, risk; no I/O.
- `packages/shared` — API types shared by server and web.
- `apps/server` — NestJS + Fastify: engine, Binance adapter, Jev client, auth, notifications, CLI.
- `apps/web` — React + Vite UI.
- `intent/cane-auto-trader` — intent, spec, plan, design; the source of truth for behaviour.

## Requirements

- Node.js 22 LTS or newer.
- pnpm (via `corepack enable pnpm`; version pinned in package.json `packageManager`).
- gitleaks 8.x on PATH (required by the pre-commit hook).
- PostgreSQL (later steps).

## Setup

```sh
corepack enable pnpm
pnpm install
```

`pnpm install` also installs the git pre-commit hook via `core.hooksPath=.githooks`.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Database

PostgreSQL. Schema: `apps/server/src/db/schema.ts` (Drizzle). SQL migrations: `apps/server/src/db/migrations/`, with a hand-written revert per migration in `migrations/down/<tag>.sql`.

Local test database with Docker:

```sh
docker run -d --name cane-pg-test -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm --filter @cane/server test
```

Migration tests are skipped when `DATABASE_URL` is unset, except in CI where it is required. The test drops and recreates the `public` schema, so never point it at a real database.

After editing `schema.ts`: `pnpm --filter @cane/server db:generate`, then write the matching `down/<tag>.sql`.

Run migrations: `pnpm --filter @cane/server build` then `pnpm --filter @cane/server db:migrate up` or `db:migrate down [steps]`.

Roles: `cane_app` (the server; audit_log is SELECT + INSERT only) and `cane_readonly` (replay and daily replay-diff; SELECT on trading records and candles only). Both are NOLOGIN group roles; login users are created at deploy. A trigger also blocks UPDATE, DELETE and TRUNCATE on audit_log for every user. Every migration that adds a table must also GRANT it to these roles.

## Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| TRADING_ENABLED | false | Master switch. When not `true`, no order-placing call is made, in addition to per-strategy enable. |
| BINANCE_ENV | testnet | `testnet` or `live`; selects Binance endpoints. |
| CANE_MASTER_KEY | (none) | Key used to encrypt secrets stored in the database. Set only in the hosting environment. Never commit it. |
| TYPESAFE_API_KEY | (none) | Jev API key. Hosting environment only. |
| PORT | 3000 | HTTP port. |

Binance API keys and LINE/Telegram tokens are entered in the web UI Settings and stored encrypted; they are never put in environment files or the repository.

## Security

- This is a public repository. Security must not depend on secrecy of the code.
- gitleaks runs in the pre-commit hook and in CI.
- GitHub push protection is enabled.
- Never commit keys, account IDs, balances, trade history or personal config.
- Use a Binance API key with withdrawals and universal transfer disabled.

## License

GNU Affero General Public License v3.0 (AGPL-3.0-only). If you run a modified version as a network service you must publish your source. See LICENSE.
