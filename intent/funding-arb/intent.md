# Intent: funding-rate arbitrage strategy
Author: Zong (owner, cane-auto-trader). Status: approved. Date: 2026-10-14.
Approved: Zong (owner), 2026-10-14.
Ticket: [F00] z8p2987e22

## Problem
Capital in the trading account earns nothing between directional trades. Perpetual
funding on Binance is positive most of the time in rising markets, but collecting it
by hand means watching margin around the clock, opening and closing two legs in sync,
and tracking fees, which is not practical manually.

## Proposed outcome
cane-auto-trader runs a delta-neutral strategy (long spot + short USDⓈ-M perp, same size)
that opens only when expected funding beats round-trip cost, keeps the hedge intact
without manual watching, and reports net return (funding minus fees minus basis) so
live results can be compared to a backtest and a go/no-go decision made after 30 days.

## Affected users and systems
- Owner only (personal capital, no external customers).
- cane-auto-trader: Binance adapter (S05), engine + reconciler (S06), settings/keys (S08),
  notifications (S09), web (S10), kill switch (S11), Postgres (S04).
- Binance: dedicated sub-account, spot + USDⓈ-M + wallet transfer + Simple Earn.

## Constraints
- **Money-affecting**: places real orders and moves funds between wallets.
- v1 is Binance only, positive funding only. No cross-exchange. The bot trades only
  coins the owner put on a whitelist; a scanner recommends coins but never trades them.
  Live starts with BTCUSDT/ETHUSDT only.
- Must not interfere with existing directional strategies; runs in its own sub-account.
- API key: trade + internal transfer only, withdrawals disabled, IP whitelist. Keys live
  only in the Settings API store (S08), never in repo, tickets or logs.
- Existing kill switch must flatten this strategy fully (both legs).
- No live orders before the backtest (F02) result is reviewed.

## Decisions (owner, 2026-10-14)
1. Capital per symbol and max total exposure are owner settings (`capital_per_symbol`,
   per-coin cap, `max_total_exposure`), editable in Settings, not fixed in this intent.
2. Hurdle: net APR on total capital used (spot notional + perp margin + BNB buffer)
   must be at least **6% / yr**, a fixed number. Below that, the strategy is not worth
   running compared with holding USDT in Simple Earn.
3. An unhedged BNB buffer is accepted. Each wallet keeps at least enough BNB for the fees
   of **10 round trips** (open + close of one pair) at the largest coin cap. No maximum.

## Open questions
1. Go/no-go criteria after the 30-day live run: deferred to F12, decided before go-live.
