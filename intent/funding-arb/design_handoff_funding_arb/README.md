# Handoff: funding-arb UI (cane-auto-trader, tickets F10, F15, F16, F17)

## Overview
UI for the **funding-arb** strategy inside the existing cane-auto-trader web app (S10). The strategy holds a long spot + short USDⓈ-M perp of equal size on Binance and earns the funding fee. The bot opens and closes pairs itself. The UI lets the owner see, at a glance, (1) whether anything is at risk, (2) whether it makes money, (3) where money comes from and goes, (4) why the bot is in or out of a coin, (5) whether the plumbing is healthy, and lets them stop everything.

Behaviour is specified in `../spec.md` (B1–B60; UI in B42–B60) and `../intent.md`. The original design brief (PDF) is not kept in the repo; this README records its decisions.

## About the design files
`prototype/Funding Arb.dc.html` is a **design reference built in HTML**. It is a clickable prototype showing intended layout, copy and behaviour. It is not production code. Recreate these screens in the cane-auto-trader web app's existing stack, components and theme (S10). All numbers in the prototype are mock data; per the brief, real values come from the backend as-is and the UI never computes PnL or APR.

Open the file in a browser (it loads `support.js` and `_ds/` from the shared copy in `../../cane-auto-trader/design_handoff_cane_auto_trader/prototype/`). The prototype skips login and opens on the Dashboard. The `prototype/` folder is not in the public repository (it holds a third-party design-system bundle); the owner keeps it locally. Its **Tweaks** panel switches scenarios:
- `startScreen`: `dashboard`, `arbHome`, `arbPair`, `arbSettings`, `arbRecs`, `killswitch`, …
- `arbScenario`: `open` (BTC + ETH open, ETH at margin L1), `attention` (ETH needs attention), `transition` (BTC opening, ETH failed to open), `quiet` (enabled, funding below entry, no pairs), `disabled` (feature flag off)
- `jevOn`: Jev outlook on or off
- `dataState`: `error` shows stale / exchange-unreachable states
- `device`: `desktop` or `mobile` (390px frame)
- TH/EN language and dark/light theme toggles live in the app header

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and copy are final and follow the app's existing design system (tokens in `../../cane-auto-trader/design_handoff_cane_auto_trader/tokens/`). Reuse the app's existing components (Button, Field, pills, cards, modal, TOTP input, toast) rather than building new ones. Values marked TBD in the brief (thresholds, caps, limits) appear with sample numbers and a "Set after backtest F02" tag; design for them to exist, not for the specific numbers.

---

## Navigation
- New top-nav item **Funding arb** (icon `fa-scale-balanced`) after Strategies. It is its own section, separate from Strategies.
- Inside Funding arb, a tab bar under the page title: **Overview · Recommendations · Settings and whitelist**. Active tab: text `--text-primary`, 2px bottom border `--accent`; inactive: `--text-secondary`, transparent border. Tabs are buttons 10×14px padding, 14px/500.
- **Dashboard** also shows the Overview panel (brief: "Dashboard, new card/section"), placed after the dashboard alerts and before the Positions/History/Audit tabs. On mobile it sits after the stat tiles and alerts, before Positions; it is the main mobile view.
- Pair detail opens from any symbol row (Dashboard or Overview). Its back link returns to where it came from ("Dashboard" or "Funding arb").
- Mobile has no top nav: the panel's settings button (sliders icon) opens Settings, and the tab bar reaches the other views.
- Below 1180px viewport the desktop nav shows icons only (label in `title`/`aria-label`); below 1000px the header status pill shows its icon only.

## Screens

### 1. Overview panel (Dashboard card + Funding arb › Overview)
One combined card for the whole strategy, one row per whitelisted coin (scales to more coins). Card: `--bg-raised`, 1px `--border` (turns `--danger` when any coin Needs attention), radius 16px, overflow hidden.

