# Spec: funding-rate arbitrage strategy (v1)
From: intent/funding-arb/intent.md (draft 2026-10-14; must be approved first). Status: draft.
Author: Zong (owner). Approver: TBD (owner sign-off required; money-affecting).
Ticket: [F00] z8p2987e22. Build tickets: F01–F17.
Design: `intent/funding-arb/design_handoff_funding_arb/README.md` (high-fidelity,
copy final). B28–B60 were aligned with that design on 2026-10-14.

Numbers marked **(proposed)** are starting values only. They must be confirmed or replaced
using the F02 backtest before this spec moves to `approved`.

## Scope
In:
- Strategy `funding-arb` inside cane-auto-trader, behind a feature flag, off by default.
- One Binance sub-account (`cane-arb`). Pairs: long spot + short USDⓈ-M perpetual on
  coins on the owner's whitelist. Live starts with BTCUSDT and ETHUSDT only.
- Funding data ingestion (history + live), backtest/replay, entry/exit, two-leg execution,
  margin monitoring and rebalance, reconciliation, BNB fee buffer, PnL accounting,
  coin scanner + recommendations, symbol whitelist, Jev outlook (advisory),
  web UI (Overview, pair detail, Recommendations, Settings and whitelist), notifications,
  kill switch integration.

Out (v1):
- Cross-exchange legs (Bitget, KuCoin), coin-margined contracts.
- Trading any coin that is not on the whitelist and enabled.
- Closing a single leg from the UI.
- Negative-funding trades (short spot via margin borrow + long perp).
- Portfolio margin / unified account (revisit after F12).
- Automatic capital scaling.

## Behavior

### Funding data
- B1. The system stores every settled funding event per symbol (rate, time, mark price,
  interval hours) and has no gaps for the backfilled window (>= 2 years).
- B2. The funding interval is read from the exchange per symbol, never assumed to be 8h.
  When an interval changes, APR normalization uses the new interval from that event on.
- B3. `funding_apr = rate × (24 / interval_hours) × 365`.

### Entry
- B4. Given the strategy is enabled, the symbol is on the whitelist and enabled (B34),
  the symbol is not `needs_attention`, and no open pair exists for it, when
  `avg_funding_apr` over the last N settled intervals ≥ the symbol's entry threshold
  (its override if set, else `entry_apr_min`) AND the last settled rate > 0,
  the system opens a pair.
  N = 9 **(proposed)**; `entry_apr_min` = TBD from F02.
- B5. Entry is also blocked unless expected funding covers round-trip cost within
  `max_breakeven_days`: `round_trip_cost_pct / (avg_daily_funding_pct) ≤ max_breakeven_days`.
  `max_breakeven_days` = 10 **(proposed)**.
- B6. Round-trip cost = 2 × spot fee + 2 × perp fee + slippage allowance, using the account's
  actual fee rates read at startup (BNB-discounted reference: spot 0.075%,
  perp 0.018% maker / 0.045% taker).
