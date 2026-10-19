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

## Second turn: season regression (18 October 2026)

Report: `data/reports/backtest-epl-20261018-1809.md`. Options added:
`--regress <share>` pulls every rating that share of the way back to 1500
at a season boundary; `--new-team <elo>` is the start for promoted or
returning clubs. Both are in the grid.

Test-season log loss against the sharp close, by games played:

| Phase | n | Baseline Δ LL | Regress 0.2 | Regress 0.33, new 1400 | New 1400 only |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0–5 played | 301 | +0.016 | +0.030 | +0.044 | +0.010 |
| 6–15 played | 403 | +0.030 | +0.026 | +0.025 | +0.025 |
| 16–30 played | 605 | +0.021 | +0.022 | +0.024 | +0.018 |
| 31+ played | 271 | +0.040 | +0.042 | +0.044 | +0.040 |

- **Regression rejected.** It makes the first games of a season worse, not
  better: the spring rating is a better August prior than a shrunk one.
  Train log loss rises at every strength and test does not move.
- **Lower start for promoted clubs: not accepted.** Test Δ improves from
  +0.026 to +0.022, under one standard error, and train worsens by the
  same amount. 1450, 1400 and 1350 are indistinguishable. Kept as an
  option, off.
- **The hypothesis was wrong about where the gap is.** The model is closest
  to the market in the first five games and furthest after thirty, so the
  problem is in-season, not between seasons. Candidates: ratings move too
  slowly (higher K, or K that does not shrink with the margin multiplier),
  and late-season effects the market prices and Elo cannot (nothing left
  to play for, rotated squads).

## Third turn: in-season responsiveness and the goal layer (18 October 2026)

Run with `npm run backtest:compare` (one line per variant; the options are
all off by default and listed in the script header). Test-season log loss
against the sharp close, baseline 0.990 (Δ +0.026 ± 0.004):

| Variant | Test LL | Δ vs market | Verdict |
| --- | ---: | ---: | --- |
| Signed margin multiplier (FiveThirtyEight form) | 0.989 | +0.025 | no change |
| No margin multiplier | 0.989 | +0.024 | no change, train worse |
| K 30 | 0.987 | +0.022 | under 1 se |
| Early-season K ×2 for the first 8 games | 0.988 | +0.024 | under 1 se |
| Probability scale 350 / 320 / 300 / 280 | 0.990 / 0.992 / 0.994 / 0.997 | worse | rejected |
| Update scored against the goal margin (0.5 + 0.15 × goals) | 1.008 | +0.043 | rejected |
| 1X2 from the recent-form Poisson layer | 1.044 | +0.080 | rejected |
| 1X2 from the rating-gap Poisson layer | 0.994 | +0.029 | rejected |
| Blends of Elo with either Poisson layer | 0.991–0.996 | worse | rejected |

Nothing passes the rule. The results-only Elo has plateaued about 0.02
behind the sharp close on this league, and the first-five-games gap is
already the smallest, so faster or slower ratings do not help.

**The decisive check.** Blending the model with the de-vigged market price
at weight w on the model, test seasons: w = 0 gives 0.9643, w = 0.1 gives
0.9655, w = 0.5 gives 0.9732, w = 1 gives 0.9899. The best weight is zero
on train, on test, on the Pinnacle-only rows and against the market
average. The model carries no information the EPL market lacks. That
settles the question for this league: no Elo change of this kind makes the
model profitable, and the live default should size on the sharp price
alone when one is present.

Side finding: the recent-form Poisson layer, which prices the app's
correct-score bets, is 0.08 log loss behind the market on 1X2. Correct-
score bets should not be placed on it without a market comparison.

## Fourth turn: the hockey leagues (18 October 2026)

Prices from The Odds API (docs/DATA_SOURCES.md, "Hockey odds history"):
one snapshot per game day, Pinnacle for the moneyline, the de-vigged
median of the European three-way books for the 60-minute 1X2.
`npm run backtest:compare -- liiga --train-until 2024` and
`npm run backtest:market -- liiga --train-until 2024`.

**Liiga** (report `data/reports/backtest-liiga-20261018-1856.md`): prices
exist from March 2025, so the test set is 2025-26 plus the start of
2026-27, 596 games, and the train side is only 48 games.

| Scope | n | Model LL | Market LL | Δ (±se) |
| --- | ---: | ---: | ---: | ---: |
| 60-minute 1X2, test, vs consensus | 596 | 1.039 | 1.012 | +0.026 (±0.008) |
| Moneyline, all, vs Pinnacle | 644 | 0.672 | 0.647 | +0.025 (±0.009) |

- Best blend weight on the model: 0, in every variant tried (K 15/30,
  no margin multiplier, probability scale 500, early-season K).
- The gap is in the first fifteen games of a season (+0.054 and +0.046 by
  phase) and nearly closed from game sixteen on (+0.005, +0.012): Liiga
  rosters turn over heavily in the summer, and a results-only rating
  cannot see it.
- Betting the model's edge at the fair consensus price loses 2.1 % over
  596 games; at the best market price every policy is negative.

Verdict: same as the EPL. The market, even a consensus of soft books,
already contains everything the rating knows.

**NHL** (report `data/reports/backtest-nhl-20261019-0818.md`, with
`--grid`): prices from 2020-21 to date, 8,061 games. Train 2020-21 to
2022-23 (3,736), test 2023-24 to 2026-27 (4,325), burn-in 2019-20.