1. **Header row** (padding 14×16, bottom hairline): `fa-scale-balanced` in `--text-accent`, "Funding arb" 15px/600, **status pill**, right side "Next funding **01:58**" (mono, hh:mm countdown, hidden when off) and a 32×32 outline icon button (sliders) → Settings.
   Status pill (2×10 padding, radius full, 12px/500, icon + text), priority order:
   - Disabled → neutral (`--surface` / `--text-secondary`), `fa-power-off`, "Disabled" or "Disabled · N pairs still open"
   - Needs attention → `--red-bg` / `--red-fg`, `fa-circle-exclamation`
   - Stale data (exchange unreachable / last reconcile > 10 min) → `--amber-bg` / `--amber-fg`, `fa-clock`
   - Any open pair at margin L1+ → amber, `fa-gauge-high`, "Enabled · margin L1"
   - Otherwise → `--green-bg` / `--green-fg`, `fa-circle-check`, "Enabled · healthy"
2. **Attention banner** (only if a coin is Needs attention): full-width `--red-bg`/`--red-fg`, "{SYM} needs attention" + "Legs are out of sync and the bot could not fix it. Resolve it by hand." + outline button "Open pair".
3. **Stale banner** (only when stale): amber, "Last reconcile 14 min ago. Values show the last known state." Rows and headline numbers render at 60% opacity.
4. **Headline numbers**: 3 equal columns (also on mobile), each 14×16 padding, right hairline. Label 12px/500 `--text-secondary`; value JetBrains Mono 18px/600, signed, green/red; small "USDT" unit 11px muted. Net PnL today · Net PnL to date · Net APR.
5. **Symbol rows** (button, full width, bottom hairline, hover `--surface-hover`, chevron right). Flex-wrap: left block (symbol 14px/600 + state pill, flex 1 1 150px) and a metric grid (`repeat(auto-fit, minmax(118px,1fr))`, flex 3 1 330px) → 4 columns on desktop, 2 on mobile. Each metric: 11px muted label, mono value, 11px sub-line.
   - Size per leg: "4,985.34 USDT" / "0.0790 BTC" (or "No position", "Perp filled · spot pending", "Flat · spot leg rejected")
   - Funding APR: current APR / "avg 12.84% · entry 10.00%" (sub turns `--warning` when not in a pair and avg < entry)
   - Margin: 4-step badge (below) + ratio %, or "—" when no pair
   - Delta drift: "0.00%" (red if above tolerance) / "tol 0.50%"
6. **Quiet-market note** (enabled, no open pairs): `fa-eye` + "Watching. Funding is below the entry threshold on both symbols, so the bot stays out. A pair opens when the 9-interval average reaches 10.00%."
7. **Plumbing strip** (`--surface` background, 12px, flex-wrap gap 8×20): BNB spot "14 trades", BNB futures "12 trades" (amber if below `bnb_buffer_trades`), "Reconciled 2 min ago" (amber if > 10 min), "Binance connected" (green plug) / "Binance unreachable" (red).
8. **Disabled state** replaces 2–7: centred power icon, "Strategy is off", "No new pairs open while funding-arb is disabled. Turn it on in strategy settings.", secondary button "Strategy settings".

**Seven symbol states** (pill colors; Open is calm, Needs attention is the only red):
| State | bg / fg | icon |
|---|---|---|
| Watching | `--surface` / `--text-secondary` | fa-eye |
| Opening | `--accent-soft-bg` / `--text-accent` | fa-right-to-bracket |
| Open | `--green-bg` / `--green-fg` | fa-link |
| Closing | `--accent-soft-bg` / `--text-accent` | fa-right-from-bracket |
| Closed | `--surface` / `--text-secondary` | fa-circle-check |
| Failed to open | `--amber-bg` / `--amber-fg` | fa-triangle-exclamation |
| Needs attention | `--red-bg` / `--red-fg` | fa-circle-exclamation |
A coin disabled on the whitelist with no open pair shows a neutral "Coin disabled" pill (fa-power-off).

