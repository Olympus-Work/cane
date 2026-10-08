# Cane

Cane is a personal, single-user auto-trader for Binance Spot (long only) and USD-M Futures (long and short). It trades the CDC Action Zone (EMA 12/26) and CDC ATR trailing stop on 1W/1D/4H closed candles, with confluence factors classified by the Jev API (TypeSafe System One). It includes a web UI for monitoring, strategies, a kill switch and settings.

## Disclaimer

> **Not financial advice. Use at your own risk.**
>
> This software places real orders with real money, fully automatically. It can lose all capital in the account. There is no warranty (see LICENSE). The authors are not responsible for losses. Test on Binance Demo Trading (demo.binance.com) first. You are responsible for whether you may legally use Binance in your country.

## Status

Cane is under active development. See `intent/cane-auto-trader/plan.md` for the step-by-step plan. It is not ready for live trading.

## Repository layout

- `packages/core` — pure trading rules: indicators, signals, sizing, risk; no I/O.
- `packages/shared` — API types shared by server and web.
- `apps/server` — NestJS + Fastify: engine, Binance adapter, Jev client, auth, notifications, CLI.
- `apps/web` — React + Vite UI.
- `intent/cane-auto-trader` — intent, spec, plan, design; the source of truth for behaviour.

## Requirements

- Node.js 24 LTS or newer.
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

## Binance Demo integration tests

`pnpm --filter @cane/server test:integration` places small real orders on the Binance Demo Trading account (spot and USDⓈ-M BTCUSDT) and checks entry → stop → trail move → exit, the OCO late entry, and "no exit when already closed". With `DATABASE_URL` set it also runs the engine against Demo + Postgres: an entry killed right after its send is finished by the reconciler (AC6), a missing stop is re-placed, and positions closed or opened outside the system are flagged. It reads the Demo keys from `apps/server/.env` and is skipped without them. It is not part of `pnpm test` or CI. It cancels what it placed; a failed run can leave a small Demo position or order to clean up by hand.

## Configuration (environment variables)

For local development copy `apps/server/.env.example` to `apps/server/.env` (git-ignored). The `start`, `owner` and `db:migrate` scripts of `@cane/server` load it (`node --env-file-if-exists=.env`; real environment variables win, and a missing file is fine in production). Run the server with `pnpm --filter @cane/server start`, and the owner CLI with `pnpm --filter @cane/server run owner ...` (`run` is needed because `pnpm owner` is a built-in pnpm command). Plain `node dist/main.js` does not read the file. The Binance Demo Trading keys in it are read by integration tests only. The replay script does not load it, by design.

| Variable | Default | Meaning |
| --- | --- | --- |
| TRADING_ENABLED | false | Master switch. When not `true`, no order-placing call is made, in addition to per-strategy enable. |
| BINANCE_ENV | testnet | `testnet` (Binance Demo Trading) or `live`; selects Binance endpoints. |
| CANE_MASTER_KEY | (none) | Key used to encrypt secrets stored in the database: 32 bytes as base64 or 64 hex characters (`openssl rand -base64 32`). The server will not start without it. Set only in the hosting environment. Never commit it. |
| CANE_OWNER_PASSWORD | (none) | Read only by the owner CLI (`seed-owner`, `reset-password`); never a command-line argument. Min 12 characters. |
| TYPESAFE_API_KEY | (none) | Local-development fallback for the Jev key; the key saved in Settings wins. |
| JEV_MAX_RETRIES | 0 | Extra Jev attempts on network error, 429 or 5xx, inside the one 3 s budget. |
| JEV_MAX_CONCURRENCY | 0 | Cap on in-flight Jev calls; 0 = no cap. |
| PORT | 3000 | HTTP port. |

Binance API keys and LINE/Telegram tokens are entered in the web UI Settings and stored encrypted; they are never put in environment files or the repository.

## Owner account (CLI)

There is no sign-up route. After migrating, create the single owner and print the authenticator secret and recovery codes (shown once):

```sh
pnpm --filter @cane/server build
CANE_OWNER_PASSWORD='<12+ characters>' pnpm --filter @cane/server owner seed-owner --email you@example.com
```

`owner reset-password` (also uses `CANE_OWNER_PASSWORD`) and `owner reset-totp` are the only ways to reset a password or authenticator; both sign every session out. On Railway run them with the Railway CLI. Login needs email + password + a 6-digit code; a TOTP code can be used once, so two actions in the same 30 s window need two different codes.

## Web app (development)

One command for server + web: `pnpm dev` (builds the server and its workspace packages, then runs `@cane/server start` and `@cane/web dev` in parallel). Stop any server already holding port 3000 first. Needs the Database and owner steps below done once.

The web app is React + Vite in `apps/web` (fonts and icons are self-hosted; no third-party CDN). Login and Settings exist so far; Dashboard, Strategies and Kill switch follow.

1. Start Postgres and migrate (see "Database"), then seed the owner (see "Owner account (CLI)").
2. Start the server: `DATABASE_URL=... CANE_MASTER_KEY=<32 bytes base64> pnpm --filter @cane/server build && node apps/server/dist/main.js` (port 3000; the trading engine stays off unless `TRADING_ENABLED=true`).
3. Start the web app: `pnpm --filter @cane/web dev` and open http://localhost:5173. Vite proxies `/v1` to the server. The session cookie is `Secure`; browsers accept it on `localhost`.

Browser smoke tests (mocked API): `pnpm --filter @cane/web e2e` (set `PW_CHANNEL=msedge` to use an installed Edge). Screenshots land in `apps/web/e2e/screenshots/` for comparison with the design prototype.

## Security

- This is a public repository. Security must not depend on secrecy of the code.
- gitleaks runs in the pre-commit hook and in CI.
- GitHub push protection is enabled.
- Never commit keys, account IDs, balances, trade history or personal config.
- Use a Binance API key with withdrawals and universal transfer disabled.

## License

GNU Affero General Public License v3.0 (AGPL-3.0-only). If you run a modified version as a network service you must publish your source. See LICENSE.
