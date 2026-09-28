# Handoff: Cane Auto Trader — Web UI

## Overview
Cane is a personal, single-user crypto auto-trading bot. It trades one exchange account: Spot (long only) and USDⓈ-M Futures (long and short). Trading decisions are fully automatic. The UI is for monitoring, configuring strategies, settings, and an emergency stop (kill switch). Tone: calm, precise, trustworthy — a control room, not a casino.

Business rules live in `../spec.md` and `../intent.md` (the source of truth). A short screen-by-screen summary and change log is `../design.md`.

## About the Design Files
The files in `prototype/` are **design references created in HTML**: a working prototype showing the intended look and behaviour. They are **not production code to copy**. Recreate these designs in the target codebase's environment (React, Vue, etc.) using its own patterns and libraries. If there is no frontend yet, pick a suitable stack (suggested: React + TypeScript + Vite, CSS variables for tokens, a small i18n layer for TH/EN). All data in the prototype is hard-coded sample data. Wire it to the real backend per `spec.md`.

To open the prototype: serve the `prototype/` folder with any static server (e.g. `npx serve prototype`) and open `Cane Auto Trader.dc.html`. It needs network access for Google Fonts and Font Awesome (cdnjs). All app logic is in the `<script data-dc-script>` block at the bottom of the file (class `Component`, method `renderVals()`), and the markup is in the `<x-dc>` template above it.

