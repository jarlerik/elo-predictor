# Continuous improvement

How the model gets better, and how we know. The question is always the
same two-parter from docs/METRICS_AND_DASHBOARD.md: is the model sharper
than the market, and where would bets have paid? This document is the loop
that answers it with history before a single live bet is placed, and the
rules for reading the answer.

## The loop

1. **Hypothesis.** One change, stated as what it should improve and where
   ("regression to the mean between seasons should cut the early-season log
   loss"). Put it behind a parameter (`EloOptions`, `WalkForwardConfig`,
   `Policy`), never a hard-coded constant, so the backtest can switch it on
   and off.
2. **Backtest.** `npm run backtest:market -- epl` (add `--grid` for the
   sensitivity sweep). It walks the stored history strictly forward: the
   ratings before each game come from `computeElosFromGames`'s `onGame`
   hook, the draw factor and outcome baseline of a season are fitted on
   earlier seasons only, the age weight on K uses a fixed reference instant
   (off by default), and the first two seasons only build ratings. Two runs
   on the same data give the same hash.
3. **Decide on the test seasons.** Train is up to 2021-22, test is 2022-23
   onwards (`--train-until`). Accept a change only if
   - the test-season log loss against the sharp close improves (Δ LL in the
     report falls) by more than twice its standard error, and
   - the test-season yield of the policies does not fall.
   Choosing settings on the training seasons and reading them off the test
   seasons is the whole point; a change that only helps on train is noise
   or overfitting.
4. **Record it.** Add a row to the changelog below with the report file.
   Reports live in `data/reports/backtest-<league>-<stamp>.{json,md}`; the
   Markdown is the thing to read.
5. **Track it live.** The Dashboard's sharp view, CLV vs the sharp close
   and the profit z-score are the live versions of the same numbers.
   `npm run odds:close` fills the sharp closing prices on settled bets so
   CLV accumulates without typing. Segment stop rules are in
   docs/METRICS_AND_DASHBOARD.md ("Decision rules").

## Reading the report

- **Skill table.** Log loss and Brier per game; Brier is the three-outcome
  sum (0..2), so the EPL market sits near 0.57, not 0.19. Δ LL is model −
  sharp close with its standard error; over 1,500 test games the resolution
  is about ±0.008, so a Δ of 0.02 is real and a Δ of 0.005 is not.
- **Calibration.** The market's buckets should lie on the diagonal; the
  model's show where its probabilities are off.
- **Policies.** One bet per game at the best edge. `exp. yield` is what
  the policy's own probability promised; `sharp exp.` is what the de-vigged
  sharp price implied for the same bets. A policy whose actual yield sits
  near `sharp exp.` and far below `exp. yield` is harvesting price
  differences, not model skill. `CLV` is the odds taken over the sharp
  close.
- **Sample sizes.** Yield has a standard error of roughly 1.4/√n in units
  of the stake: ±5 % at 800 bets. Log loss on thousands of games is the
  primary acceptance test; yield is the secondary one.

## What the first run says (18 October 2026, EPL 2012-13 → 2026-27)

Report: `data/reports/backtest-epl-20261018-1728.md` (with `--grid`).

| Scope | n | Model LL | Sharp LL | Δ LL (±se) | Baseline LL |
| --- | ---: | ---: | ---: | ---: | ---: |
| All scored seasons | 4620 | 0.980 | 0.959 | +0.021 (±0.003) | 1.068 |
| Train (to 2021-22) | 3040 | 0.975 | 0.956 | +0.019 (±0.004) | 1.067 |
| Test (2022-23 on) | 1580 | 0.990 | 0.964 | +0.026 (±0.004) | 1.069 |

- The model is clearly better than the league baseline and clearly worse
  than the Pinnacle close, by about 0.02 log loss in every season and every
  grid cell (home advantage 30–60, K 15–30, age weighting on or off, draw
  factor ±10 %). Shrinking halfway to the sharp price (0.5 model + 0.5
  sharp) recovers most of the gap (0.965 overall).
