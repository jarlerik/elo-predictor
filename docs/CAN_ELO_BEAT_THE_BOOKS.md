# Can an Elo predictor beat the bookmakers?

Assessment written on 19 October 2026 after four turns of the improvement
loop (docs/CONTINUOUS_IMPROVEMENT.md) and the first weeks of live bets. It
answers two questions: whether an Elo model could beat the books, and
whether comparing Veikkaus against the market consensus is enough on its
own.

## Short answer

An Elo predictor on its own will not beat the bookmakers, and our data says
so directly. A profitable operation is possible, but the model is a small
part of it, and most of what it takes is not model work. The only strategy
with a published track record needs no model at all: bet where one book's
price is above the consensus by more than the margin. Whether that works
for us is decided by live closing line value, not by any backtest.

## What the evidence says

The backtests measured the quantity that decides this. In all four leagues
the best blend of model and market price puts zero weight on the model. The
market's closing price already contains everything a results-based rating
knows, plus more.

| League | Model log loss behind the sharp close | Blend weight on model | Report |
| --- | ---: | ---: | --- |
| EPL (2012-13 to 2026-27, Pinnacle) | 0.021 ± 0.003 | 0 | data/reports/backtest-epl-20261018-1809.md |
| Liiga (2025-26 on, consensus) | 0.026 | 0 | data/reports/backtest-liiga-20261018-1856.md |
| NHL (2020-21 on, consensus, K 10) | 0.009 to 0.013 | 0 | data/reports/backtest-nhl-20261019-0818.md |
| NBA (2024-25 on, Pinnacle two-way) | 0.030 ± 0.007 | 0 | data/reports/backtest-nba-20261023-1404.md |

Closing the whole NHL gap would only bring the model level with the market,
not ahead of it, and a bet needs to be ahead by more than the margin.

The published record agrees:

- Wunderlich and Memmert found that bookmaker odds explain more variance in
  football results than Elo ratings do, and that an Elo built from the odds
  themselves is more stable than one built from results.
- Kaunitz and colleagues (2017) did not predict games at all. They took the
  average of all bookmakers' odds as the truth and bet wherever one book was
  an outlier. Profitable over 56,000 bets, until the books limited their
  accounts.
- Hubacek, Sourek and Zelezny (2019) built an NBA model from player
  statistics and trained it to be accurate *and* decorrelated from the
  bookmaker's probabilities. The aim was to disagree with the book in
  profitable places, not to be more accurate than it. Their 2021 review
  found the profits modest and fragile.

## What it would take

1. **Information the market lacks or prices late.** Results-only Elo has
   none. Expected goals and shot quality, lineups and goalie starts in
   hockey, injuries, rest and travel, and the summer roster turnover that
   opens the Liiga gap in the first fifteen games. The market prices most of
   these within hours, so the edge is in speed or in combining them better.
2. **A model built to disagree with the book, not to be accurate.** The loop
   optimises log loss, which is the right first test because it says whether
   the model knows anything. The next step, if there were information, is a
   decorrelation objective trained on what the market gets wrong.
3. **Smaller markets.** The NHL was the closest league and the EPL the
   furthest, which matches the rule that liquidity sets the ceiling. Lower
   divisions, women's leagues and early-season markets are where
   results-only models have the best record, and the limits come fast.
4. **Price shopping as the engine.** Bet when one book's price is above the
   consensus. Live it needs accounts at many books, bet-time prices from all
   of them, and acceptance that winning accounts get limited. In Finland
   with one dominant book that is a structural problem.
5. **Volume and patience.** Yield has a standard error of about 1.4 divided
   by the square root of the bet count. A 2 % edge needs several thousand
   bets to show above noise, which is years at a weekend cadence.

The model is a good instrument and a poor oracle. It is calibrated, better
than the base rate, and within reach of the market in the NHL. Its job is
to size and sanity-check bets; the backtest loop keeps it honest season by
season. Profit, if it comes, comes from the price: the Pinnacle number the
scan and `npm run bet` attach to each bet, the Veikkaus price next to it,
and the closing line value `npm run metrics` reports. If fifty bets show no
CLV, no Elo work will
create it, and the next real investment is a feature-based model with
expected goals and lineups aimed at one thin hockey market.

## Is "Veikkaus above the consensus" enough on its own?

It is the right rule, with three conditions. Our data is cautionary on two.

**The gap must be real at bet time, not at close.** What matters is the
Veikkaus price now against the sharp price now, and which way the sharp
price moves afterwards. That is closing line value, which the ledger
measures. After seven priced bets it reads −6 %: Veikkaus has so far been
sharper than the price taken. Seven bets is noise; fifty is a first reading.

**The overprice must exceed Veikkaus's margin.** The backtest simulated the
outlier rule with the market's best price across the European books, a
kinder version of a single soft book. On the EPL test seasons it lost:

| EPL test seasons, best price vs Pinnacle fair | bets | expected yield from the sharp price | realised yield |
| --- | ---: | ---: | ---: |
| pure market probability, 8 % edge filter | 213 | about +2 % | −20 % |
| market probability shrunk 50 %, 2 % edge | 1,431 | +1.9 % | −10 % |

The sharp price said those bets were overpriced by one or two percent, and
they lost. The outlier price in a feed is often a stale or erroneous line
that nobody could get down at, the same trap that got Kaunitz's accounts
limited. In the NHL the best European price never exceeded Pinnacle's fair
price on average, so there was no outlier edge to take at all.

**Veikkaus has to let you.** It is a monopoly with no competitor to shop
against, its margins on Liiga and 1X2 are among the highest in Europe, and
it limits accounts that show positive CLV. A one or two percent paper edge
disappears into a seven percent overround, and the genuine misprices are
where the stake is most likely to be cut.

**Verdict:** good enough as the rule, not yet as a business. Bet only when
the Veikkaus price beats the prefilled Pinnacle fair price by more than
Veikkaus's margin, log every bet, read the sharp CLV at fifty bets. Positive
means an edge exists and the questions become stake size and account
survival. Negative means the mispricing being hunted does not exist at the
prices available, and neither a model nor a consensus rule fixes that.

The daily procedure that implements this, with the first board and a
backtest of the rule on the stored per-book lines, is in
[MORNING_SCAN.md](MORNING_SCAN.md).

## Sources

- Hubacek, Sourek, Zelezny, Exploiting sports-betting market using machine
  learning, International Journal of Forecasting 35(2), 2019.
  https://ida.fel.cvut.cz/papers/hubacek2019exploiting.html
- Optimal sports betting strategies in practice: an experimental review,
  2021. https://arxiv.org/pdf/2107.08827
- Kaunitz, Zhong, Kreiner, Beating the bookies with their own numbers, 2017,
  via MIT Technology Review.
  https://www.technologyreview.com/2017/10/19/67760/the-secret-betting-strategy-that-beats-online-bookmakers/
- Wunderlich and Memmert, betting-odds-based Elo, summary.
  https://thexgfootballclub.substack.com/p/a-new-horizon-in-football-forecasting-the-betting-odds-based-elo-system-f5032018f546
- Whelan, Efficiencies and the favourite-longshot bias, lecture notes.
  https://www.karlwhelan.com/Teaching/BettingMarkets/10.EfficienciesandFavourite-LongshotBias.pdf
