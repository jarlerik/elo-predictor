# ELO Predictor

A command-line betting ledger and bookmaker scanner for the NHL, the Finnish SM-liiga, the English Premier League, the NBA and the UEFA Champions League, with an Elo model and the backtests that showed it does not beat the market.

What it does:

- **Morning scan** (`npm run scan`): today's games, the bookmakers' consensus from The Odds API, the Finnish books' prices (Veikkaus, Unibet FI, LeoVegas FI), and every price that clears the outlier rule of Kaunitz et al. (2017): bet where a book stands above `1 / (p_cons − 0.05)`.
- **Ledger** (`npm run bet`, `npm run settle`, `npm run metrics`, `npm run bankroll`): every bet with the book's line, the sharp line and the model's view at bet time; settlement from the leagues' results; yield, closing line value and segment tables.
- **Elo model and backtests** (`npm run backtest:market`, `npm run backtest:outliers`, `npm run fit:homeadv`): Davidson-draw Elo per league, a strict walk-forward backtest against stored bookmaker prices, and the outlier rule on the stored per-book lines.

The model-side verdict is in [docs/CAN_ELO_BEAT_THE_BOOKS.md](docs/CAN_ELO_BEAT_THE_BOOKS.md), the daily procedure in [docs/MORNING_SCAN.md](docs/MORNING_SCAN.md), the improvement loop in [docs/CONTINUOUS_IMPROVEMENT.md](docs/CONTINUOUS_IMPROVEMENT.md), the metrics in [docs/METRICS_AND_DASHBOARD.md](docs/METRICS_AND_DASHBOARD.md) and every feed in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md). The web app that used to front this was removed on 22 October 2026; the ledger format and the model are unchanged.

## Data Sources

| Data | Source | Seasons |
| --- | --- | --- |
| NHL games | `api.nhle.com` official stats API | 2 previous + current (ratings); 2019-20 onwards stored for the backtests |
| SM-liiga games | `liiga.fi/api/v2/games` (regular season) | 2 previous + current; 2019-20 onwards stored |
| Premier League games | `fixturedownload.com/feed/json/epl-<year>` | 2 previous + current; 2012-13 onwards stored |
| NBA games | `fixturedownload.com/feed/json/nba-<year>` (regular season) | 2 previous + current; 2018-19 onwards stored |
| Champions League | `data/ucl/ratings.json` seeded from clubelo.com, updated from `fixturedownload.com/feed/json/champions-league-<year>` | current |
| World Cup | `data/soccer/ratings.json` seeded from eloratings.net | — |
| EPL odds history | football-data.co.uk per-season CSVs (Pinnacle, Betfair Exchange, named books, market average and best) | 2012-13 onwards |
| NHL / Liiga / NBA odds history | The Odds API daily snapshots | NHL 2020-21 onwards, Liiga March 2025 onwards; NBA not stored yet |
| Live prices | The Odds API (`eu` and `fi` regions) for the scan; OddsPapi (Pinnacle) for sharp prices on bets and the sharp close | — |

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

1. **Clone and install**

   ```bash
   git clone <repository-url>
   cd elo-predictor
   npm install
   ```

2. **Add the odds API keys** to a `.env` file in the project root (gitignored, never commit it):
   ```
   THE_ODDS_API_KEY=...   # the morning scan and the hockey odds history (the-odds-api.com; the free tier covers the daily scan)
   ODDSPAPI_API_KEY=...   # Pinnacle prices on bets logged outside the scan, and the sharp closing prices (oddspapi.io, free tier)
   ```
   The ledger and the backtests run without them; the scan and the sharp-price lookups do not.

3. **Check it runs**
   ```bash
   npm run metrics
   ```

### Daily betting routine

The model does not beat the market ([docs/CAN_ELO_BEAT_THE_BOOKS.md](docs/CAN_ELO_BEAT_THE_BOOKS.md)), so the betting routine is the outlier rule: bet where a Finnish book's price stands clearly above the bookmakers' consensus. Full procedure and the evidence in [docs/MORNING_SCAN.md](docs/MORNING_SCAN.md).

1. **Morning: run the scan** (ten The Odds API credits for the five leagues; reruns within 30 minutes are free).
   ```bash
   npm run scan
   ```
   The numbered "Candidates" table lists every outcome where Veikkaus, Unibet FI or LeoVegas FI prices above `1 / (p_cons − 0.05)`. Read `Must beat`, `EV (α)` and `Sharp edge`; a candidate with a positive sharp edge is the strongest kind. An empty table means no bet today, which is the usual outcome. The per-league tables show the consensus, Pinnacle and the Finnish lines for every game.
2. **Place and log a candidate.** Check the price is still live on the book's site, place it, then log it by its number:
   ```bash
   npm run bet -- --candidate 1 --stake 10
   ```
   The ledger row carries the book's full line and the sharp line from the scan, the model's probability and ratings, and the kickoff. A bet that is not a scan candidate is logged positionally, e.g. `npm run bet -- liiga LUK TPS LUK 1.82 10 --market moneyline --book Veikkaus --line 1.82,1.98`; add `--dry-run` to see the row first.