- Betting at the sharp price on model edge alone loses the margin, as it
  must: −2.6 % over 4,527 bets.
- Betting at the best market price (football-data `MaxC*`) looked good on
  the training seasons and lost on the test seasons for every policy:
  for example "max, shrunk, 2 % edge" made +18.6 % on 1,118 train bets and
  −10.2 % on 1,431 test bets. Even the pure price-difference policy (sharp
  probability, best price, 2 % edge) went from +10.4 % to −9.5 %. The best
  price across a dozen books is an optimistic proxy for a fill: it is often
  a stale or outlier quote, and selecting on it brings a winner's curse.
  Treat max-close yields as an upper bound; the average close (`AvgC*`) is
  the honest one.
- Segments with a positive test-season signal are small and should be read
  as hypotheses, not findings: draws (175 bets, +16.7 %) and the >10 odds
  band (229 bets, +11.3 %) under "max, shrunk, 2 %".

Conclusion: the model is not sharper than the market on its own, and a
soft-book strategy has to be judged on CLV against the sharp close with
real prices, not on model edge. Live bets should be sized on the shrunk or
sharp probability (the forms already do this when a sharp price is
present), and the backlog below is ordered by how much of the 0.02 gap each
item might close.

## Backlog, ranked

1. **Regression to the mean between seasons** (`computeElosFromGames`): pull
   every rating a third of the way back to 1500 at a season boundary, and
   start promoted clubs below the mean. Early-season games are where the
   gap to the market is widest.
2. **Per-league base K and margin multiplier.** The grid prefers K 25–30
   with home advantage 60 for the EPL on train (Δ LL 0.017 vs 0.018 at the
   live settings); check on test before changing `LEAGUES[].homeAdv`.
3. **Signed margin of victory**: the current multiplier damps upsets and
   expected wins alike.
4. **Draw model**: the model under-predicts draws at parity; try fitting the
   Davidson factor per season phase or adding a rating-gap term.
5. **Market-informed probabilities as the live default**: expose
   `shrinkWeight` from the backtest in the bet forms (today the Kelly hint
   uses the sharp probability outright when one is typed or prefilled).
6. **NHL and Liiga history.** Store the game history with
   `npm run games:fetch` (NHL via `fetchMultipleSeasons`, Liiga once
   `fetchSeason` is exported; filter NHL preseason and playoffs by
   `gameType`) and fill `src/odds/theOddsApi.ts` with The Odds API
   historical snapshots (about one $30 month for several seasons). OddsPapi
   Liiga coverage is unverified; check `/v4/tournaments` with a key.
7. **Shin de-vig** instead of proportional, for the longshot bands.
8. **Early-season guard**: `Policy.minGamesPlayed` exists in the backtest;
   wire `model.gamesPlayed` into live bet rows so the `phase` segment works
   on the Dashboard too.
9. **Two-way soccer sharp lists and correct-score prices** are dropped on
   save (see docs/METRICS_AND_DASHBOARD.md step 8); needs a `sides` notion
   on the ledger row.

## Cadence

- After each round of games the current season's odds file is a day stale
  at most; `npm run odds:fetch -- epl` and `npm run games:fetch -- epl`
  refresh it. Completed seasons are never refetched.
- Re-run the backtest after any model change and at the end of each
  season, and move `--train-until` forward one season a year so the test
  window stays at three or more seasons.
- Re-fit `homeAdv` and the draw factor on train seasons only
  (`npm run fit:homeadv` uses the live three seasons; prefer the grid).

## Changelog

| Date | Change | Train Δ LL | Test Δ LL | Test yield (bets, policy) | Report |
| --- | --- | ---: | ---: | --- | --- |
| 2026-10-18 | Baseline: live settings (homeAdv 45, K 20, age weighting off in the walk) | +0.019 | +0.026 | −10.2 % (1431, max-shrunk-2) | `backtest-epl-20261018-1728` |
