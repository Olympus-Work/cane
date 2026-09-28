# Intent: CDC auto-trader on Binance (spot + futures) driven by Jev
Author: Zong (owner; personal capital). Status: approved. Date: 2026-09-25.
Approved by: Zong (owner), 2026-09-25.
Amendment 1 (2026-09-28, Zong): API key IP whitelist dropped (Railway
Hobby plan has no static outbound IP). See constraints below.
Amendment 1 approved by: Zong (owner), 2026-09-28.

## Problem
Following the CDC Action Zone system ("uncle-chaloke-trading-skill.md") by hand
means watching daily and 1H charts, judging confluence factors by eye, and
sizing positions under emotion. Signals are missed ("ตกรถ" — missed the first
green bar), the Cane Rule ("กฎไม้เรียว" — never chase after the first green) gets
broken, and position size drifts from the playbook matrix.

## Proposed outcome
A fully automated system that, without manual action:
- computes CDC Action Zone (EMA12/26) and CDC ATR Trailing Stop signals from
  Binance market data, behaving the same as the reference CDC Pine scripts
  (independently re-implemented; the scripts are not in the repo);
- uses Jev (TypeSafe AI System One model, API, early access) to classify the
  playbook's confluence factors (channel breakout, retail capitulation, higher
  low) into a typed decision + confidence, which maps to the playbook's
  position-size bands (5–20% base, +20% per factor, max 80–100%);
- trades Binance Global spot (long only) and USDⓈ-M futures (long and short):
  - long: open on first green, close on first red (per playbook);
  - short (futures only): open on first red, close on first green (mirror of
    the playbook — new logic, not from the source);
- places, trails and closes orders under hard risk limits, and logs every
  decision with its inputs and reason;
- provides a web app behind login (single user: the owner) with:
  - Dashboard: open positions, PnL, order history, Jev reasoning per trade;
  - Strategies: create / edit / close (pair, spot or futures, leverage,
    sizing mode, margin mode);
  - Kill switch: flatten all positions and stop trading;
  - Settings menu: Binance API keys, LINE and Telegram notification setup.

Success is measured as: live behaviour matches a replay of the same rules on
the same candles; zero orders outside risk limits; every order traceable to a
signal + Jev output.

## Affected users and systems
- Owner only (single personal Binance Global account).
- Binance Global Spot API and USDⓈ-M Futures API (market data + trading).
- Jev API (TypeSafe AI) — decision classifier.
- Web app (dashboard + settings) and its auth, hosted on Railway.
- Rule sources (reference only, kept outside the repo):
  `uncle-chaloke-trading-skill.md`, `cdc_action_zone.pine`,
  `cdc_trailing_stop.pine`.

## Decisions (owner, 2026-09-25)
- Personal account, unrelated to employer. Legal eligibility to use Binance
  Global is the owner's responsibility and out of scope for this system.
- Futures leverage is a config value; default **5x**.
- Each **strategy** is created by the owner with: trading pair + market
  (spot or USDⓈ-M futures). Spot strategies are long only; futures
  strategies trade long and short.
- Futures sizing mode is a config switch: A = % of equity as margin,
  B = % of equity as notional, C = fixed risk % per trade sized by stop
  distance. **Default: B** (futures risk matches the spot playbook;
  leverage only reduces margin used).
- Futures margin mode is a per-strategy option; **default: isolated**
  (cross selectable per pair).
- No automatic drawdown halt (owner decision). The only brakes are the
  per-position system stop and a manual kill switch.
- One position per pair across all markets: a pair is either spot long,
  futures long or futures short at any time — never two at once, no hedging.
- Multi-timeframe: 1W = trend filter (longs only when 1W is green, shorts
  only when 1W is red), 1D = primary signal, 4H = late-entry fallback per
  playbook section 4 ("switch timeframe").
- Jev input design: confluence features are computed deterministically in
  code; Jev classifies each factor (yes/no + confidence). Factor counts as
  present at confidence >= 0.70 (configurable). Size = base 10% (playbook
  range 5–20%, configurable) + 20% per factor present, cap 100%.
