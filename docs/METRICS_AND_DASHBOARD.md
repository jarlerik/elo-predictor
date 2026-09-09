# Metrics and dashboard plan

Goal: replace "Total staked / Total return / Return rate" on the Results page
with enough measurement to answer three questions before the next bet is
placed:

1. **Is the model any good?** Are its probabilities calibrated, and are they
   sharper than the bookmaker's?
2. **Where is the edge?** Which leagues, markets and odds ranges make money,
   and which only look like they do because of a few lucky hits?
3. **Is the staking sound?** Are stakes in line with the Kelly output, and is
   the bankroll exposed to drawdowns it cannot survive?

Return rate on its own answers none of these. With a handful of bets, ROI is
almost entirely noise; a single 12x correct-score hit swings it by 100
percentage points. The metrics below are chosen so that they say something
useful long before ROI does.

## What is recorded today, and what is missing

| Data                              | Today                                                        | Gap                                                                                  |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Winner bets (`*_winner.json`)     | team, model prob, odds taken, stake, market, timestamp       | no league, no odds for the other outcomes, no closing odds, no bookmaker             |
| Score bets (`HOME__AWAY_date.json`) | score, model prob, `odds` (= the min odd shown, not the odd taken), stake | no timestamp, no odds actually taken, no market prices for the lines               |
| Results (`results.json`)          | game, pick, prob, odds, return                               | no stake, no settle date, no actual final score, losing score lines are not itemised |
| Predictions shown but not bet     | nothing                                                      | calibration needs all predictions, not just the ones that were bet on                |
| Bankroll                          | nothing                                                      | Kelly output cannot be compared to the stake without a bankroll figure               |

Two consequences matter most:

- **Calibration cannot be measured from bets alone.** Bets are a biased
  sample (only the lines where the model disagreed with the market). The
  Elo model must be scored on every played game.
- **Edge cannot be separated from luck without the market's price.** Storing
  the full 1X2 odds at bet time (and ideally at kick-off) is the single most
  valuable change in this plan.

## Metrics

### A. Model quality (scored on all played games, per league)

Computed by walking the game history in date order and, for every game,
using the ratings *as they were before that game* to produce 1X2 and
correct-score probabilities. This is a backtest; it needs no bets.

| Metric                    | Definition                                                                          | Why it matters                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Brier score (1X2)         | mean over games of Σ (p_outcome − actual)²                                          | Headline accuracy; compare against the "always league average" baseline          |
| Log loss (1X2)            | −mean log p(actual outcome)                                                         | Punishes confident misses; the score Kelly growth actually depends on             |
| Calibration table         | bucket predictions by p (0–10 %, 10–20 %, …); show predicted vs observed frequency | Shows *where* the model is over/under confident (e.g. draws, heavy favourites)    |
| Draw rate: model vs actual| mean predicted draw prob vs share of games drawn                                    | Validates `SOCCER_DRAW_FACTOR` and the fitted hockey factor                       |
| Home advantage check      | mean predicted home-win prob vs observed home-win rate                              | Validates `HOME_ADV` = 60 per league; Liiga and EPL likely differ                 |
| Correct-score log loss    | −mean log p(actual score)                                                           | Scores the Poisson layer separately from Elo                                      |
| Skill vs market (when odds stored) | model Brier − de-vigged bookmaker Brier                                     | Negative = model is sharper than the book on that segment. This is the edge test  |

Report each per league and per season, plus a rolling 100-game window so a
drift (roster change, rule change) is visible.

### B. Betting performance (scored on settled bets)

| Metric                          | Definition                                                                                   | Notes                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Profit, turnover, yield         | Σ (return − stake), Σ stake, profit / turnover                                               | Yield is the number to quote, not "return rate" over unsettled stakes                         |
| Expected profit                 | Σ stake × (p_model × odds − 1)                                                               | What the model *thought* it would earn. Gap to actual profit = variance or model error        |
| Market-expected profit          | Σ stake × (p_book × odds − 1), p_book de-vigged                                              | Always ≤ 0 if the book is right. Actual profit sitting between the two is the healthy picture |
| Closing line value (CLV)        | mean of (odds taken / closing odds − 1), and % of bets that beat the close                  | Best-known leading indicator of long-run profit; meaningful after ~50 bets, unlike ROI        |
| Hit rate vs expected hit rate   | wins / n vs Σ p_model / n                                                                    | Cheap sanity check on calibration *within* the bet sample                                     |
| Profit z-score                  | (actual − expected) / √Σ stake² × p(1−p) × odds²                                             | Says whether the result so far is distinguishable from luck (|z| < 2 means: not yet)          |
| Cumulative profit curve         | profit over time, with the expected-profit line drawn alongside                              | The chart people actually look at; the expected line keeps it honest                          |
| Max drawdown                    | largest peak-to-trough fall of cumulative profit, in € and in % of bankroll                  | Drives the Kelly divider choice                                                               |