**Margin 4-step badge** (only while Open): four 12×6px segments (22×8 on pair detail), radius 2, gap 2. Segments 0..level filled with the level color, rest `--border-strong`; label "OK / L1 / L2 / L3" 12px/600 in the level color. Colors: OK `--success` (light theme `--green-fg`), L1 `--warning`, L2 `oklch(0.7 0.17 45)` (orange), L3 `--danger`.

### 2. Pair detail
- Back link, then title row: symbol (h1 28px/700, −0.02em; 22px on mobile), state pill, "funding-arb · opened 2026-10-02 10:28". Right: outline danger button "Close pair" (only when a pair is open).
- **Needs attention box** (red): "Legs out of sync", "Spot 2.090 ETH vs perp 1.890 ETH. Re-hedge failed 3 times after an ADL reduction. New entries for this symbol are paused." + "Check the sub-account on Binance, then close the pair here. Closing a single leg is not offered."
- **Legs side by side**: grid `repeat(auto-fit, minmax(min(100%,280px),1fr))`, gap 16. Spot · long (green coin icon): Quantity, Entry price, Mark price, Value, Leg PnL. Perp · short (red contract icon): Quantity, Entry price, Leverage "2x · Isolated", Liq. price, Leg PnL excl. funding. Rows 13px, label secondary, mono value, hairlines. Under the cards: check/cross icon + "Delta drift 0.00% · tolerance 0.50%".
- **No legs** (Watching / Opening / Failed): dashed card with state icon and explanation.
- **Funding history chart** (flex 2 1 460px): 7D / 30D segmented toggle (default 7D). Legend: Per interval (`--indigo-400`, 70% opacity, 1.5px), Avg 9 (`--text-primary`, 2px), Entry threshold (dashed `--success`), Exit threshold (dashed `--warning`). 220px tall, y-axis 30/20/10/0% labels (mono 11px muted, 44px gutter), gridlines `--border`, zero line `--border-strong`. A dashed vertical marker labelled "Opened" / "Closed" at the pair's open or close time. X labels are dates (mono 11px). Entry line uses the coin's override when set.
- **PnL breakdown** (flex 1 1 280px): Funding received (green bar), Fees paid (red bar), Basis PnL (muted bar, hint "Should hover near 0"). Bars 6px, width ∝ |value| / max. Then Net PnL (mono 20px/600, signed color), Today, Net APR. Sub-title "Since the pair opened" / "Last pair · closed …" / "No pairs on this coin yet".
- **Margin level card**: big ratio (mono 28px/600, level color) + 4-step badge; 10px bar filled to ratio with L1/L2/L3 ticks at their thresholds and labels underneath; then four level rows (OK / L1 notify / L2 bot rebalances / L3 bot unwinds), the current level highlighted with `--surface`. "Applies only while a pair is open." when no pair.
- **Event log**: time-ordered, newest first. 28px icon tile + title + "· bot/owner" + mono timestamp + 12px body. Includes owner audit entries (close, coin toggles, setting changes) for this coin.

### 3. Recommendations (Funding arb › Recommendations)
- Sub-title: "Scanner ranking · refreshed every funding interval · updated 08:00 UTC, next 16:00 UTC".
- **Rule strip** (`--accent-soft-bg`, radius 12): "Being recommended does not mean being traded. The bot trades only coins that are on your whitelist and enabled." Right: "Whitelist room **2 coins · 12,000 USDT**".
- Jev note line (robot icon): "Jev outlook is a second opinion from our AI model (Jev v2.3), shown for the top 10. It never changes the score, the ranking, or what the bot trades." (When Jev is off: "Jev is off, so the outlook shows as unavailable. Scores and ranking are not affected.")
- **Desktop table** (horizontal scroll under 1300px): # · Coin · Score (number + 72px bar in `--accent`) · APR 7d · APR 30d · Consistency · Break-even (amber if > max_breakeven_days) · Liquidity (Pass green / Fail amber pill, failure reason in tooltip) · Why (one line, 12px secondary) · **Jev outlook** · action.
- **Jev outlook column must read as separate**: 1px dashed `--border-strong` left divider, robot icon, label "Jev outlook" with sub "AI second opinion", muted secondary text, `cursor:help` with tooltip "Jev v2.3 · probability that funding stays positive over the next 9 intervals · advice only, not part of the score or ranking". Cell: "81%" + "stays positive"; if Jev is off or did not answer: italic muted "Unavailable" with `fa-circle-minus`; ranks beyond the top 10: "—". The rest of the row works normally either way.
- Action: secondary "Add to whitelist" · green "On whitelist" check · muted "Not eligible" (liquidity fail).
- **Mobile**: cards (not table). Before any tap the card shows rank, symbol, score + bar, a 4-column metric row (APR 7d, APR 30d, Consistency, Break-even), liquidity pill + reason, a dashed-top Jev strip, then a full-width "Add to whitelist" button.
- **Dropped out recently**: symbol, reason, time (e.g. TONUSDT "Consistency fell to 58% (minimum 60%)").