- Shorts (futures) use mirrored factors: ascending-channel breakdown,
  euphoria/blow-off (consecutive big green bars, gap up, volume spike),
  lower high. These mirrors are new logic, not from the source playbook.
- If Jev fails or times out: enter at base size only.
- First-green signal and the Cane Rule (no chasing) are decided in code, not
  by Jev; late entry is allowed only via trailing-stop entry with R:R >= 2:1.
- Deploy on Railway. Notifications to LINE and Telegram.
- Jev API usage terms: no restriction on use (per owner).
- Login: single user (owner only), email + password + TOTP 2FA. No public
  sign-up.
- Account recovery: TOTP recovery codes issued at 2FA setup; password
  reset only via Railway CLI / env (no email reset flow).
- Repository will be **public**.
- `.pine` files and `uncle-chaloke-trading-skill.md` are reference only and
  stay out of the public repo; the repo contains an independent
  implementation of the rule logic in its own code.
- Repo license: **AGPL-3.0** (anyone hosting a modified version as a
  service must publish their source).
- Go straight to live full auto. No staged rollout; owner controls exposure by
  how much capital is placed in the account.

## Constraints
- **Money-affecting.** Real capital, full auto execution.
- Jev decides *classification and sizing band* only; entry/exit triggers and
  risk limits are deterministic code. Jev cannot override a stop or a limit.
- Only the rule-based parts of the playbook are automated (sections 2–4).
  Section 5 (mindset/merit) and section 6 (BTC/Gold price targets and wave
  forecasts) are opinion, not rules, and are excluded from trading logic.
- Playbook sizing (up to 80–100%) × leverage (default 5x) can exceed account
  equity in notional; resolved by sizing mode B (% of notional) as default.
- Binance futures: margin mode is set per symbol (exchange default: cross)
  and cannot be changed while that symbol has open orders or positions; the
  system must set it explicitly before a strategy's first order.
- Before each futures entry, the system's stop (CDC trailing stop) must sit
  closer to entry than the liquidation price; if not, the system lowers that
  position's leverage (configured leverage is the ceiling), so positions exit
  at the system stop, not by liquidation.
- Must have a manual kill switch (flatten + stop trading).
- No API key IP whitelist (amendment 1): Railway static outbound IPs need
  the Pro plan; the owner runs on Hobby. Accepted risk: a leaked key can
  trade from anywhere (withdrawals stay disabled).
- LINE Notify was discontinued (2025-03-31); LINE alerts must use the LINE
  Messaging API (official account + channel access token).
- API keys: trade-only permission, withdrawals disabled, no IP whitelist.
  Entered via Settings, stored encrypted at rest (encryption key held in the
  Railway secret env, not in the database), write-only in the UI (shown
  masked, never returned in full). Never in the repo, logs or this chain.
- Web app is money-affecting: whoever logs in can trade. Requirements:
  password hashed (argon2/bcrypt), TOTP mandatory, login rate-limit and
  lockout, session expiry, HTTPS only. Changing API keys, notification
  targets or enabling a strategy requires a fresh 2FA code. Kill switch
  must work with one confirmation while logged in (no extra friction).
- Public repo: no secret, key, account ID, balance, trade history or
  personal config is ever committed — enforced by .gitignore, a secret
  scanner in pre-commit + CI (e.g. gitleaks) and GitHub push protection.
  Security must not depend on the code being private (login URL and logic
  are visible to anyone). README carries a "not financial advice, use at
  your own risk" disclaimer, since others can fork and run it with real money.
- Every settings / strategy / kill-switch action is written to an audit log
  (who, when, what changed — secrets redacted).
- No float for quantities/prices; respect Binance lot size / tick size / min
  notional filters.
- Fail-safe: if Jev is slow or unavailable, entries proceed at base size
  only (see Decisions). If Binance or market data is unavailable, no new
  entries; existing exchange-side stops stay in place.

## Open questions
None open.
Detailed feature definitions (channel detection, swing pivots, "big
candle" thresholds) move to spec.md.