- B7. Pair size = min(the symbol's capital cap (B34), free capital) and is rounded so both
  legs satisfy LOT_SIZE / stepSize / minNotional and differ by ≤ one step.

### Execution
- B8. Leg order is configurable; default **(proposed)**: perp short first, then spot buy.
- B9. Each leg is placed post-only (maker). If not fully filled within `maker_timeout_s`
  (30 **(proposed)**), the remainder is sent as a taker order.
- B10. If leg 1 fills and leg 2 cannot be filled after `leg_retry_max` attempts
  (3 **(proposed)**), the system unwinds leg 1 at market and records the pair as `failed_open`.
  At no point may an unhedged leg exist for longer than `max_unhedged_s` (60 **(proposed)**)
  without an alert.
- B11. On partial fill of leg 1, leg 2 is sized to the filled quantity, not the target.
- B12. All orders use deterministic client IDs `<strategy_id>-<pair_id>-<leg>-<action>-<seq>`
  and query-before-resend (S05 convention). Resending the same client ID never creates
  a second order.

### Holding and exit
- B13. While a pair is open, the system records each FUNDING_FEE income event against it.
- B14. Exit when `avg_funding_apr` over the last N intervals < `exit_apr_min` OR the
  settled rate is negative for K consecutive intervals. K = 3 **(proposed)**;
  `exit_apr_min` = TBD from F02.
- B15. Exit closes both legs with the same rules as B8–B12 (mirror order).

### Risk and margin
- B16. Perp leverage is set and verified at ≤ `max_leverage` before any order.
  `max_leverage` = 2 **(proposed)**. Margin mode: isolated **(proposed)**.
- B17. Margin levels on the perp leg (thresholds TBD from F02/F00):
  - L1 → notify only.
  - L2 → rebalance: sell spot equal in value to the shortfall, transfer USDT SPOT → UMFUTURE,
    and reduce perp by the same quantity so the pair stays delta-neutral.
  - L3 → unwind the whole pair at market.
- B18. Delta drift = |spot_qty − perp_qty| / perp_qty. If drift > `drift_tol`
  (0.5% **(proposed)**) the system re-hedges; if re-hedge fails, it marks the pair
  `needs_attention` and notifies.
- B19. If the perp position is reduced by ADL or liquidation, the system detects the hedge
  break within one reconciliation cycle and re-hedges or unwinds.
- B20. Kill switch (S11) closes both legs of every open pair and disables the strategy
  (no new entries). Afterwards every pair is `closed`.

### Reconciliation
- B21. On start and every 5 minutes, exchange state is the source of truth: spot balance,
  perp position, open orders, fee-burn settings. Orphan legs or mismatches outside
  tolerance trigger re-hedge or `needs_attention`.
- B22. On startup the system asserts `spotBNBBurn` and `feeBurn` are enabled on the
  sub-account; if not, it enables them and logs an audit event.

### BNB fee buffer
- B23. SPOT and UMFUTURE wallets each keep a BNB buffer of at least `bnb_buffer_days`
  of estimated fees (7 **(proposed)**) and at most `bnb_buffer_max_usdt` (TBD).
- B24. Below the minimum, the system redeems from Simple Earn Flexible, else buys BNB on
  spot, then transfers to the short wallet.
- B25. If a fill reports `commissionAsset != BNB`, the system notifies.

### Accounting
- B26. Per pair and per day: funding income, fees (native and USDT value), basis PnL
  (spot PnL + perp PnL excluding funding), net PnL, net APR on total capital used
  (spot notional + perp margin + BNB buffer).
- B27. Metric definitions are identical in backtest (F02) and live so they are comparable.

### Coin scanner and recommendations (F14)
- B28. Once per funding interval the scanner ranks every USDⓈ-M perpetual that also has a
  spot USDT market, and stores the result as a snapshot with its time and next refresh time.
- B29. Per coin the snapshot holds: rank, score (0–100), avg funding APR 7d, avg funding
  APR 30d, consistency (% of settled intervals with positive funding over 30d),
  estimated break-even days (B5 formula), liquidity pass/fail with a reason on fail,
  and a one-line "why" text. Score weights are set from F02 **(proposed)**.
- B30. Liquidity check: 24h volume and order-book depth at the capital cap, both legs.
  Thresholds TBD from F02. A coin that fails stays in the list, marked not eligible,
  with the reason (e.g. "Order book depth below threshold").
- B31. A coin drops out of the recommendation list when consistency < `min_consistency`
  (60% **(proposed)**), funding is negative for K intervals in a row, or it fails liquidity.
  Dropped coins are kept with reason and time ("Consistency fell to 58% (minimum 60%)").
- B32. Being recommended never opens a pair and never edits the whitelist. Only B4 opens pairs.
- B33. The scanner uses market data only and never loads the order executor or trading keys.

### Symbol whitelist (F15)
- B34. Per coin the whitelist holds: symbol, enabled, capital cap (USDT, default
  `capital_per_symbol`), optional entry APR override (% / yr), source (recommendation
  rank at add time, or manual), added time.
- B35. Add (from a recommendation or by hand) runs the same checks and rejects with one of
  these reasons: no USDⓈ-M perp market · too little liquidity (B30) · cap below exchange
  minimum (100 USDT per leg, or the symbol's minNotional if higher) · already on whitelist ·
  no coins left (`max_whitelisted_coins`, 5 **(proposed)**) · cap above exposure left
  (`max_total_exposure` = sum of caps, 25,000 USDT **(proposed)**).
- B36. Disabling a coin stops new entries only. An open pair on it stays open and hedged
  until it exits (B14) or the owner closes it (B44). Disable keeps history.
  Removing a coin is allowed only when it has no open pair; it frees its coin slot and
  cap, keeps history and audit entries, and needs a confirm (no TOTP, it only lowers risk).
- B37. Every whitelist add, remove, enable/disable, cap or override change writes an audit
  event (who, what, old → new, when).

### Jev outlook (F17)
- B38. Behind its own feature flag `jev_outlook`, default off. When on, the system asks Jev
  for the top 10 ranked coins of each snapshot **(proposed)**: probability that funding
  stays positive over the next N intervals. Features are market data only (S07 pattern).
- B39. Stored per snapshot row: probability or null, model version, request/response.
  Model pinned (S07). Timeout 3 s; any failure → null ("Unavailable"); the list still renders.
- B40. Jev never changes the score, the ranking, the whitelist or what the bot trades.
- B41. After N intervals the actual funding sign is recorded per prediction so Jev accuracy
  can be measured (input for F13).

### Owner actions (F10, F16)
- B42. Enable strategy requires a confirm showing capital per symbol, max total exposure,
  max leverage and margin mode, plus a fresh 6-digit TOTP.
- B43. Disable strategy stops new entries only; open pairs stay open and hedged. The
  confirm states the number of open pairs and that they close via pair detail or kill switch.
- B44. The owner can close one pair; it closes both legs (B15). The confirm shows perp
  buy-back qty, spot sell qty and USDT value, and estimated fees. No single-leg close exists.
- B45. Parameter, cap and override changes are saved as one batch: a review lists every
  `old → new` with units, plus TOTP. Changes apply to new decisions, not past trades.
- B46. Adding a coin needs a confirm with the cap (validated live per B35), coins and
  exposure left after adding, source, plus TOTP. Disabling a coin with an open pair needs a
  confirm (B36); a coin without a pair toggles directly.
- B47. Every owner action writes an audit event shown in the pair log (per coin) and the
  strategy log (all), and returns a confirmation toast.
- B48. Editable parameters: capital_per_symbol, entry_apr_min, exit_apr_min, N, K,
  max_breakeven_days, max_leverage, margin L1/L2/L3 (40/60/80% **(proposed)**), drift_tol,
  maker_timeout_s, bnb_buffer_days, max_whitelisted_coins, max_total_exposure,
  recommendation_digest (on/off, default off). Values still TBD carry a
  "Set after backtest F02" tag in the UI.

### Web UI (F10, F16)
- B49. The UI shows values from the backend as-is and never computes PnL or APR.
- B50. Per-coin state shown to the owner is one of: Watching, Opening, Open, Closing,
  Closed, Failed to open, Needs attention; a disabled coin with no pair shows Coin disabled.
- B51. Strategy status, first match wins: Disabled (with "N pairs still open" if any) →
  Needs attention → Stale data → any open pair at margin L1+ → Enabled · healthy.
- B52. Data is stale when the last reconcile is > 10 minutes old or Binance is unreachable.
  Stale values keep the last known state and are marked stale (dimmed + amber note).
- B53. Overview (Dashboard card and Funding arb › Overview) shows: Net PnL today, Net PnL
  to date, Net APR; per coin: size per leg, funding APR (current, avg N, entry threshold),
  margin level + ratio, delta drift vs tolerance; BNB buffer days per wallet, last
  reconcile time, Binance connection; next funding countdown when enabled.
- B54. Pair detail shows both legs, delta drift, funding history (7D default, 30D) with
  avg-N and entry/exit thresholds and the open/close marker, PnL breakdown (funding, fees,
  basis, net, today, net APR), margin level with L1/L2/L3 thresholds, and the event log.
- B55. Recommendations shows the latest snapshot (B28–B31), the dropped list, whitelist
  room left, and per coin an action: Add to whitelist · On whitelist · Not eligible.
  The page states that being recommended does not mean being traded.
- B56. Jev outlook is a separate column labelled as an AI second opinion with the model
  version; null shows "Unavailable", ranks beyond the top 10 show "—".
- B57. Dashboard adds a Total equity tile (main account + `cane-arb` sub-account, sub-line
  per account) and an Arb pairs tile (count of Open + Needs attention pairs, one pair = one).
  Existing tiles stay main-account only.
- B58. Kill switch confirm lists the funding-arb pairs it will close; the result lists each
  pair as one row.

### Notifications (F10, F16)
- B59. Each message carries severity as emoji + text prefix: `🔴 CRITICAL`, `🟠 WARNING`,
  `🔵 INFO`, then `funding-arb`. Critical messages end with a deep link `cane.app/arb/{SYMBOL}`.
  - Critical: margin L3 unwind, hedge break / unhedged leg, needs_attention.
  - Warning: margin L2 rebalance, margin L1, fees charged in USDT (B25), pair failed to open.
  - Info: pair opened, pair closed, daily summary, recommendation digest.
  The owner can mute Info messages; Critical and Warning cannot be muted.
- B60. Recommendation digest (when on): once a day, new coins in the top 5 and moves into
  the top list, with score and APR 7d, linking to `cane.app/arb/recommendations`.
  It is always Info, never an alert.

## Data
All fields are `internal` (owner's own trading data, no customer data). No `pii` fields.

| Entity | Fields | Class | Retention |
|---|---|---|---|
| funding_rate | symbol, funding_time, rate, mark_price, interval_hours | internal (public market data) | indefinite |
| arb_pair | pair_id, symbol, state, spot_qty, perp_qty, entry/exit basis, opened_at, closed_at | internal | indefinite |
| arb_order | client_id, pair_id, leg, side, qty, price, status, commission, commission_asset | internal | indefinite |
| arb_income | pair_id, type (FUNDING_FEE/COMMISSION), amount, asset, time | internal | indefinite |
| arb_daily_pnl | date, pair_id, funding, fees, basis_pnl, net_pnl, capital_used | internal | indefinite |
| arb_whitelist | symbol, enabled, cap_usdt, entry_apr_override, source, added_at | internal | indefinite |
| arb_scan_snapshot | snapshot_time, next_time, symbol, rank, score, apr_7d, apr_30d, consistency, breakeven_days, liquidity_ok, liquidity_reason, why, dropped_reason | internal (public market data) | indefinite |
| arb_jev_outlook | snapshot_time, symbol, probability (nullable), model_version, request, response, actual_sign | internal | indefinite |
| audit_event | who, action, target, old, new, time (S08 table) | internal | indefinite |
| api credentials | stored via S08 only | restricted | never logged, never in repo |

- Money values use decimal / integer minor units, never float. Rounding to exchange
  step sizes is round-down for quantity.

## Interfaces
- Binance (via S05 adapter): spot + USDⓈ-M orders, `/fapi/v1/fundingRate`,
  `/fapi/v1/premiumIndex`, `/fapi/v1/fundingInfo`, `/fapi/v1/income`,
  `/sapi/v1/asset/transfer`, `/sapi/v1/bnbBurn`, `/fapi/v1/feeBurn`, Simple Earn flexible.
- Strategy API (S09.5 pattern): enable/disable (TOTP), config read/update (TOTP), list
  pairs with state/legs/margin/drift, pair detail (funding series, PnL components, events),
  close pair, overview (headline PnL, BNB buffers, last reconcile, connection, next funding),
  whitelist CRUD + check (TOTP on add), recommendations snapshot + dropped list,
  strategy audit log, sub-account equity for the Total equity tile.
- Jev (S07 client): outlook question per coin, behind `jev_outlook` flag.
- Notifications (S09): see B59–B60.
- Audit events: strategy enabled/disabled, config changed, pair opened/closed, owner close,
  unwind, rebalance transfer, fee-burn toggled, whitelist add/remove/enable/disable/cap/
  override change, kill switch.

## Non-functional
- Reconciliation interval: 5 minutes (matches S06).
- Unhedged exposure alert: within `max_unhedged_s` (B10).
- Feature flag default: off. Rollback = disable flag + kill switch; must be possible
  in < 15 minutes from the web app.

## Edge cases and failure modes
- Process crash between leg 1 and leg 2 → on restart, reconciler finds orphan leg (B21) and
  completes or unwinds per B10.
- Exchange rejects leg 2 (filters, insufficient margin, rate limit) → B10.
- Funding interval changes mid-position → B2, B3.
- Funding flips negative → B14.
- Sharp price spike → B17; gap through L2 straight to L3 → unwind.
- ADL / liquidation → B19.
- BNB buffer exhausted → fees charged in USDT, B25 alert; trading continues.
- Simple Earn unavailable on testnet → mocked in tests.
- Binance API outage → no new entries; existing pairs left as-is; alert after
  consecutive failures (threshold TBD).
- Manual trading in the sub-account → detected by reconciliation, `needs_attention`.
- Reconcile > 10 min old or Binance unreachable → UI marks data stale (B52); no new entries.
- Jev down, slow or flag off → outlook null, recommendations still render (B39).
- Whitelist full (coins or exposure) → add rejected with reason (B35).
- Coin delisted while on the whitelist → no new entries; an open pair is closed by the
  owner or the exit rule.
- Wrong TOTP → action not applied, "Code not accepted. Wait for the next code and try again."

## Acceptance criteria
- AC1. Backfill has no missing funding intervals for both symbols over ≥ 2 years (B1–B3).
- AC2. F02 report produced for ≥ 3 parameter sets; chosen thresholds recorded in this spec.
- AC3. Testnet: full cycle open → funding recorded → close, with both legs matched (B4–B15).
- AC4. Testnet: leg-2 rejection, partial fill, and crash-between-legs each end hedged or
  fully flat, never with an unalerted orphan leg (B10–B12, B21).
- AC5. Testnet: simulated margin drop triggers L1/L2/L3 behavior correctly (B17).
- AC6. Kill switch flattens all pairs, both legs (B20).
- AC7. Live PnL snapshot matches Binance income history for the same period (B26).
- AC8. 30-day live run report with go/no-go decision recorded (F12).
- AC9. Scanner snapshot stored every funding interval with all B29 fields; a liquidity
  fail shows its reason; dropped coins show reason and time (B28–B31).
- AC10. Whitelist API rejects each B35 case with its reason; every change has an audit
  event; disabling a coin with an open pair leaves the pair open (B34–B37).
- AC11. Jev: snapshot rows carry probability + model version for the top 10; with Jev down
  the list renders with "Unavailable"; accuracy query works on ≥ 1 week of data (B38–B41).
- AC12. Screenshots (desktop + 390px mobile, dark + light) of: disabled, quiet market,
  Opening, Failed to open, Open with margin L1, Needs attention, stale, Jev unavailable,
  Recommendations, whitelist reject, every confirm dialog incl. wrong TOTP (B42–B58).
- AC13. Testnet notification test: one message of each B59 event plus the digest, with
  correct prefix and deep link; muted Info sends no Info messages (B59–B60).

## Open questions
1. Capital per symbol and max total exposure — owner.
2. `entry_apr_min`, `exit_apr_min`, N, K — from F02 backtest.
3. Margin L1/L2/L3 thresholds — from F02 worst-case basis/price moves.
4. Hurdle rate vs holding USDT in Simple Earn — owner.
5. Max BNB buffer size (unhedged exposure) — owner.
6. Isolated vs cross margin on the sub-account — confirm after F05 testnet.
7. API outage alert threshold — owner.
8. Scanner score weights, liquidity thresholds, `min_consistency` — from F02.
9. Jev top N (10 proposed) — owner, based on token cost.
10. `max_whitelisted_coins`, `max_total_exposure` — owner.