### 4. Settings and whitelist (Funding arb › Settings and whitelist)
1. **Strategy enabled** card with a 52×30 switch (on = `--accent`). Turning on → enable dialog; turning off → disable dialog (see Interactions).
2. **Whitelist** section:
   - Header "Whitelist" + "Only whitelisted, enabled coins are traded. A recommended coin is not traded until you add it here." + secondary button "Recommendations".
   - **Room meters** (two side by side, wrap on mobile): "Coins 3 / 5 · 2 left" and "Total exposure (sum of caps) 13,000 / 25,000 USDT · 12,000 USDT left". 6px bars in `--accent`, turn `--warning` with "No room left" when full.
   - One row per coin (flex-wrap; grid of cells `minmax(110px,1fr)`): symbol + source ("From recommendation #2" with ranking icon / "Added by hand" with hand icon) · Enabled switch (40×24) · Capital cap input (USDT) · Entry APR override input (placeholder "default 10.00", %) · Pair pill (Open green / None neutral) · Remove: outline button with `fa-trash-can` in `--danger` when the coin has no open pair; otherwise a dashed muted "Close the pair first" (`fa-lock`). Disabled coin rows dim the label to 55%.
   - **Add a coin by hand**: symbol input (mono, uppercase), cap input, button "Check and add". Runs the scanner checks and shows an amber reason box on reject: no USDⓈ-M perp market · too little liquidity · cap below exchange minimum (100 USDT per leg) · already on whitelist · no coins left · cap above exposure left. Helper: "Runs the same checks as the scanner: perp market, liquidity, exchange minimum and room left."
   - Footnote: "Disabling a coin stops new entries only. An open pair on it stays open until it exits or you close it."
3. **Parameters** card, grouped (uppercase 11px group headings): Capital · Entry and exit · Risk · Execution and fees · Whitelist limits. Each row: label 14px/500 (+ amber "Set after backtest F02" tag for TBD values), 12px muted help line, right-aligned mono input (160px) with unit. Recommendation digest is a switch. Edited inputs get an `--accent` border and a "was {old}" line.
   | Parameter | Unit | Prototype value | TBD |
   |---|---|---|---|
   | Capital per symbol | USDT | 5000 | yes |
   | Entry APR minimum | % / yr | 10.00 | yes |
   | Exit APR minimum | % / yr | 4.00 | yes |
   | Averaging window N | intervals | 9 | |
   | Exit after negative K intervals | intervals | 3 | |
   | Max break-even days | days | 10 | |
   | Max leverage | x | 2 | |
   | Margin L1 / L2 / L3 | % | 40 / 60 / 80 | yes |
   | Delta drift tolerance | % | 0.50 | |
   | Maker timeout | s | 30 | |
   | BNB buffer minimum | round trips | 10 | |
   | Max whitelisted coins | coins | 5 | yes |
   | Max total exposure | USDT | 25000 | yes |
   | Recommendation digest | on/off | off | |

   Known mismatch: the prototype still shows the BNB buffer as "BNB buffer target" in days (`bnb_buffer_days`). Follow spec B23 instead: `bnb_buffer_trades`, unit round trips, default 10.