Prototype controls (props on the root, shown in the host's Tweaks panel; in code they default to the values in bold):
- `startScreen`: **login** | dashboard | strategies | killswitch | settings
- `dataState`: **populated** | empty | loading | error
- `device`: **desktop** | mobile (renders a 390 × 844 px frame)
- Demo credentials: password `cane`; any 6-digit TOTP passes; `000000` simulates a rejected code.
- Exchange key validation (prototype only): each "Save with TOTP" on Settings → Exchange keys returns the next result in turn — Rejected: withdrawal permission is enabled → Rejected: trading permission is missing → Accepted (see 5. Settings).

## Fidelity
**High-fidelity.** Final colours, typography, spacing, copy (EN + TH) and interactions. Recreate pixel-accurately using the tokens below.

---

## Global layout

- **Desktop app shell**: full-viewport column. Sticky header (64 px) → optional "Trading stopped" banner → `<main>` max-width 1280 px, centred, padding `32px 24px 64px`, vertical gap 24 px between blocks.
- **Mobile shell** (device = mobile): 390 px wide frame, min-height 844 px, 28 px radius, 1 px `--border-strong`. Mobile shows only Dashboard and Kill switch. Main padding 16 px.
- **Background (app + login)**, fixed attachment:
  ```css
  background:
    radial-gradient(1200px 700px at 100% 0%,  rgba(99,102,241,0.55), transparent 65%),
    radial-gradient(1000px 650px at 0% 100%,  rgba(20,184,166,0.30), transparent 62%),
    radial-gradient(800px 500px at 15% 10%,   rgba(168,85,247,0.28), transparent 60%),
    linear-gradient(160deg, var(--bg-base), var(--bg-base));
  background-attachment: fixed;
  ```
  Note: added on user request. It deviates from the base design system (flat backgrounds).
- **Base text**: 14 px, line-height 1.5, `font-variant-numeric: tabular-nums` on the root.
- **Font stack**: `'Poppins', 'Noto Sans Thai', sans-serif`. Poppins has no Thai glyphs, so Noto Sans Thai (400/500/600/700) is required. Prices, IDs, timestamps and codes use `--font-mono` (JetBrains Mono).

### Header (desktop)
- Height 64, padding `0 20px`, gap 16, bottom border 1 px `--border`, background `color-mix(in srgb, var(--bg-base) 82%, transparent)`, sticky top, z-index 20.
- Left to right:
  1. Wordmark: `fa-wave-square` icon in `--accent` + "Cane", 18 px / 700 / −0.02em.
  2. Nav buttons (Dashboard `fa-gauge`, Strategies `fa-chess-knight`, Settings `fa-gear`): padding 8×12, radius 8, 14 px / 500. Active: bg `--surface`, text `--text-primary`. Inactive: transparent, `--text-secondary`.
  3. Spacer (flex 1).
  4. Status pill: padding 6×12, radius full, 1 px `--border-strong`, 13 px / 500, nowrap, max-width 220 px with ellipsis.
     - Running: `fa-circle-check`, positive colour.
     - Stopped by kill switch: `fa-circle-stop`, negative colour.
     - Exchange unreachable: `fa-plug-circle-xmark`, `--warning`.
  5. TH / EN segmented control: 3 px padding, radius full, 1 px `--border-strong`. Segment padding 3×10, 12 px / 600. Active: bg `--accent-strong`, white text.
  6. Theme toggle: 34 px circle, 1 px `--border-strong`. Shows `fa-sun` in dark mode and `fa-moon` in light mode.
  7. 1 × 28 px vertical divider in `--border-strong`.
  8. **Kill switch button**: height 36, padding 0 14, radius 8, 1.5 px solid `--danger` border, transparent bg, negative text colour, 13 px / 600, `fa-power-off`. Hover bg `rgba(239,68,68,0.12)`. Never wraps or shrinks.
- Every item except the nav is `flex: none`. The nav shrinks first on narrow widths.

### Header (mobile)
Padding 12×16, two rows (`flex-wrap: wrap`, gap 10):
- Row 1: wordmark (17 px), spacer, TH/EN, 32 px theme button.
- Row 2 (`flex-basis: 100%`): the status pill with the same three states as desktop (Running / Stopped by kill switch / Exchange unreachable). Pill: padding 4×10, radius full, 1 px `--border-strong`, 12 px / 500, nowrap, `role="status"`. It has its own row so the full label is never cut or wrapped at 390 px (EN and TH).

The Kill switch is a sticky bottom bar instead: full width, height 56, radius 14, bg `--danger`, white 17 px / 700, `fa-power-off`.

### "Trading stopped" banner
Shown on every page while `killed = true`, on desktop **and mobile** (directly under the header). Padding 12×24 (mobile 12×16), bg `--red-bg`, text `--red-fg`, `fa-circle-stop`, bold title, subtitle, and an outlined "Go to Strategies" button (desktop only; Strategies is not available on mobile).

### Colour semantics
- Positive: dark theme `--success` (#22c55e); light theme `--green-fg` (#166534).
- Negative: dark theme `--danger` (#ef4444); light theme `--red-fg` (#991b1b).
- Never rely on colour alone:
  - Every PnL shows a sign (`+` / `−`, U+2212) and `fa-caret-up` / `fa-caret-down` (or `fa-minus` for zero).
  - Sides show `fa-arrow-trend-up` (Long) or `fa-arrow-trend-down` (Short).
  - States show an icon plus a label.
- Number formatting: `en-US` grouping, 2 decimals for USDT and most prices. Coin prices: ≥100 → 2 decimals, ≥1 → 3 decimals, <1 → 4 decimals.

### Card pattern (used everywhere)
Background `--bg-raised`, 1 px `--border`, radius 16, padding 20–24. Tables are CSS grids inside cards (not `<table>`):
- Header row: padding 10×16, 12 px / 500 `--text-secondary`, bottom border.
- Body rows: padding 12–14 × 16, 13 px, bottom border 1 px `--border`, hover bg `--surface-hover`.
- Tables scroll horizontally inside the card below their min-width.

---

## Screens / Views

### 1. Login
- Centred card, max-width 400, padding 32, radius 16, `--shadow-lg`, gap 20. A top row holds the wordmark (left) and TH/EN + theme (right).
- **Step 1 — credentials**:
  - Title "Sign in to Cane" (22 / 700), subtitle "Owner access only."
  - Field (DS `Field`) Email with `fa-envelope`, prefilled `owner@cane.local`.
  - Field Password with `fa-key`.
  - Primary `Button` "Continue" (lg, block) with trailing `fa-arrow-right`.
- **Wrong credentials**: amber alert (`--amber-bg` / `--amber-fg`, radius 12, `fa-circle-exclamation`). Title "Email or password is incorrect." Body "{n} attempts left before a 15-minute lock." The password clears after each failure.
- **Locked** (5th failure): red alert with `fa-lock`, "Too many failed attempts. Sign-in is locked." plus "Try again in mm:ss" (mono, live 1 s countdown from 15:00). The Continue button is disabled.
- **Step 2 — TOTP**:
  - `fa-shield-halved` tile (44 px, radius 12, `--accent-soft-bg`).
  - Title "Two-factor code", subtitle "Enter the 6-digit code from your authenticator app."
  - Single numeric input: height 56, radius 12, mono 26 px, letter-spacing 0.5em, centred, digits only, max 6.
  - "Verify" button, disabled until 6 digits are entered.
  - "Back" link.
- No sign-up and no forgot-password link.

### 2. Dashboard (desktop)
Order of blocks:
1. **Title row**: "Dashboard" (28 / 700 / −0.02em). On the right, the sync status (13 px `--text-secondary`):
   - `fa-rotate` "Synced 14:02:11"
   - error: `fa-triangle-exclamation` "Last sync 14:02:11 · retrying"
   - loading: spinner "Syncing…"
2. **Stat cards**: grid `repeat(auto-fit, minmax(190px, 1fr))`, gap 16. Each card has a label (12 / 500 secondary), a value (20 / 600, nowrap, with a leading icon) and a sub-label (12, muted).
   - Spot equity `fa-wallet` — `4,120.55 USDT`, sub "Spot"
   - Futures equity `fa-scale-balanced` — `10,000.00 USDT`, sub "USDⓈ-M"
   - Today's realised PnL — `+312.45 USDT`, sub date
   - Total realised PnL — `+1,284.90 USDT`, sub "42 trades"
   - Open positions `fa-layer-group` — `3`, sub "Spot 1 · Futures 2"
3. **Alert banners** (stacked, gap 8, radius 12, padding 12×16). Each has an icon, a bold title, a body and an outlined CTA button at the right.
   - Needs attention (orange, `fa-triangle-exclamation`) → CTA "Review" opens Strategies. One banner for all affected strategies:
     - Title: "{pair} needs attention" (one) or "{n} strategies need attention" (several).
     - Body: "No new entries on these pairs until you review them."
     - A list below the body, one row per strategy: pair (600, min-width 84) + reason (13 px). On mobile the pair and reason stack.
     - Reasons (sample data covers all five; same strings as the Strategies note):
       - "Order rejected: insufficient margin"
       - "Position differs from exchange (reconciliation)" (spec B12)
       - "Stop order missing — re-placed" (spec B12.2)
       - "Entry skipped: stop would sit beyond liquidation even at 1x" (spec B9.2)
       - "Symbol trading halted" (spec E8)
   - Jev fallback used (sky, `fa-robot`) → CTA "View" opens the trade detail for T-1040. Body: "SOLUSDT entry on 2026-09-24 opened at base size after Jev did not answer within {timeout} s."
   - Error state only:
     - Exchange unreachable (amber, `fa-plug-circle-xmark`).
     - Exchange key error (red, `fa-key`): "Requests are rejected with ‘Invalid API-key, IP, or permissions’. Check the key and its permissions in Binance API settings." → CTA "Open settings". (The quoted text is Binance's own error string; the guidance does not mention IP.)
4. **Tabbed card**. Tabs are 14 / 500 with a 2 px bottom indicator in `--accent` and a count pill: Open positions | Trade history | Audit log.
   - **Open positions** grid (min-width 1120). Columns `1.1fr .8fr .7fr .7fr 1fr 1fr 1.3fr 1fr 1fr 1fr .6fr`:
     - Pair (600)
     - Market
     - Side (icon + label)
     - Qty
     - Entry
     - Mark · 24h: mark price with the 24h % change below it (11 px, coloured, caret)
     - Unrealised PnL: value and (%)
     - Stop
     - Take-profit ("—" if none)
     - Liq. price (futures only, else "—")
     - Leverage (futures only)
     - All numeric columns are right-aligned mono.
   - **Trade history** grid (min-width 980). Columns `1.2fr 1fr .8fr .7fr 1.7fr 1.1fr 1.1fr 24px`:
     - Time
     - Pair
     - Market
     - Side
     - Entry → Exit
     - Realised PnL (net, including fees and funding)
     - Exit reason (icon + label)
     - Chevron
     - The whole row is a button that opens the Trade detail drawer.
     - Exit reason icons: First red `fa-square`, First green `far fa-square`, Stop `fa-hand`, Take-profit `fa-bullseye`, Kill switch `fa-power-off`, Flip `fa-right-left`.
   - **Audit log** grid. Columns `190px 220px 1fr`:
     - Time (mono)
     - Action (accent icon + label)
     - Details
     - Footer note: `fa-eye-slash` "Secrets are never written to the audit log."
5. **Consistency heatmap card**. See the Heatmap section below.

**States:**
- **loading**: 5 skeleton stat cards (bars in `--surface`, radius full) plus a table skeleton with a `fa-circle-notch fa-spin` "Loading data from exchange…".
- **empty**:
  - Stats: Spot 0.00, Futures 10,000.00, PnL 0.00, Positions 0.
  - No alerts.
  - Positions tab: `fa-layer-group` icon, "No open positions", explanation, and a "New strategy" button when no strategies exist.
  - History tab: "No closed trades yet".
  - Heatmap: all empty.
- **error**: the same data at opacity 0.6 (stale), the unreachable + key-error banners, and the status pill set to "Exchange unreachable".

### 2b. Trade detail drawer
- Fixed right panel, `width: min(480px, 100%)`, bg `--bg-raised`, left border, scrollable. Backdrop `rgba(15,19,22,0.6)`; clicking the backdrop closes the drawer.
- **Header**: trade ID (mono 12, muted); title `BTCUSDT · Futures · Long` (20 / 700); time; close button (36 px circle).
- **Badge**: amber `Badge` "Jev fallback: base size" (`fa-robot`), shown when applicable.
- **2×2 fact tiles** (radius 12, bg `--bg-base`):
  - Signal timeframe: "1D" or "4H late entry"
  - 1W trend at entry: Up/Down with a trend icon
  - Entry
  - Exit reason
- **Flip note** (below the fact tiles; futures only, spec B7.5):
  - **Opened by a flip** (the previous trade's exit reason is Flip): panel with `--accent-soft-bg`, radius 12, padding 14, `fa-right-left` in `--text-accent`, title "Flip", note (13 px secondary), and a text link "Previous trade T-1039 →" (accent, 600, ID in mono) that switches the drawer to that trade.
    - Long → Short: "Opened after a profitable Long closed on first red. 2 of 3 short factors present (minimum 2). 1W filter not applied to flips."
    - Short → Long: "Opened after a profitable Short closed on first green. 2 of 3 long factors present (minimum 2). 1W filter not applied to flips."
    - The count is the number of present factors on this trade (always ≥ 2 for a flip).
  - **Closed by a flip** (exit reason Flip): same layout with a 1 px `--border` outline instead of the tint, title "Flipped", note "Closed on first red with profit. 2 of 3 short factors were present, so the opposite side opened on the same candle." (first green / long factors for a short), and a link "Next trade T-1043 →".
  - Sample chains: T-1039 (Long, Flip) → T-1043 (Short, opened by flip); T-1038 (Short, Flip) → T-1042 (Long, opened by flip, 1W trend Down to show the filter is skipped).
- **Confluence factors**. The header shows "Threshold 0.70". Each row (radius 10, 1 px border) has:
  - a ✓ (`fa-check`, positive colour) or ✗ (`fa-xmark`, negative colour) icon
  - the name, by trade side (spec B8.1):
    - Long: Channel breakout / Capitulation / Higher low
    - Short (mirrored): Channel breakdown / Euphoria / Lower high
    - Sample short trades: T-1043, T-1038 (and T-1040, a late entry with no factors).
  - an 80 × 6 px confidence bar (accent if ≥ threshold, else `--ink-400`)
  - the confidence value (mono, 2 decimals)
  - the label "Present" / "Not present"
  - For late entries and Jev fallbacks, the values show "—" with a note: "Late entries use base size only. No confluence bonus." or "Jev did not answer within {timeout} s. All factors treated as not present."
  - `{timeout}` is the Jev timeout from Settings → Trading (default 3). In production, use the timeout that applied when the entry was made (store it with the trade, spec B8.5); the prototype reads the current setting.
- **Sizing box**:
  - Resulting size: `base 10% + 2×20% = 50%` (formula `size = base + 20 × present`, capped at 100; base only for late or fallback entries)
  - Sizing mode
  - Leverage used, with the sub-note "lowered from 5x to 3x"
- **PnL box**: Gross, Fees, Funding ("—" for spot), **Net realised PnL** (600).

### 2c. Consistency heatmap
- Card title "Consistency — daily trading activity" (16 / 600, with the subtitle part in secondary colour). Right side: "last 12 months" (mono 12, muted).
- Month label row, then the grid:
  - `grid-auto-flow: column; grid-template-rows: repeat(7, auto); grid-template-columns: repeat(53, minmax(0,1fr)); gap: 4px`
  - Min-width 720, scrolls horizontally.
  - Cells: `aspect-ratio: 1`, radius 3, 1 px border.
  - Columns are weeks (Sunday first); the last column ends today (2026-09-27 in the sample). Padding cells after today are transparent.
- Month labels: mono 10 / 600, tracking 0.06em, muted. EN uses `JAN…DEC`; TH uses `ม.ค.…ธ.ค.`.
- Levels (count → fill / border):
  - 0 → `--bg-base` / `--border`
  - 1 → rgba(99,102,241,.22) / .30
  - 2 → rgba(99,102,241,.42) / .50
  - 3 → rgba(99,102,241,.68) / .75
  - ≥4 → `--indigo-500` / `--indigo-400`
- Footer: "{d} trading days out of {n} · longest streak {s} days" on the left; the legend "Less ■■■■■ More" (12 px squares) on the right.
- **Hover tooltip**:
  - Fixed position, 260 px wide, radius 12, `--shadow-xl`, `pointer-events: none`.
  - Centred above the cell (flips below it if less than 230 px of space above), clamped 142 px from the viewport edges.
  - The hovered cell gets a `0 0 0 2px var(--indigo-400)` ring.
  - Header: date (mono 15 / 600) and weekday. TH format is `3 ก.ย. 69 · วันพฤหัสบดี` (Buddhist year, 2 digits); EN format is `Sep 3, 2026 · Thursday`.
  - Rows: Trades (`3 รายการ` in TH); PnL (signed, coloured, " USDT"); Win / Loss `2W / 1L · 67%`.
  - Dashed divider, then "Activity level": None / Low / Normal / High / Very high (TH: ไม่มี / น้อย / ปกติ / สูง / สูงมาก), in accent colour.
- **Mobile**: same component, last 16 weeks, subtitle "last 16 weeks".

### 2d. Dashboard (mobile)
Stack, gap 24 (16 px padding):
- 2×2 stat grid (Futures, Spot, Today, Total; 17 px values).
- Alerts.
- "Open positions" header + count.
- Position cards (radius 14, padding 14):
  - Pair + side · market · leverage on the left; PnL value and % on the right.
  - A 3-column row: Entry / Mark (+24h change) / Stop.
- Heatmap (16 weeks).
- "Trade history": 4 rows, min-height 56 (touch target), each opening the drawer.
- Bottom spacer 88 px, then the sticky Kill switch bar.

### 3. Strategies
- **Header**: "Strategies" + subtitle "One enabled strategy per pair. Trading decisions are automatic." Primary "New strategy" button (`fa-plus`) on the right.
- **List grid** (min-width 1380). Columns `1.1fr 130px .7fr 1.3fr 1.4fr 170px 1fr .7fr .7fr 250px`:
  1. Pair (600) with the strategy ID (mono 11, muted) below.
  2. **Price · 24h**: current price (mono 500) with the 24h % change below it (11 px, coloured, caret). Right-aligned, 16 px right padding.
  3. Market.
  4. State badge. Tinted DS `Badge` with icon:
     - Warming up — sky, `fa-hourglass-half`
     - Waiting for signal — indigo, `fa-clock`
     - In position — green, `fa-circle-dot`
     - Needs attention — orange, `fa-triangle-exclamation`, with the reason as a note below (11 px secondary, wraps): one of the five reasons listed under Dashboard alerts. Sample: S-03 SOLUSDT (stop missing, still in position), S-05 AVAXUSDT (margin), S-09 ADAUSDT (reconciliation), S-10 LTCUSDT (liquidation skip), S-11 DOTUSDT (halted).
     - Disabled — neutral pill (`--surface` bg, `fa-pause`)
     - Closed — neutral pill (`fa-flag-checkered`)
  5. Position summary (mono 12), e.g. `Long 0.050 @ 61,240.00`, or "—".
  6. **30-day PnL**:
     - 96 × 32 SVG sparkline: 30 points, 1.75 px stroke, round joins, coloured by the sign of the final value.
     - A dashed zero line (`--border-strong`, dasharray 2 3).
     - The signed total (mono 12 / 500 + caret) next to it.
  7. Sizing mode: `A · margin` / `B · notional` / `C · risk`, or "—" for spot.
  8. Leverage: `5x`, or `5x (3x)` when a lower leverage is in use; "—" for spot.
  9. Margin mode: Isolated / Cross / "—".
  10. Actions (right-aligned, small buttons):
      - Enable (primary, `fa-play`) when Disabled/Closed.
      - Disable (secondary, `fa-pause`) when enabled.
      - Edit (ghost, `fa-pen`).
      - Close (outline, negative text colour, `fa-xmark`) when in a position.
- **Behaviours**:
  - **Enable** opens a TOTP modal ("Enable S-07?"). On success the state becomes Warming up (or In position if it already holds a position) and a toast appears.
  - If another enabled strategy already exists on the same pair, Enable shows an error toast naming it instead of opening the modal.
  - **Disable** acts immediately. The toast reads "S-01 disabled · still managing its open position" when a position exists.
  - **Close** opens a confirm modal listing "Market close: {position}" and "Cancel stop and take-profit orders". The danger button "Close at market" sets the state to Closed.
- **States**:
  - loading: spinner row + 5 skeleton rows; the New button is disabled.
  - empty: `fa-chess-knight` icon, "No strategies yet", explanation, "New strategy" button.
  - error: amber banner "Exchange unreachable — States and positions may be out of date…".

### 3b. Create / Edit strategy
- Back link, title "New strategy" or "Edit strategy · S-01".
- Two-column grid `repeat(auto-fit, minmax(320px, 1fr))`, gap 24: form card on the left, sticky "Sizing preview" card on the right.
- **Pair**: search input (40 px, mono, `fa-magnifying-glass`) and a dropdown of USDT pairs (max-height 220, `--shadow-xl`).
  - Pairs that already have an enabled strategy show "{id} · {state}" on the right.
  - Only USDT pairs are allowed.
  - Duplicate rule: when the chosen pair already has an enabled strategy, the input border turns `--danger` and an inline error appears: "{pair} already has an enabled strategy: {id} ({market}). Disable it first." Save is disabled.
- **Market**: segmented control Spot / Futures (default Futures).
- **Futures only**:
  - Leverage: range 1–20, default 5, value shown as mono `5x`. Helper: "Ceiling, not a target. Cane may use less when liquidation would sit inside the stop. Max 20x."
  - Margin mode: segmented control Isolated (default) / Cross.
  - Sizing mode: three radio cards (radius 12, 1.5 px border; selected = `--accent` border + `--accent-soft-bg` fill + `fa-circle-dot`):
    - **A · % equity as margin** — "Size % of equity is posted as margin. Notional = margin × leverage."
    - **B · % equity as notional** (default) — "Size % of equity is the position notional. Leverage only changes margin used."
    - **C · Risk % per trade** — "Size so a stop-out loses a set % of equity, scaled by confluence."
  - **Lock**: when editing a strategy with an open position, Pair, Market, Leverage and Margin mode are disabled at 0.55 opacity. A note with `fa-lock` reads: "Leverage and margin mode are locked while {id} has an open position. They can change after the position closes."
- **Base size**: range 5–20, default 10. Helper: "5–20%. Each confirmed confluence factor adds 20%."
- **Jev confidence threshold**: number input, step 0.05, default 0.70.
- **Risk at full confluence (%)**: mode C only, default 2.
- Footer: Cancel (ghost) / Save (primary, `fa-check`). New strategies are saved as Disabled.
- **Sizing preview** (live). Futures equity is 10,000.00 and Spot equity is 4,120.55.
  - Headline (mono, `--accent-soft-bg` box):
    - Mode A: `With 10,000.00 USDT and 5x: 10% → notional 5,000.00, margin 1,000.00`
    - Mode B: `With 10,000.00 USDT and 5x: 20% → notional 2,000.00, margin 400.00`
    - Mode C: `With 10,000.00 USDT: risk 0.20% of equity → 20.00 USDT lost at stop` (effective risk = risk × size / 100)
    - Spot: `With 4,120.55 USDT: 10% → buy 412.06 USDT`
  - Rows: Base only (b%), 2 factors (b+40%), All 3 factors (min(100, b+60)%).
  - Note: mode C assumes a stop 4% away.

### 4. Kill switch
- **Entry points**: the header button, the mobile sticky bar, and the Kill switch page when not killed. The page shows a 64 px red-ring icon, an intro, and a 52 px danger button "Stop all trading".
- **Confirmation modal**:
  - One step, no TOTP.
  - Title "Stop all trading?", body "This acts immediately and cannot be undone in one step."
  - List:
    - Disable all strategies
    - Cancel all orders placed by Cane
    - Close all Cane positions at market
    - Positions not opened by Cane are not touched (neutral)
  - Danger button "Stop all trading".
- **Result page**:
  - Title "Trading stopped" with `fa-circle-stop`, plus the activation timestamp.
  - "Result per pair" card with an `ok/total` count. Rows show pair · market, what was done ("Long 0.050 · 2 orders"), and a status:
    - Closed (`fa-circle-check`, positive)
    - Orders cancelled
    - Failed · retrying (`fa-rotate fa-spin`, `--warning`). In the prototype it resolves to Closed after 4 s.
  - Note: "Positions not opened by Cane were not touched (1: XRPUSDT Spot, manual)."
  - "How to resume" box: there is no global restart; re-enable each strategy (each asks for TOTP).
- **After kill**:
  - All strategies become Disabled (Closed stays Closed) and positions clear.
  - The persistent banner shows on every page and clears when the first strategy is re-enabled.
  - The status pill reads "Stopped by kill switch".

### 5. Settings
Left sub-nav, 220 px, sticky: Exchange keys `fa-key`, Notifications `fa-bell`, Trading `fa-sliders`, Security `fa-lock`. The content column has max-width 720 and holds cards.
- **Exchange keys**:
  - Saved state: `fa-key` row with "API key" and a masked `•••• 4F2A` (mono 600), plus a Replace button.
  - Replace state: a helper line above the inputs (`fa-circle-info` in `--text-accent`, 13 px secondary): "In Binance API settings enable Reading, Spot & Margin Trading and Futures. Keep Withdrawals and Universal Transfer off." Then API key and API secret fields (secret type=password, hint "Write-only. Stored encrypted."), Cancel, and "Save with TOTP" (disabled until both are filled).
  - Validation box (radius 12, padding 12×14, icon + bold title + 13 px guidance; `role="alert"` for red):
    - **Accepted** (green, `fa-circle-check`): "Read, Spot and Futures trading enabled. Withdrawals and universal transfer disabled."
    - **Rejected: withdrawal permission is enabled** (red, `fa-circle-xmark`): "Create a key without withdrawal permission and paste it again."
    - **Rejected: trading permission is missing** (red): names the missing market — "{Market} trading is not enabled on this key. Turn it on in Binance API settings, then paste the key again." Sample: "Futures trading is not enabled on this key…". The check runs per market in use (spec B15.2).
    - Not validated yet (neutral): shown while replacing, before saving.
  - Rejected results keep the replace form (inputs cleared); Accepted returns to the masked row.
  - Keys are not IP-restricted: the bot runs on Railway Hobby with no static outbound IP (spec rev 5). There is no IP check, no server IP and no IP guidance anywhere in the app.
- **Notifications**: one card each for LINE (`fab fa-line`; Channel access token + Target ID) and Telegram (`fab fa-telegram`; Bot token + Chat ID).
  - Each card has a 44 × 24 toggle switch (on = `--accent-strong`), the state label, secret-type inputs, "Send test message" (toast), and the last test status.
  - "Save with TOTP" at the bottom.
- **Trading**: Jev timeout (number, default 3, unit "seconds"). Helper: fallback to base size + Jev fallback flag.
- **Security**:
  - Change password (current / new / confirm).
  - Re-setup TOTP (asks for TOTP).
  - Regenerate recovery codes: **asks for a fresh 6-digit TOTP first** (shared TOTP modal, title "Regenerate recovery codes?", body "Enter a fresh 6-digit code. New codes replace all earlier ones, which stop working immediately.", confirm button "Regenerate" with `fa-arrows-rotate`). Only after a valid code: amber "shown once" warning, 10 codes in `XXXX-XXXX` mono in a grid, Copy / Download buttons. `000000` shows the code error and no codes.
  - Active session: Device, IP, Signed in, Expires; Sign out.

### Shared modal
- Backdrop `rgba(15,19,22,0.66)`.
- Dialog: max-width 460, radius 16, padding 24, gap 16, `--shadow-xl`.
- Header: 42 px icon tile (accent-soft for TOTP, red-bg for destructive), title 18 / 700, body 14 secondary.
- TOTP input: 54 px, mono 24 px, spacing 0.5em, digits only, max 6. The confirm button is disabled until 6 digits are entered. An invalid code shows an inline error: "Code not accepted. Wait for the next code and try again."
- Buttons: Cancel (ghost) and Confirm (primary, or a red `--danger` button for destructive actions).

### Toast
Fixed bottom-centre (28 px from the bottom), pill, bg `--gray-900`, white 13 px, `fa-circle-check` in `--success`, auto-hides after 2.6 s.

---

## Interactions & Behavior
- **Navigation**: header nav switches pages. Mobile forces Dashboard (Strategies/Settings are desktop-only).
- **Language**: TH/EN switches all copy instantly (full dictionaries `EN` / `TH` are in the prototype script; reuse the strings).
- **Theme**: dark is the default (`:root`); light is applied with the `.light` class on the root and on portalled overlays (drawer, modal, tooltip).
- **Transitions**: quiet. Use `--dur-fast` 0.15 s for colour and press, `--dur-normal` 0.25 s, easing `cubic-bezier(0.16,1,0.3,1)`. Respect `prefers-reduced-motion`. Spinners use Font Awesome `fa-spin`.
- **TOTP gates** (fresh code each time, shared TOTP modal): Enable strategy, Save exchange keys, Save notifications, Re-setup TOTP, Regenerate recovery codes. The kill switch does **not** require TOTP.
- **Validation**:
  - Pair must be a known USDT pair.
  - One enabled strategy per pair.
  - Base 5–20.
  - Threshold 0–1.
  - Risk only for mode C.
  - TOTP exactly 6 digits.
- **Login lockout**: 5 consecutive failures → 15 min lock. The countdown ticks every second.

## State Management
- Session: `screen` (login | app), `loginStep`, `email`, `password`, `attempts`, `lockUntil`.
- UI: `page`, `lang`, `theme`, `dashTab`, `settingsTab`, `modal {type, action, ctx}`, `modalCode`, `trade` (open drawer id), `hmHover`, `toast`.
- Domain (from the API):
  - `equity {spot, futures}`, `pnl {today, total}`, `systemStatus`
  - `positions[]`, `trades[]` (including factors, sizing, leverage lowering, fallback flag, fees, funding), `auditLog[]`
  - `strategies[]` (id, pair, market, state, position, mode, lev ceiling, lev used, margin, base, thr, risk, attention reason: `margin` | `reconcile` | `stopMissing` | `liqSkip` | `halted`)
  - trades also carry `flipFrom` / `flipTo` (previous / next trade ID) and the Jev timeout used
  - `prices{pair: [last, change24h]}`, `strategyPnl30d{id: number[]}`, `dailyActivity[] {date, trades, wins, losses, pnl}`
  - `killResult[] {pair, market, what, status}`
- Suggested polling: dashboard and positions every 10 s; prices via websocket if available.

## Design Tokens
Source files are in `tokens/` (colors.css, typography.css, spacing.css, fonts.css).
- **Ink**: 900 #0f1316 · 800 #151a1e (dark base) · 700 #1e252b · 600 #2b3740 · 500 #3a4a55 · 400 #55687a
- **Paper / Gray**: 0 #ffffff · 50 #f9fafb · 200 #e5e7eb · 300 #d1d5db · 400 #9ca3af · 500 #6b7280 · 600 #4b5563 · 700 #374151 · 800 #1f2937 · 900 #111827
- **Indigo**: 100 #e0e7ff · 200 #c7d2fe · 300 #a5b4fc · 400 #818cf8 · 500 #6366f1 · 600 #4f46e5 · 700 #4338ca
- **Status**: success #22c55e · warning #f59e0b · danger #ef4444
- **Families** (bg / fg):
  - teal #ccfbf1 / #115e59
  - amber #fef3c7 / #92400e
  - sky #e0f2fe / #075985
  - green #dcfce7 / #166534
  - orange #ffedd5 / #9a3412
  - red #fee2e2 / #991b1b
  - purple #f3e8ff / #6b21a8
- **Semantic, dark**: bg-base ink-800 · bg-raised ink-700 · surface ink-600 · surface-hover ink-500 · border ink-600 · border-strong ink-500 · text-primary #fff · text-secondary gray-400 · text-muted gray-500 · text-accent indigo-300 · accent indigo-500 · accent-strong indigo-600 · accent-soft-bg rgba(99,102,241,.14)
- **Semantic, light (`.light`)**: bg-base paper-50 · bg-raised #fff · surface #fff · border gray-200 · border-strong gray-300 · text-primary gray-900 · text-secondary gray-600 · text-muted gray-400 · text-accent indigo-600 · accent indigo-600 · accent-strong indigo-700 · accent-soft-bg indigo-100
- **Type**:
  - Poppins 400/500/600/700; JetBrains Mono.
  - Sizes used: 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28 px.
  - Headings use −0.02em tracking.
- **Spacing**: 4 px grid (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96).
- **Radii**: 3 (heatmap cells) · 8 (inputs, buttons) · 10–12 (panels, alerts) · 14 (mobile cards) · 16 (cards) · 28 (mobile frame) · full (pills).
- **Shadows**:
  - lg `0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)`
  - xl `0 20px 25px -5px rgba(0,0,0,.1), 0 10px 10px -5px rgba(0,0,0,.04)`

## Components used from the design system
From `PortfolioAndBlog_de37a5` (source in `prototype/_ds/.../_ds_bundle.js`):
- `Button`: variant primary / secondary / ghost; size sm / md / lg; `icon`, `iconRight`, `block`, `disabled`.
- `Badge`: `color` from the families; `icon`.
- `Field`: `label`, `type`, `icon`, `hint`, `placeholder`, controlled `value` / `onChange`.

Recreate them with the codebase's own components where equivalents exist.

## Assets
- Icons: Font Awesome 6.5.1 (Solid + Regular + Brands). No custom images or emoji.
- Fonts: Poppins, JetBrains Mono, Noto Sans Thai.
- **Production must self-host fonts and icons.** Serve the Poppins, Noto Sans Thai and JetBrains Mono font files and the Font Awesome CSS + webfonts from the app's own origin. No third-party CDN (Google Fonts, cdnjs, unpkg, etc.) on authenticated pages. The prototype loads them from Google Fonts and cdnjs only for convenience.
- Charts:
  - The sparkline is plain inline SVG (polyline).
  - The heatmap is a CSS grid.
  - Either can be replaced by the codebase's chart library, as long as it matches the visuals above.

## Files
- `prototype/Cane Auto Trader.dc.html` — the full interactive prototype (markup + logic + EN/TH dictionaries + sample data).
- `prototype/support.js` — prototype runtime (not needed in production).
- `prototype/_ds/…` — design-system bundle and tokens the prototype loads.
- `tokens/*.css` — design tokens (copy into the app's styles).
- `../intent.md`, `../spec.md` — product intent and functional spec (the source of truth for business rules).
- `../design.md` — short design summary and change log.
