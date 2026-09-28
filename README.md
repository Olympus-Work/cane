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