4. **Sticky save bar** when anything (parameters, caps or overrides) changed: "{n} unsaved changes · applies to new decisions, not past trades" + Discard + "Review and save".
5. **Alert messages** card: Critical / Warning / Info segmented control showing each LINE/Telegram template as a chat bubble (`--surface`, radius 4 14 14 14, `white-space: pre-line`) with event name and "Includes: …". Info has a "Mute info messages" switch. Severity markers use **both emoji and a text prefix**: `🔴 CRITICAL`, `🟠 WARNING`, `🔵 INFO`. Critical messages always end with a deep link (`cane.app/arb/{SYMBOL}`). Exact template text is in `AP_MSGS` in the prototype.
6. **Strategy log**: owner actions across the strategy (what, old → new in mono, who, when).

### 5. Dashboard stat tiles (small change)
The existing tiles (Spot equity, Futures equity, PnL today, PnL total, Open positions) stay main-account only. A new first tile **Total equity** (`fa-vault`) sums all accounts: value "29,155.27 USDT", sub-line "Main 14,120.55 · Arb 15,034.72" (TH: "Equity รวม" / "บัญชีหลัก … · Arb …"). Arb equity is the `cane-arb` sub-account. Desktop tile grid is 4 equal columns × 2 rows (below 1040px viewport it switches to 2 columns: Total equity full width, then the other six in pairs): row 1 Total equity (spans 2 columns), Spot equity, Futures equity; row 2 PnL today, PnL total, Open positions, Arb pairs. On mobile (2 columns) Total equity spans the full width at the top, followed by Futures, Spot, PnL today, PnL total, Open positions, Arb pairs in pairs.

A new last tile **Arb pairs** (`fa-link`) shows the number of open funding-arb pairs (Open or Needs attention), sub-line the symbols ("BTCUSDT · ETHUSDT") or "None open" (TH: "คู่ Arb" / "ไม่มีคู่เปิด"). The existing Open positions tile keeps counting main-account positions only; one arb pair counts as one, not two legs.

### 6. Kill switch (existing flow, small change)
The confirm dialog adds a line "Close both legs of funding-arb pairs: BTCUSDT, ETHUSDT" (only when pairs are open). The result page lists each funding-arb pair as its own row ("Spot + Perp · funding-arb · spot + perp"). After the kill, the strategy is disabled and all pairs show Closed.

## Interactions and safety
Every action writes an audit entry (who, what, when, old → new) shown in the pair or strategy log.
| Action | Confirmation |
|---|---|
| Enable strategy | Dialog listing capital per symbol, max total exposure, max leverage · isolated, plus fresh 6-digit TOTP |
| Disable strategy | Dialog: "Stops new entries only." · "N open pairs stay open and hedged" · "Close them from pair detail or with the kill switch" |
| Change parameters / caps / overrides | "Review and save" opens a dialog listing every `old → new` with units, note "Applies to new decisions, not past trades", plus TOTP |
| Close one pair | Danger dialog: buy back perp short qty, sell spot qty + USDT value, estimated fees; button "Close both legs". No single-leg close anywhere in the UI. |
| Add coin to whitelist (from recommendation or by hand) | Dialog with capital-cap input (validated live: min 100 USDT, coins left, exposure left), lines "Coins left after adding", "Exposure left after adding", "Source", plus TOTP |
| Disable a coin with an open pair | Dialog: the open pair stays open and hedged until exit or manual close. Coins without a pair toggle directly. |
| Remove a coin (no open pair only) | Danger dialog: "Remove {SYM} from the whitelist?", history and audit kept, coins and exposure left after removing; button "Remove coin". No TOTP. |
| Kill switch | Existing flow + funding-arb line |
TOTP: the prototype treats `000000` as a wrong code to show the error state ("Code not accepted. Wait for the next code and try again."). Toasts confirm each completed action.

## Screen-level states to implement
Strategy disabled · enabled with no pairs (quiet market) · pair Opening / Failed to open · Needs attention · stale data (last reconcile > 10 min, values dimmed + amber) · exchange unreachable (keep last values, mark stale) · loading (existing app skeletons) · Jev unavailable.

