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

`Position` says where the position given to the replay came from:
`recorded` (the engine wrote it with its decision), `rebuilt` (rows from
before S13, or a missing key; the stop is tick-rounded) or `unreadable`
(the recorded `input` did not parse, so it was rebuilt; check the recorded
shape first).

Window: 30 days from the first live evaluation of S-01 (2026-10-09).

## Daily results

| UTC day | Strategy | Result | Mismatches |
|---|---|---|---|
| 2026-10-09 | S-01 BTCUSDT futures | 5/5 match | 0 |
| 2026-10-10 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-11 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-11 | S-02 XAUTUSDT futures | 0/0 match | 0 |
| 2026-10-12 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-12 | S-02 XAUTUSDT futures | 3/3 match | 0 |
| 2026-10-13 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-13 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-14 | S-01 BTCUSDT futures | 4/6 match | 2 (`missing_live`, downtime) |
| 2026-10-14 | S-02 XAUTUSDT futures | 4/6 match | 2 (`missing_live`, downtime) |
| 2026-10-15 | S-01 BTCUSDT futures | 3/6 match | 3 (`missing_live`, downtime) |
| 2026-10-15 | S-02 XAUTUSDT futures | 3/6 match | 3 (`missing_live`, downtime) |
| 2026-10-16 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-16 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-17 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-17 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-18 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-18 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-19 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-19 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-20 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-20 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-21 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-21 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-22 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-22 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-23 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-23 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-24 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-24 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-25 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-25 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-26 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-26 | S-02 XAUTUSDT futures | 6/6 match | 0 |
| 2026-10-27 | S-01 BTCUSDT futures | 6/6 match | 0 |
| 2026-10-27 | S-02 XAUTUSDT futures | 6/6 match | 0 |

S-02 (XAUTUSDT futures) was created on 2026-10-11; its first full day is 2026-10-12
(3/3: enabled mid-day). Results are from the daily LINE summaries; restarts re-ran the
previous day and always gave the same result.

Check failures (the tool, not a mismatch; the day was re-run later):
- 2026-10-14 22:08 ICT and 2026-10-15: `replay-diff printed no JSON result`. The real
  error was hidden; PR #40 (merged 2026-10-15) makes the check fail with it.
- 2026-10-15 21:46 ICT and 2026-10-16 06:26 ICT: `Klines request failed with status
  451` (Binance geo-block, see the downtime below). Runs minutes before and after each
  of these succeeded with the same result.

Downtime: on 2026-10-14 and 2026-10-15 Railway's Singapore egress IP geolocated to the
US and Binance answered HTTP 451, so the engine could not evaluate some 4H closes. The
replay-diff shows which: live missed the closes at 2026-10-14 16:00 and 20:00, 2026-10-15
00:00 and 04:00, and 2026-10-15 16:00 UTC; it did evaluate the 08:00 and 12:00 closes on
2026-10-15. The service moved to EU West on 2026-10-15 at about 16:30 UTC, and no close
has been missed since.

## Mismatches and explanations

| UTC day | Strategy | 4H key (UTC) | Outcome | Position | Live | Replay | Explanation |
|---|---|---|---|---|---|---|---|
| 2026-10-14 | S-01 | 2026-10-14 12:00 | `missing_live` | rebuilt | none recorded | none:no_signal | 451 downtime. Replay would not have traded. |
| 2026-10-14 | S-01 | 2026-10-14 16:00 | `missing_live` | rebuilt | none recorded | none:no_signal | 451 downtime. Replay would not have traded. |
| 2026-10-14 | S-02 | 2026-10-14 12:00 | `missing_live` | rebuilt | none recorded | warming_up 1w | 451 downtime. Replay was still warming up, so no trade. |
| 2026-10-14 | S-02 | 2026-10-14 16:00 | `missing_live` | rebuilt | none recorded | warming_up 1w | 451 downtime. Replay was still warming up, so no trade. |
| 2026-10-15 | S-01 | 2026-10-14 20:00 | `missing_live` | rebuilt | none recorded | none:no_signal | 451 downtime. Replay would not have traded. |
| 2026-10-15 | S-01 | 2026-10-15 00:00 | `missing_live` | rebuilt | none recorded | none:no_signal | 451 downtime. Replay would not have traded. |
| 2026-10-15 | S-01 | 2026-10-15 12:00 | `missing_live` | rebuilt | none recorded | none:no_signal | 451 downtime. Replay would not have traded. |
| 2026-10-15 | S-02 | 2026-10-14 20:00 | `missing_live` | rebuilt | none recorded | warming_up 1w | 451 downtime. Replay was still warming up, so no trade. |
| 2026-10-15 | S-02 | 2026-10-15 00:00 | `missing_live` | rebuilt | none recorded | warming_up 1w | 451 downtime. Replay was still warming up, so no trade. |
| 2026-10-15 | S-02 | 2026-10-15 12:00 | `missing_live` | rebuilt | none recorded | warming_up 1w | 451 downtime. Replay was still warming up, so no trade. |

The 4H key is the candle's open time; the day is the UTC day of its close. Source: the
`replay-diff-cli --day` JSON for 2026-10-14 and 2026-10-15, re-run on 2026-10-28. No
`differ` and no `missing_replay` so far: every mismatch is a missed live evaluation
during the 451 downtime, and the replay shows none of them would have placed an order.