### C. Segments (same metrics, sliced)

Every metric in B should be filterable by:

- **League** (NHL, Liiga, EPL, UCL, World Cup)
- **Market** (regulation 1X2, moneyline, full-time 1X2, correct score)
- **Pick type** (home, draw, away)
- **Odds band** (< 1.5, 1.5–2, 2–3, 3–5, 5–10, > 10). Correct-score bets at
  12–19x live in the band where books over-price longshots; this slice will
  show quickly whether those lines are +EV or just fun.
- **Model edge band** (p_model × odds − 1: 0–5 %, 5–10 %, 10–20 %, > 20 %).
  If the biggest "edges" lose the most, the model is overconfident, not the
  market wrong.
- **Elo gap** between the teams, and **games played this season** by both
  teams (early-season ratings still carry last season's roster).
- **Days since last game** for each team, once fixtures are stored.

Each segment shows bet count next to the metric. A segment under ~30 bets is
greyed out on the dashboard rather than hidden, so it is clear the number
exists but does not mean much yet.

### D. Staking discipline

| Metric                       | Definition                                                     |
| ---------------------------- | -------------------------------------------------------------- |
| Stake vs Kelly stake         | stake / (bankroll × Kelly fraction / divider), per bet         |
| Bankroll fraction per bet    | stake / bankroll at time of bet                                |
| Daily exposure               | Σ open stakes on one match day / bankroll                      |
| Correlated exposure          | stakes on lines of the same game (six score lines on ARS–CHE are one correlated position, not six bets) |

Requires a bankroll figure; see data changes.

## Data changes

### 1. One bet ledger instead of per-game files

Keep writing the current files if the Played Bets pages depend on them, but
also append every bet to `data/ledger.jsonl` (one JSON object per line, easy
to append, easy to load into anything). Fields:

```json
{
  "id": "2026-09-09T07:45:58Z-HPK-ILV-1",
  "placedAt": "2026-09-09T07:45:58.348Z",
  "league": "liiga",
  "game": { "home": "HPK", "away": "ILV", "date": "2026-09-09" },
  "market": "regulation",
  "pick": "ILV",
  "stake": 5,
  "oddsTaken": 1.6,
  "bookmaker": "veikkaus",
  "marketOdds": { "home": 2.6, "draw": 4.1, "away": 1.6 },
  "model": {
    "probs": { "home": 0.24, "draw": 0.13, "away": 0.63 },
    "homeElo": 1487, "awayElo": 1561,
    "homeGamesThisSeason": 2, "awayGamesThisSeason": 2,
    "drawFactor": 0.61, "homeAdv": 60
  },
  "closingOdds": null,
  "bankrollBefore": 200,
  "kellyDivider": 4,
  "settledAt": null,
  "result": null,
  "return": null
}
```

- `marketOdds` is the bookmaker's full price list at bet time; de-vig it by
  normalising 1/odds to sum to 1 (or Shin's method later). This is what makes
  the "skill vs market" and "market-expected profit" metrics possible.
- `closingOdds` is filled in by hand (or a small script) just before kick-off.
  Missing is fine; CLV is computed over the bets that have it.
- `model` is a snapshot. Ratings drift, so recomputing the probability later
  gives a different number; the decision was made on this one.
- Correct-score bets are one ledger row per line, sharing a `positionId`, so
  correlated exposure can be summed.

Settlement writes `settledAt`, `result` (`"win" | "loss" | "void"`, plus the
actual final score and whether it went to OT/SO) and `return`. A losing line
is a row with return 0, not an absent row.

### 2. Prediction log

Append to `data/predictions.jsonl` every time a prediction is shown for a
game with a fixed date, whether or not it is bet. Same `model` block as above
plus the game key. This is what feeds the calibration table with the bets'
own segment (the model as it was on the day), while the backtest covers the
long history.

### 3. Bankroll

`data/bankroll.json` with a starting amount and a list of deposits and
withdrawals. Current bankroll = start + movements + Σ settled profit. The bet
form reads it so the Kelly stake can be shown next to the stake input.

### 4. Backtest cache

`GET /api/metrics/model?league=nhl` walks the game history once and caches the
per-game predictions in memory alongside the Elo cache (same 6-hour refresh).
Nothing is written to disk; the history is already available.

## Dashboard

A new **Dashboard** page in the sidebar. Panels, top to bottom:

1. **Headline tiles.** Bankroll, yield, profit vs expected profit, CLV, max
   drawdown, bet count. Each tile shows the sample size; under 30 settled bets
   the tile is muted with a "not enough data" hint.
2. **Cumulative profit chart.** Actual profit line, model-expected line,
   market-expected line, shaded ±1σ band from the z-score variance. Time on
   the x-axis, one point per settled bet.
3. **Calibration chart** per league (backtest). Predicted vs observed with
   bucket sizes as bar heights below, plus Brier / log loss against the
   baseline.
4. **Segment table.** Rows = league × market; columns = bets, turnover, yield,
   expected yield, CLV, hit rate vs expected. Toggle to slice by odds band or
   edge band instead.
5. **Open positions.** Pending bets with stake, model edge, and exposure as %
   of bankroll; a warning row when daily exposure exceeds a set fraction.
6. **Staking chart.** Scatter of stake / Kelly stake per bet over time.

Charts can be small inline SVG components (a line, a bar, a scatter); no
charting dependency is needed for this volume of data. If a library is wanted
later, pick one that renders SVG so it fits the existing CSS.

### API

| Endpoint                          | Returns                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/metrics/summary`        | headline tiles + cumulative series (actual, expected, market-expected)       |
| `GET /api/metrics/segments?by=`   | segment table for `league`, `market`, `oddsBand`, `edgeBand`, `pick`         |
| `GET /api/metrics/model?league=`  | backtest: Brier, log loss, calibration buckets, draw and home-adv checks     |
| `GET /api/metrics/staking`        | per-bet stake vs Kelly, exposure by day                                      |
| `GET /api/bankroll`, `POST /api/bankroll/movement` | bankroll figure and deposits/withdrawals                    |

All metric endpoints read the ledger; the ledger is small enough to parse on
every request for a long time.

## Decision rules the dashboard should support

The point of the numbers is to change behaviour. Suggested rules, to be
tuned once there is data:

- **Do not bet a segment whose model Brier is worse than the market's** on
  the backtest, regardless of its ROI so far.
- **Shrink edge before Kelly.** Use a blend such as
  p = 0.5 × p_model + 0.5 × p_book until the calibration table shows the
  model is trustworthy in that bucket; then move the weight toward the model.
- **Cap correlated exposure** on one game (all score lines together) at a
  fixed fraction of bankroll.
- **Treat negative CLV over 50+ bets as a stop signal** for that market even
  if profit is positive: it means the book moves against the pick after it is
  placed, and the profit is unlikely to persist.
- **Early-season guard:** reduce stakes (or skip) when either team has played
  fewer than N games this season, N set from where the calibration by
  games-played stops being noticeably worse.

## Implementation order

1. **Ledger + settlement.** New fields, write to `data/ledger.jsonl` from the
   two save endpoints, migrate the existing bet files and `results.json`
   into it with a one-off script (missing fields stay null). Settlement UI
   writes result and return per line.

   *Done (September 2026).* `src/data/ledger.ts` owns the row type and file
   access; `npm run migrate:ledger` imports the bet files and `results.json`
   (also runs by itself the first time the server needs a ledger that does
   not exist). `GET /api/ledger` lists lines, `POST /api/ledger/settle`
   settles one or many (win with return, loss, void). The Played Bets pages
   show each line's status with Lost / Void buttons and a "pending → lost"
   button per game; the return form settles a win. `/api/bets/total` and
   `/api/results` now read the ledger, so `data/results.json` is no longer
   written and stays only as the migration source. Bet forms send the
   league and a model snapshot (1X2 probabilities, Elos, draw factor, or
   Poisson means for score lines); bookmaker, market odds, closing odds and
   bankroll fields exist in the row but stay null until steps 2 and 6.
2. **Market odds at bet time.** Add the other outcomes' odds and the
   bookmaker to the bet forms. This unblocks expected-vs-market and CLV.

   *Done (September 2026).* Every outcome card and score line has a "Book
   odds" input (`src/components/BookOdds.tsx`) that shows the model edge at
   that price as soon as it is typed; the bet button stays disabled until
   the picked outcome has a price. The bet is saved at the typed odds
   (`oddsTaken`), every price typed for the market goes into `marketOdds`,
   and the bookmaker name is one shared field remembered in the browser.
   Score-bet files now keep both `odds` (taken) and `minOdd` (model).
   Rows saved without a bookmaker price, including all migrated ones, carry
   the `oddsIsMinOdd` flag so the metrics can exclude them from CLV and
   market comparisons.
3. **Summary endpoint + headline tiles + profit chart.** Replaces the four
   lines on the Results page.

   *Done (September 2026).* `GET /api/metrics/summary` (`src/data/metrics.ts`)
   returns profit, turnover, yield, model-expected profit and yield, hit rate
   vs expected hit rate, the profit z-score with its σ, max drawdown, CLV
   (over rows with closing odds), pending stake and expectation, and the
   cumulative series with one point per settled bet. Market-expected profit
   is de-vigged from `marketOdds` and reported only on the bets whose price
   list covers the whole market, next to the same bets' actual and
   model-expected profit. Void lines are counted but excluded from turnover.
   A new **Dashboard** page shows the headline tiles and the profit chart
   (inline SVG: actual line, model-expected line, ±1σ band); tiles below the
   30-bet sample are muted, and Bankroll and CLV say what they are waiting
   for. The Results page shows the same tiles above its table instead of
   the old totals.
4. **Backtest endpoint + calibration panel.** Independent of bets; the most
   informative panel on day one because it has thousands of games behind it.

   *Done (September 2026).* `GET /api/metrics/model?league=nhl|liiga|epl`
   (`src/data/backtest.ts`) replays the league's history in the same Elo
   walk that produces the live ratings (`computeElosFromGames` now takes an
   `onGame` hook that sees both ratings before each game) and scores, per
   game, the 1X2 probabilities, the hockey moneyline and the correct score
   from the recent-form Poisson layer. It returns Brier and log loss against
   the "always the league's outcome frequencies" baseline, ten calibration
   buckets (pooled and per outcome), predicted vs observed draw, home and
   away rates, correct-score log loss against a constant Poisson at the
   league's mean goals, the top-score hit rate, all of that per season, and
   a rolling 100-game Brier series. The result is cached with the league's
   Elo state, so it is recomputed on the same 6-hour refresh. Skill vs
   market stays null until odds are stored for played games (step 7). The
   Dashboard has a **Model calibration** panel with one card per league:
   calibration chart (predicted vs observed with bucket sizes as bars,
   season and outcome selectors), the scores against their baselines, a
   per-season table and the rolling Brier chart. First run over two seasons:
   the EPL and Liiga 1X2 models beat the baseline clearly, the NHL model only
   just; the Poisson score layer is worse than a constant Poisson in every
   league, and the NHL home-win rate is over-predicted by two points.
5. **Segments table.**

   *Done (September 2026).* `GET /api/metrics/segments?by=` slices the
   ledger by `leagueMarket` (default), `league`, `market`, `pick`,
   `oddsBand`, `edgeBand` or `eloGap` and returns the full summary figures
   of each group (counts, turnover, profit, yield, expected yield, hit rate
   vs expected, z-score, CLV, market view). Bands follow section C; rows
   saved at the model's own fair odds go to a "No book price" edge group,
   and rows without a model snapshot to a "No model snapshot" Elo-gap group.
   Games played this season and days since last game wait for fixtures to
   be stored. The Dashboard's **Segments** panel shows the slice as a table
   with a button row to switch it; rows under 30 settled bets are greyed
   out rather than hidden.
6. **Bankroll + staking panel**, and Kelly stake shown on the bet forms.

   *Done (September 2026).* `data/bankroll.json` (`src/data/bankroll.ts`)
   holds the start amount as of a date, the Kelly divider, the daily
   exposure limit and a list of deposits and withdrawals; the current
   bankroll adds the profit of bets settled since the start date.
   `GET /api/bankroll`, `POST /api/bankroll` (start and settings),
   `POST /api/bankroll/movement` and `DELETE /api/bankroll/movement/:index`
   manage it. `GET /api/metrics/staking` gives every bet's stake against the
   fractional-Kelly stake its own snapshot implied (rows saved before the
   bankroll existed are measured against today's and flagged), the open
   exposure by day and by position, and the over-limit days. The summary
   endpoint now fills the Bankroll tile and the drawdown as a share of it.
   Every "Book odds" input shows the fractional-Kelly stake once a price
   with an edge is typed; clicking it fills the stake, and the bet is saved
   with `bankrollBefore` and `kellyDivider`. The Dashboard gets a Bankroll
   panel (setup form, movements), an Open positions table with the daily
   exposure warning, and the stake-vs-Kelly scatter. The Kelly page now uses
   the same formula as the stake hint, with b = decimal odds − 1; it used
   the decimal odds as b before, which understated the stake at short odds
   and overstated it at long odds. Days since last game and exposure by
   game date still wait for fixtures to be stored: pending bets without a
   game date are grouped by the day they were placed.
7. **Prediction log and closing odds.** Lowest effort per step but needs the
   habit of filling them in; add once the rest is in use.

## Sample-size expectations

- Backtest calibration: available immediately (three seasons ≈ 1,300 NHL
  games, ≈ 450 Liiga, ≈ 380 EPL games each season).
- CLV: informative after ~50 bets with closing odds.
- Yield per segment: needs hundreds of bets at 1.6–2.0 odds before a 5 %
  yield is distinguishable from zero; thousands at 12x+ odds. The z-score on
  the dashboard makes this explicit instead of leaving it to intuition.