## State (prototype names, for reference)
`apEnabled`, `apWl` (whitelist: sym, enabled, cap, ovr, src), `apParams` (saved values), `apEdits` (unsaved edits, keys `param`, `cap:SYM`, `ovr:SYM`), `apClosed`, `apSym`/`apFrom` (pair detail), `apRange` (7d/30d), `apSev`, `apMuteInfo`, `apLog` (audit entries), `apManSym`/`apManCap`/`apManErr` (manual add). Backend provides: per-coin state, legs, margin ratio, drift, funding series, PnL components, BNB buffers, reconcile time, scanner list (score, APR 7d/30d, consistency, break-even, liquidity + reason, Jev probability or null), dropped list, audit log.

## Design tokens (from `../../cane-auto-trader/design_handoff_cane_auto_trader/tokens/`)
- Fonts: Poppins (UI; Noto Sans Thai fallback for TH), JetBrains Mono for all numbers, symbols, timestamps and parameter names. `font-variant-numeric: tabular-nums`.
- Dark theme (default): `--bg-base #151a1e`, `--bg-raised #1e252b`, `--surface #2b3740`, `--surface-hover #3a4a55`, `--border #2b3740`, `--border-strong #3a4a55`, text `#ffffff` / `--text-secondary #9ca3af` / `--text-muted #6b7280`, `--text-accent #a5b4fc`.
- Light theme (`.light`): bg `#f9fafb`, raised `#ffffff`, border `#e5e7eb` / `#d1d5db`, text `#111827` / `#4b5563` / `#9ca3af`, accent `#4f46e5`.
- Accent: `--accent #6366f1`, `--accent-strong #4f46e5` (selected segmented control, white text), `--accent-soft-bg rgba(99,102,241,0.14)`, chart line `--indigo-400 #818cf8`.
- Status: `--success #22c55e`, `--warning #f59e0b`, `--danger #ef4444`. Positive/negative money: `--success` / `--danger` on dark, `--green-fg #166534` / `--red-fg #991b1b` on light.
- Tinted pairs: green `#dcfce7/#166534`, amber `#fef3c7/#92400e`, red `#fee2e2/#991b1b`.
- Radii: cards 16px, banners/panels 12px, inputs/buttons 8px, pills full.
- Type scale used: h1 28px/700 (−0.02em; 22px mobile), card titles 15–16px/600, body 13–14px, labels 12px, captions 11px; uppercase 11px/600 with 0.08em tracking for group headings.
- Card padding 20–24px; page padding 32×24 desktop, 16 mobile; gaps 16–24px.

## Assets
Font Awesome 6.5.1 (solid) for all icons. No images. Emoji appear only inside LINE/Telegram message templates.

## Files
- `prototype/Funding Arb.dc.html`: full prototype (whole app shell + funding-arb screens). Funding-arb logic is in the `ap*` methods (`apVals`, `apModal`, `apConfirm`) and the `AP_*` mock data constants.
- Runtime (`support.js`) and design-system tokens (`_ds/…`) are shared with the main app handoff in `../../cane-auto-trader/design_handoff_cane_auto_trader/prototype/`.
- Spec and intent: `../spec.md`, `../intent.md`.

## Decisions on the brief's open questions
- Overview: one combined card, one row per coin.
- Margin: 4-step badge (OK/L1/L2/L3) + ratio %; full bar with threshold ticks on pair detail.
- Funding chart: 7 days by default, 30 days toggle.
- Event log: per pair in pair detail, plus a strategy-wide log in Settings.
- Notification markers: emoji + text prefix.
- Quiet-market copy: see Overview item 6.
- Recommendations on mobile: cards showing score + 4 metrics + reason before any tap.
- Whitelist room: two compact meters at the top of the whitelist section, also summarised in the Recommendations rule strip.
- Jev outlook: own column with dashed divider, robot icon, muted style, "AI second opinion" label and model-version tooltip.