| Scope | n | Model LL | Market LL | Δ (±se) |
| --- | ---: | ---: | ---: | ---: |
| 60-minute 1X2, train, vs consensus | 3736 | 1.038 | 1.031 | +0.007 (±0.003) |
| 60-minute 1X2, test, vs consensus | 4325 | 1.053 | 1.040 | +0.013 (±0.002) |
| Moneyline, test, vs Pinnacle | 4325 | — | — | +0.020 (±0.003) |

- This is the league where the rating is closest to the market: 0.013
  behind the consensus against 0.02–0.03 in soccer and Liiga, and level
  with it in the first five games of a season.
- **Grid, chosen on train:** K 10 (home advantage 35, scale 400). Test
  window, K 20 → K 10: 60-minute Δ +0.013 → +0.009 (se 0.002), moneyline
  vs Pinnacle Δ +0.020 → +0.014 (se 0.003). Both improve by two standard
  errors, the training seasons improve (+0.007 → +0.004), and every K from
  10 to 30 is ordered the same way on train and test: at K 20 the NHL
  rating moves too fast.
- Second holdout, 2025-26 and 2026-27 alone (1,527 games) with training
  through 2024-25: K 10 and K 20 tie at +0.009. The gain is in 2023-25 and
  absent in 2025-26, so it is real but small, and it is calibration: the
  best blend weight on the model is still 0.
- K 10 with probability scale 500 reaches +0.006 on test and +0.008 on the
  moneyline but only ties K 10 on train; it is the first candidate for
  next season's turn, not applied now.
- Betting the model's edge at the fair consensus price: +7.9 % and +6.0 %
  in 2021-22 and 2022-23, −3 to −4 % in the other seasons, noise around
  zero, as the blend weight says.

**Accepted: NHL base K 20 → 10** (`LEAGUES.nhl.baseK`), the first change
to pass the rule. It changes the live NHL ratings; the Dashboard's model
panel will show the new numbers on the next refresh.

## Backlog, ranked

1. **NHL probability scale.** K 10 with scale 500 is the next candidate
   (see the fourth turn); decide on it with 2026-27 as a fresh test season.
   Then `npm run fit:homeadv` style re-fit of the NHL home advantage with
   K 10, on train seasons only.
2. **Soft-book edge, not model edge.** Hockey history is now stored for
   both leagues (The Odds API, docs/DATA_SOURCES.md), and the verdict is
   the same as the EPL: the blend weight on the model is zero everywhere. For the EPL the question is whether
   Veikkaus prices worse than Pinnacle on some games: live CLV against the
   sharp close, read at 50 bets.
3. **Richer inputs** if the model is to beat the market anywhere: expected
   goals, lineups and rest days are what the market prices and results-only
   Elo cannot see. Out of scope for the current data sources.
4. **Late-season context.** After thirty games the model is 0.04 behind; a
   "nothing to play for" flag from the standings would be the first
   feature, but see the blend result above before investing in it.
5. **Draw model**: the model under-predicts draws at parity; try fitting the
   Davidson factor per season phase or adding a rating-gap term.
6. **Market-informed probabilities as the live default**: expose
   `shrinkWeight` from the backtest in the bet forms (today the Kelly hint
   uses the sharp probability outright when one is typed or prefilled).
7. **NHL and Liiga history (details).** Store the game history with
   `npm run games:fetch` (NHL via `fetchMultipleSeasons`, Liiga once
   `fetchSeason` is exported; filter NHL preseason and playoffs by
   `gameType`) and fill `src/odds/theOddsApi.ts` with The Odds API
   historical snapshots (about one $30 month for several seasons). OddsPapi
   Liiga coverage is unverified; check `/v4/tournaments` with a key.
8. **Shin de-vig** instead of proportional, for the longshot bands.
9. **Early-season guard**: `Policy.minGamesPlayed` exists in the backtest;
   wire `model.gamesPlayed` into live bet rows so the `phase` segment works
   on the Dashboard too.
10. **Two-way soccer sharp lists and correct-score prices** are dropped on
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
| 2026-10-18 | Season regression 0.2 / 0.33 / 0.5 toward 1500: **rejected** (train worse, test unchanged, early games worse) | +0.022 (0.2) | +0.026 | — | `backtest-epl-20261018-1809` |
| 2026-10-18 | Promoted clubs start at 1400: **not accepted** (test −0.004, under 1 se; train +0.002) | +0.021 | +0.022 | — | `backtest-epl-20261018-1809` |
| 2026-10-18 | Signed / no margin multiplier, K 30, early-season K, probability scale, goal-margin updates, Poisson 1X2 and blends: **all rejected** (best test Δ +0.022, under 1 se) | +0.018–+0.056 | +0.022–+0.080 | −6.6 % to −15.6 % at avg close | `npm run backtest:compare` table above |
| 2026-10-18 | Model–market blend: best weight on the model is 0 on train, test and the market average | — | — | — | section "Third turn" |
| 2026-10-18 | Liiga: baseline vs consensus 60-minute price and Pinnacle moneyline; blend weight 0; every Elo variant rejected | — | +0.026 | −2.1 % (596, sharp-model-0) | `backtest-liiga-20261018-1856` |
| 2026-10-19 | NHL: grid chooses K 10 on train; **accepted** (test 2023-27 Δ 0.013 → 0.009 and moneyline 0.020 → 0.014, both 2 se; flat on 2025-26 alone) | +0.007 → +0.004 | +0.013 → +0.009 | −7.8 % → −9.4 % (avg close, model edge) | `backtest-nhl-20261019-0818` |
