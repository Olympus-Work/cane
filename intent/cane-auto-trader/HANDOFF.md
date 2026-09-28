# Handoff: Cane auto-trader → Claude Code (2026-09-28)
Owner: Zong. Status: Stage 2 spec **approved** (rev 5.1). Stage 3 plan
**rev 3, handed to Claude Code** — formal approval still pending (see below).
Process: AI-native SDLC (intent → spec → plan → build/proof → PR → maintain).

## Where things are
Folder: `C:\Users\Zong\Desktop\cane-system\` (not a git repo yet).

| File | Stage | Status |
|---|---|---|
| `intent/cane-auto-trader/intent.md` | 1 Intent | approved 2026-09-25; amendment 1 (no IP whitelist) approved 2026-09-28 |
| `intent/cane-auto-trader/spec.md` | 2 Spec | **approved** rev 5.1, 2026-09-28 — source of truth for behaviour |
| `intent/cane-auto-trader/plan.md` | 3 Plan | rev 3 draft; steps S00–S13, proof per step |
| `intent/cane-auto-trader/design.md` | UI summary + change log | round 3, final |
| `intent/cane-auto-trader/design_handoff_cane_auto_trader/` | UI handoff (README, prototype, tokens) | round 3, final |
| `cdc_action_zone.pine`, `cdc_trailing_stop.pine`, `uncle-chaloke-trading-skill.md` | reference only | **never commit** — re-implement logic from spec Definitions |

## Decisions already made (do not re-ask)
- Stack: TypeScript end to end; backend **NestJS** (Fastify adapter);
  React + Vite frontend; Postgres + Drizzle; decimal.js (no float money).
- Hosting: Railway **Hobby**, default `*.up.railway.app` domain, no DB
  backup (accepted risk), no static IP → Binance key without IP whitelist
  (withdrawals + universal transfer off; spot + futures trading on).
- Jev: TypeSafe System One, `POST https://api.typesafe.ai/v1/systemone`,
  Bearer `TYPESAFE_API_KEY` (env only), 3 Noul questions per signal,
  model pinned; limits ~1,200 RPM / ~250k tokens/s.
- No TradingView parity export (AC1–2 = formula unit tests + replay report).
- No testnet soak: go live after build. Testnet still used for integration
  tests (S05, S06, S11).
- Replay/daily diff: share `packages/core` only; never load the executor or
  keys; read-only DB role.
- First live strategy: **BTCUSDT USDⓈ-M futures** (5x ceiling, isolated,
  mode B).
- Leverage max 20x; heatmap day boundary Asia/Bangkok.

## Still open (ask the owner when it becomes blocking)
1. GitHub repo name/account — needed before first push (S00 can start with
   local `git init`).
2. Formal plan approval — get it before S05 (first exchange work).
3. Owner prep: Binance Spot + Futures **testnet** keys (S05); LINE Official
   Account + Messaging API channel and Telegram bot (S09); Railway project
   + Postgres (S12).

## Next steps for Claude Code
1. Read spec.md, plan.md, design.md (+ handoff README) in full.
2. Start **S00** (local repo, guardrails, monorepo skeleton), then **S01**
   (indicators + signal engine + replay CLI) — both need no keys, no
   exchange, no money.
3. One step = one branch/PR; proof from plan.md must pass before the next
   step. A separate session reviews; the owner merges. Never self-merge.
4. Update the ClickUp task for each step (status + PR link).

## ClickUp tasks (space Cane, list 1100270000007470)
S00 z8p29867qd · S01 z8p29867qe · S02 z8p29867qf · S03 z8p29867qg ·
S04 z8p29867qh · S05 z8p29867qj · S06 z8p29867qk · S07 z8p29867qm ·
S08 z8p29867qn · S09 z8p29867qp · S10 z8p29867qq · S11 z8p29867qr ·
S12 z8p29867qt · S13 z8p29867qu  (Sxx = plan.md step number)

## Working notes
- Talk to the owner in **Thai**; write artifacts and code in **English**.
- Never put real keys, account IDs, balances or trade history in any file,
  commit, chat or ClickUp task.
- Binance USDⓈ-M stops must use the **Algo Order API** (old STOP_MARKET on
  /fapi/v1/order fails with -4120 since 2025-12-09). Spot late entry with
  TP uses OCO.
- If code reality contradicts plan.md, stop and update plan.md first.
- End each reply with: `Artifact / Open questions / Next gate`.