3. **Before the first kickoff** (optional): `npm run scan -- --max-age 0` fetches a fresh board to catch moved prices.
4. **After the games:** settle from the leagues' results, then fill the sharp closing prices so the closing line value accumulates:
   ```bash
   npm run settle
   npm run odds:close
   ```
   `npm run settle -- --dry-run` shows what would settle; `--id <bet id> --result win|loss|void` settles one bet by hand.
5. **Weekly:** refresh the stored games and prices for the backtests:
   ```bash
   npm run games:fetch -- nhl 2026 --refresh && npm run games:fetch -- liiga 2026 --refresh && npm run games:fetch -- nba 2026 --refresh
   npm run odds:fetch -- nhl 2026 && npm run odds:fetch -- liiga 2026
   ```
   The NBA's price history is not stored yet; `npm run odds:fetch -- nba 2025` would store a season for about 1,700 credits.
6. **Verdict:** `npm run metrics` prints the sharp CLV; read it at fifty scan-driven bets. Positive means the Finnish books give away value at the prices taken; around zero means the rule does not work for these accounts.

Useful scan flags: `npm run scan -- nhl liiga nba` (leagues), `--hours 24` (window), `--alpha 0.03` (looser bar), `--books veikkaus_fi` (candidate books), `--offline` (last cached board, no credits).

### Commands

| Command | What it does |
| --- | --- |
| `npm run scan` | Morning scan; writes `data/scans/scan-<date>-<time>.md` and `.json` |
| `npm run bet -- --candidate <#> --stake <x>` / `npm run bet -- <league> <HOME> <AWAY> <pick> <odds> <stake> [--market] [--book] [--line] [--sharp]` | Log a bet in `data/ledger.jsonl` |
| `npm run settle [-- --dry-run]` / `npm run settle -- --id <id> --result win\|loss\|void [--return x]` | Settle open bets from the leagues' results, or one by hand |
| `npm run metrics [-- --by <slice>] [-- --json]` | Betting performance: headline figures, open bets, segment tables |
| `npm run bankroll [-- --set <amount> --started YYYY-MM-DD \| --deposit <x> \| --withdraw <x>]` | Bankroll and movements in `data/bankroll.json` |
| `npm run odds:close [-- --dry-run]` / `npm run odds:budget` | Fill sharp closing prices on played bets from OddsPapi; show the month's request budget |
| `npm run games:fetch -- <league> <from> [<to>] [--refresh] [--verify]` | Store played games per season under `data/games/` |
| `npm run odds:fetch -- <league> <from> [<to>]` | Store bookmaker prices per season under `data/odds/` |
| `npm run backtest:market -- <league> [--grid]` | Walk-forward backtest of the model against the stored prices; writes `data/reports/` |
| `npm run backtest:outliers -- <league> [--alpha ...]` | The outlier rule on the stored per-book lines with an α sweep; writes `data/reports/` |
| `npm run backtest:compare` | Side-by-side table of Elo variants |
| `npm run fit:homeadv -- <league>` | Grid-fit the Elo home advantage |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `scripts/` |

## Project Structure

```
elo-predictor/
├── scripts/            # the commands above, one file each
├── src/
│   ├── data/           # league feeds, game store, ledger, metrics, bankroll, backtests
│   ├── elo/            # Elo updates and Davidson 1X2 probabilities
│   ├── odds/           # bookmaker prices: football-data, The Odds API, OddsPapi, the outlier rule, the scan
│   ├── score/          # Poisson correct-score layer (kept as a library)
│   └── utils/          # league and team tables, de-vig, Kelly, CLI table helpers
├── data/
│   ├── ledger.jsonl    # every bet (source of truth)
│   ├── scans/          # morning scan reports
│   ├── games/, odds/   # stored history for the backtests (committed)
│   ├── reports/        # backtest reports (Markdown committed, JSON ignored)
│   └── ucl/, soccer/   # seed ratings
└── docs/
```

## How It Works

1. **Ratings.** Each league's played games are pulled from its feed and run through an Elo update with a margin multiplier and a per-league K; the draw factor of the Davidson model is fitted from the league's own draw (or OT/SO) rate. Basketball cannot end level, so the NBA is a two-way model whose K scales with the points margin.
2. **Backtests.** The ratings are replayed strictly walk-forward against stored bookmaker prices; the model's log loss is compared with the de-vigged sharp close and the blend weight that minimises log loss is reported. It is zero in every league, which is why the model is kept for context, not for picks.
3. **Scan.** The outlier rule reads the consensus of the European books as the probability and flags any Finnish book priced above it by more than the paper's allowance. Soccer is scanned on the 1X2, hockey on the 60-minute 1X2 and the winner including overtime, basketball on the winner including overtime only.
4. **Ledger.** Every bet is logged with the book's line, the sharp line and the model's view; settlement reads the results; the sharp closing line value is the figure that decides whether the rule works.

## License

ISC License - see LICENSE file for details
