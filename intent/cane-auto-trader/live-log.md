# Live log: live == replay (AC3)

Proof for spec AC3: "Live decisions over the first 30 days equal replay
decisions for the same candles (every mismatch explained)." Plan step S13.

Each day at 00:15 UTC the server runs the replay-diff for the previous UTC
day. It sends one LINE/Telegram summary per strategy, e.g.
`BTCUSDT futures: 6/6 match`, and writes the full JSON to the server log
(`replay-diff <day>: …`). Every key that does not match gets a row below
with its explanation. A day where everything matched only needs its line in
the daily table.

Outcomes:
- `differ`: live and replay decided differently.
- `missing_live`: live has no row while the strategy was managed. Expected
  after downtime across a 4H close, or after an E4 data gap.
- `missing_replay`: the replay hit a data gap where live decided.

Window: 30 days from the first live evaluation of S-01 (2026-10-09).

## Daily results

| UTC day | Strategy | Result | Mismatches |
|---|---|---|---|

## Mismatches and explanations

| UTC day | Strategy | 4H key (UTC) | Outcome | Live | Replay | Explanation |
|---|---|---|---|---|---|---|
