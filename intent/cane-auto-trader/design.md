# Design summary — Cane Auto Trader UI
From: design-prompt.md (spec.md draft 2026-09-25) + design-fix-prompt.md round 2 (spec.md rev 2, 2026-09-27) + design-fix-prompt-3.md round 3 (spec.md rev 5, 2026-09-28). Status: prototype.
Prototype file: `Cane Auto Trader.dc.html` (project root)

## Visual system
- Design system: Portfolio and Blog (dark-first ink surfaces, single indigo accent).
- Fonts: Poppins (UI), Noto Sans Thai (Thai fallback), JetBrains Mono (prices, IDs, codes).
- Icons: Font Awesome 6.5.1. No emoji.
- Background: indigo / violet / teal radial gradient on ink (user request; deviates from the design system's flat backgrounds).
- Numbers: tabular figures. PnL colour green/red, always with +/− sign and caret icon.
- Light / dark mode and TH / EN switch in the top bar.

## Prototype controls (Tweaks)
- `startScreen`: login · dashboard · strategies · killswitch · settings
- `dataState`: populated · empty · loading · error
- `device`: desktop · mobile (390 px frame; Dashboard + Kill switch)
- Demo inputs: password `cane`; any 6-digit TOTP; `000000` shows the "code not accepted" error.
- Exchange keys (prototype only): each "Save with TOTP" returns the next result in turn — withdrawal rejected → trading missing → Accepted.

## Screens

### 1. Login
- Email + password → 6-digit TOTP step.
- Wrong credentials: warning with attempts left.
- 5 failures: locked 15 min with live mm:ss countdown.
- No sign-up, no forgot-password.

### 2. Dashboard
- Top bar: nav, system status pill (Running / Stopped by kill switch / Exchange unreachable), TH/EN, theme, Kill switch (red outline, separated by a divider). Mobile: the same pill on its own second header row; the "Trading stopped" banner shows under it.
- Stat cards: Spot equity, Futures equity, Today's realised PnL, Total realised PnL, Open positions.
- Alert banners: Needs attention (one banner listing each pair + reason), Jev fallback used, Exchange key error, Exchange unreachable — each with an action.
- Needs-attention reasons: insufficient margin; position differs from exchange (reconciliation); stop order missing — re-placed; entry skipped (stop beyond liquidation even at 1x); symbol trading halted.
- Tabs:
  - Open positions: pair, market, side, qty, entry, mark + 24h change, unrealised PnL (value + %), stop, take-profit, liq. price, leverage.
  - Trade history: time, pair, market, side, entry → exit, net realised PnL, exit reason. Row opens the detail drawer.
  - Audit log: time, action, details. Secrets never shown.
- Trade detail drawer: signal timeframe (1D / 4H late entry), 1W trend, entry, exit reason, flip note with link to the previous / next trade, three confluence factors (Long: Channel breakout / Capitulation / Higher low; Short: Channel breakdown / Euphoria / Lower high) with Jev confidence bar + ✓/✗ + present label, threshold 0.70, Jev fallback note using the configured timeout, resulting size (e.g. base 10% + 2×20% = 50%), sizing mode, leverage used ("lowered from 5x to 3x"), "Jev fallback: base size" badge, PnL breakdown (gross, fees, funding, net).
- Consistency heatmap: 12 months (mobile: 16 weeks), 5 intensity levels, month labels, summary (trading days, longest streak), legend. Hover tooltip: date + weekday (Thai Buddhist year in TH), trades, PnL, Win/Loss + win %, activity level.
- States: loading skeletons, empty (no positions/trades, CTA to create strategy), error (stale data dimmed + banners).
- Mobile: 2×2 stat grid, alerts, position cards (with 24h change), heatmap, recent trades, sticky full-width Kill switch button.

### 3. Strategies
- List columns: pair + ID, price · 24h, market, state badge (+ note for Needs attention), position, 30-day PnL sparkline + total, sizing mode, leverage (ceiling + used), margin mode, actions.
- States: Disabled, Warming up, Waiting for signal, In position, Needs attention, Closed (icon + label, not colour alone).
- Actions: Enable (TOTP modal), Disable (keeps managing open position), Edit, Close (confirm modal: market close + cancel orders).
- One enabled strategy per pair: enabling or picking a duplicate pair shows an error naming the existing strategy.
- Create / Edit form:
  - Searchable USDT pair picker (shows pairs already in use).
  - Market: Spot / Futures.
  - Futures only: leverage slider (ceiling, 1–20x, default 5x, helper ends "Max 20x."), margin mode (Isolated default / Cross), sizing mode cards A / B (default) / C.
  - Base size 5–20% (default 10), Jev threshold (default 0.70), risk % at full confluence (mode C only).
  - Live sizing preview, e.g. "With 10,000.00 USDT and 5x: 20% → notional 2,000.00, margin 400.00", plus base / 2 factors / all 3 factors rows.
  - Leverage and margin mode locked with explanation while the strategy has an open position.
- States: loading, empty (CTA), error banner.

### 4. Kill switch
- Entry: top-bar button (desktop), large sticky button (mobile), dedicated page.
- One confirmation modal, no TOTP: disable all strategies, cancel bot orders, close bot positions at market; non-bot positions untouched.
- Result: per-pair rows (Closed / Failed · retrying → resolves / Orders cancelled), untouched-position note, persistent "Trading stopped" banner across all pages until strategies are re-enabled one by one.

### 5. Settings
- Exchange keys: masked "•••• 4F2A" with Replace; helper line listing the Binance permissions to enable / keep off; write-only key + secret inputs; validation result (Accepted / Rejected: withdrawal permission is enabled / Rejected: trading permission is missing, naming the market); save requires TOTP. Keys are not IP-restricted (Railway Hobby, no static outbound IP), so no IP check or IP guidance.
- Notifications: LINE (channel token + target ID) and Telegram (bot token + chat ID), enable toggle, Send test message; save requires TOTP.
- Trading: Jev timeout in seconds (default 3).
- Security: change password, re-setup TOTP (TOTP), regenerate 10 recovery codes (fresh TOTP first; shown once, copy / download), active session info + sign out.
- TOTP gates: enable strategy, save exchange keys, save notifications, re-setup TOTP, regenerate recovery codes. Kill switch: no TOTP.

## Change log
1. Initial build of all screens and states.
2. Header fixed for narrow widths (no wrapping of Kill switch / status).
3. Settings: removed Server outbound IP.
4. Strategies: added 30-day PnL sparkline per strategy.
5. Strategies: added current price + 24h change.
6. Dashboard: added 24h change under mark price.
7. Dashboard: added Consistency heatmap + hover tooltip.
8. Background: gradient (strengthened on request).

Round 2 — design-fix-prompt.md (review against spec.md rev 2, 2026-09-27):
9. Security: Regenerate recovery codes now asks for a fresh TOTP (shared modal) before codes are generated; added to the TOTP gates list.
10. Exchange keys: added "Rejected: trading permission is missing" (red) and "Key is not IP-restricted" in two variants to compare — A red reject, B amber "Warning — saved, but restrict this key to the server IP…". Guidance points to the Railway dashboard (no IP in the app). Prototype-only chip row to switch results.
11. Trade drawer: short trades use the mirrored factor names (Channel breakdown / Euphoria / Lower high). New sample short trade T-1043.
12. Trade drawer: flip trades — "Flip" note with "Previous trade" link on the trade opened by a flip, "Flipped" note with "Next trade" link on the trade it replaced; Long → Short ("closed on first red") and Short → Long ("closed on first green") wording. Sample data: T-1039 → T-1043, T-1038 → T-1042 (T-1039 made profitable to match the flip rule). Audit log: flip entry.
13. Jev fallback note and dashboard banner use the configured timeout: "Jev did not answer within {timeout} s…" (default 3).
14. Needs attention: five sample reasons in the Strategies note and a single dashboard banner listing each pair + reason (S-03, S-05, S-09, S-10, S-11).
15. Mobile header: status pill (three states) moved to its own row so "Stopped by kill switch" fits; "Trading stopped" banner confirmed on mobile with 16 px side padding.
16. README: production must self-host fonts (Poppins, Noto Sans Thai, JetBrains Mono) and Font Awesome — no third-party CDN on authenticated pages.

Round 3 — design-fix-prompt-3.md (owner decisions, spec.md rev 5, 2026-09-28):
17. Exchange keys: IP restriction dropped (bot on Railway Hobby, no static outbound IP). Removed both "Key is not IP-restricted" variants (A reject, B warn), all server-IP / Railway-dashboard guidance and the prototype chip row. Save now cycles withdrawal rejected → trading missing → Accepted so each result stays reachable.
18. Exchange keys: Accepted note now "Read, Spot and Futures trading enabled. Withdrawals and universal transfer disabled."
19. Exchange keys: "Rejected: trading permission is missing" names the missing market, e.g. "Futures trading is not enabled on this key…" (spec B15.2, per market in use).
20. Exchange keys: helper line above the inputs — "In Binance API settings enable Reading, Spot & Margin Trading and Futures. Keep Withdrawals and Universal Transfer off."
21. Dashboard: Exchange key error banner guidance changed from "Check the key and IP whitelist" to "Check the key and its permissions in Binance API settings".
22. Strategies: leverage helper ends with "Max 20x." (range 1–20, default 5 unchanged).
23. Heatmap: checked, no change (day boundary Asia/Bangkok; no UTC text).

## Open items
- All data is sample data; wire to real API.
- Heatmap colours use indigo instead of the reference image's grey-blue.
- Gradient background is outside the design system's flat-background rule.
