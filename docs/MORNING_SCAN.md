# Morning scan: betting on the books' own numbers

The model-side verdict in [CAN_ELO_BEAT_THE_BOOKS.md](CAN_ELO_BEAT_THE_BOOKS.md)
is that a results-only Elo adds nothing to the market. The alternative
route is the one Kaunitz, Zhong and Kreiner tested in
[Beating the bookies with their own numbers](https://arxiv.org/abs/1710.02824)
(2017, written up in [MIT Technology Review](https://www.technologyreview.com/2017/10/19/67760/the-secret-betting-strategy-that-beats-online-bookmakers/)):
do not forecast, read the average of the bookmakers' prices as the
probability and bet wherever one bookmaker stands clearly above it. This
document is the daily procedure that applies that rule to the leagues the
app covers and to the books a Finnish bettor can use, and what the stored
history says about it.

## The rule

For each outcome of a game the consensus probability is the inverse of
the mean price across the bookmakers that quote it (the paper's Eq. 1):

    p_cons = 1 / mean(odds)

The paper regressed outcomes on `p_cons` over 479,440 football games and
found slopes of 1.00 to 1.08 and intercepts of −0.034 (home), −0.057
(draw) and −0.037 (away): the mean price overstates the probability by
about the books' margin. It therefore takes `p_real ≈ p_cons − α` and bets
one flat stake whenever a bookmaker's price clears the fair price at that
probability (Eq. 7):

    bet when   odds > 1 / (p_cons − α),   α = 0.05

α = 0.05 was chosen on the historical simulation as the best trade-off
between value per bet and the number of bets (0.06 was as profitable with
half the bets). Results in the paper: 3.5 % yield on 56,435 closing-odds
bets over ten years, 9.9 % on 6,994 bets priced one to five hours before
kickoff, 5.5 % on 407 paper-traded bets and 8.5 % on 265 real bets, after
which the books limited the accounts. Note that this is the validation
in the paper, not ours; our own numbers are below.

"Over the margin" in the user's phrasing is exactly this inequality: the
book's price must beat the consensus fair price by the α allowance, which
at typical 1X2 prices is a 10 to 15 % higher price than the mean. The scan
also prints the edge against the de-vigged sharp price (Pinnacle, or the
median of the other books where Pinnacle does not quote the market),
which is the figure the ledger's closing line value is measured on.

## The procedure

    npm run scan                      # NHL, Liiga, EPL, Champions League; games in the next 36 h
    npm run scan -- nhl liiga --hours 24
    npm run scan -- --alpha 0.04 --books veikkaus_fi
    npm run scan -- --max-age 120     # reuse a board fetched within two hours
    npm run scan -- --offline         # read the last cached board, no API call

1. **Which leagues have games.** The scan asks The Odds API for every
   unstarted event of each league (`icehockey_nhl`, `icehockey_liiga`,
   `soccer_epl`, `soccer_uefa_champs_league`) and keeps the ones starting
   inside the window. Kickoffs are printed in Helsinki time.
2. **Market consensus.** One call per league with `regions=eu,fi` and the
   head-to-head market returns every book's line: on an NHL game 12
   two-way books (Pinnacle, Betsson, NordicBet, William Hill, 888, the
   Betfair Exchange, Matchbook and the US-facing books) and 14 three-way
   books (Unibet, LeoVegas, Coolbet, Marathonbet, 1xBet, Tipico, Winamax,
   Betclic, Codere); on a Champions League game 25, on an EPL game 28.
   The consensus of each market is the mean price over the books that
   are not candidates, so a Finnish book never confirms itself.
3. **Veikkaus prices.** The Finnish region carries `veikkaus_fi`,
   `unibet_fi` and `leovegas_fi`. Veikkaus quotes the soccer 1X2 and, on
   hockey, only the two-way winner including overtime; Unibet and LeoVegas
   quote the 60-minute 1X2 on hockey as well. Those three are the default
   candidate books (`--books` changes the set).
4. **The margin check.** Every (book, outcome) whose price exceeds
   `1 / (p_cons − α)` is a candidate, sorted by the paper's expected value
   `odds × (p_cons − α) − 1`. The report shows, per candidate, the price,
   the mean price, `p_cons`, the price the book had to beat, that
   expected value, the sharp edge and the book's own overround. No
   candidate means no book cleared the bar; the per-league tables still
   show the consensus, Pinnacle and the Finnish lines for every game.
5. **Placing and logging.** Open the game's bet form in the app, which
   prefills Pinnacle's prices from OddsPapi, enter the Finnish book's
   price and stake, and save. The ledger then carries the sharp price at
   bet time and, after `npm run odds:close`, the sharp close, so the
   closing line value accumulates without any extra work. The decision
   point is the one already in the verdict document: read the sharp CLV
   at fifty logged bets.

Each run writes `data/scans/scan-<date>-<time>.md` and `.json` (the JSON
keeps every candidate with the book's full line and the sharp line, so
a candidate can be settled and scored later even if it was not bet). Raw
boards are cached under `data/odds/raw/the-odds-api/live/` (ignored) and
reused within `--max-age` minutes, so a rerun costs nothing.

**Cost.** Two credits per league per fresh board (one per region and
market), eight for the four leagues; the free events endpoint is used
for nothing else. The 20,000-credit plan had 5,445 credits left on
19 October 2026 and ends on 18 November 2026; a morning scan every day
until then uses about 250. OddsPapi's free tier does not carry Veikkaus,
so after that date the Finnish lines need either another month of The
Odds API or manual entry.

## What the stored history says

`npm run backtest:outliers -- <league>` applies the same rule to the
per-book closing lines already stored for the market backtest: The Odds
API's European books ten minutes before the first game of each day for
the hockey leagues (NHL from 2020, Liiga from March 2025), and
football-data's six named books (Bet365, bwin, Interwetten, Pinnacle,
William Hill, Bet Victor) for the EPL. Every book is a candidate, as in
the paper. Reports: `data/reports/outliers-nhl-20261019-1050.md`,
`outliers-liiga-20261019-1050.md`, `outliers-epl-20261019-1050.md`.

| League | α | Bets | Hit | Expected hit | Yield | ± se | At the sharp price |
|---|---|---|---|---|---|---|---|
| NHL moneyline | 0.02 | 1,020 | 51.8 % | 52.0 % | +2.0 % | 3.3 % | +1.1 % |
| NHL moneyline | 0.03 | 346 | 53.2 % | 51.9 % | +7.4 % | 5.9 % | +3.0 % |
| NHL moneyline | 0.05 | 97 | 55.7 % | 49.5 % | +23.0 % | 12.4 % | +11.3 % |
| NHL 60-minute 1X2 | 0.02 | 3,903 | 43.5 % | 44.2 % | +1.5 % | 2.0 % | −0.2 % |
| NHL 60-minute 1X2 | 0.05 | 17 | 17.6 % | 48.4 % | −60.4 % | 21.9 % | +24.7 % |
| Liiga 60-minute 1X2 | 0.02 | 1,278 | 36.9 % | 38.9 % | −3.7 % | 3.9 % | +0.4 % |
| Liiga 60-minute 1X2 | 0.05 | 25 | 56.0 % | 55.7 % | +1.2 % | 19.1 % | +1.9 % |
| EPL 1X2 | 0.02 | 272 | 49.6 % | 47.7 % | +5.7 % | 8.0 % | −0.4 % |
| EPL 1X2 | 0.05 | 0 | – | – | – | – | – |

Reading it:

- **The paper's accuracy forecast holds here too.** At α = 0.02 the hit
  rate matches `mean(p_cons − α)` within a point in every league. The
  consensus is as good a probability as the paper says.
- **At the paper's α there are almost no bets in our feeds.** The paper
  had 32 books; the hockey snapshots have 12 to 14 per market, the EPL
  file six. With fewer books the mean sits closer to each book and
  five-point outliers are rare: 114 NHL bets in eight seasons, 25 in
  Liiga, none in the EPL. The volume the paper reports needs the width
  of its feed.
- **The NHL moneyline is the one market with a positive drift**, +2 %
  at α = 0.02 on a thousand bets and +7 % at 0.03 on 346, both inside
  two standard errors, and the sharp price agrees the bets carry a
  small edge (+1 to +3 %). The outliers come mostly from Betsson,
  Pinnacle itself, the US-facing books and Marathonbet.
- **The 60-minute hockey line and the EPL show no edge** once the sharp
  price is consulted (−0.2 %, +0.4 %, −0.4 %): the outliers there are
  the books' own margin structure, not mispricing.
- **None of this is at a Finnish book.** The history has only the
  European region; Veikkaus, Unibet FI and LeoVegas FI appear only in
  the live boards from 19 October 2026 on. The scan's JSON files are the
  start of that record.

## What to expect from Veikkaus

On the first board (19 October 2026, 20 games across the four leagues)
no Finnish book cleared α = 0.05 on any outcome. Veikkaus' 1X2 overround
is about 5 % and its prices sit at or a little below the consensus;
Unibet FI and LeoVegas FI are a little above it on some longshots. At
α = 0.02 the scan would have listed a handful of Unibet and LeoVegas
lines, which the history says are worth about zero at the sharp price.

So the honest expectation is: a Veikkaus candidate at the paper's margin
will be rare, perhaps a few a month across the four leagues, and the
decision whether the rule works for a Finnish account is the sharp CLV of
the bets actually placed, read at fifty. The scan makes that cheap to
collect: one command each morning, eight credits, every candidate logged
with the sharp price next to it.

## Settings worth revisiting

- **α per market.** 0.05 is a soccer 1X2 figure. The two-way hockey line
  has a smaller overround, so the same α is a stricter bar there; the
  backtest's α sweep is the tool to pick a market-specific value, but the
  samples at α ≥ 0.04 are too small to choose on yet.
- **Candidate set.** Adding books the bettor can actually hold an
  account with (the `--books` list) is the only lever that changes the
  number of candidates; the consensus is always the other books.
- **Timing.** The paper's 9.9 % came from prices one to five hours before
  kickoff and its real bets from a live dashboard. A scan in the morning
  sees prices that can move by evening; a second run before the first
  kickoff (`--max-age 0`) costs another eight credits.
