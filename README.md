# ELO Predictor

A full-stack web application that predicts game outcomes using ELO ratings. Covers the NHL, the Finnish SM-liiga, the English Premier League, the UEFA Champions League and international soccer (World Cup). Built with Node.js/Express backend and React/TypeScript frontend.

## Features

- 🏒 **NHL & SM-liiga Predictions**: 1X2 on the 60-minute score (a game that goes to OT/SO is the draw), winner incl. OT/SO, and correct-score odds from ELO computed over the last three seasons. The hockey draw factor is fitted from each league's OT/SO rate
- ⚽ **Premier League Predictions**: 1X2 (home / draw / away) and correct-score odds, with draws modelled via the Davidson tie model
- ⭐ **Champions League**: 1X2 and correct-score odds for the 36 participants, seeded from clubelo.com (cross-league calibrated) and updated with every played Champions League game
- 🏆 **World Cup**: 1X2 odds for national teams from seeded eloratings.net ratings
- 📊 **Team Rankings**: Current ELO ratings per league
- 📱 **Responsive Design**: Modern, mobile-friendly interface
- ⚡ **Live Data**: Results are pulled from public feeds and refreshed every 6 hours

## Data Sources

| League         | Source                                                  | Seasons used          |
| -------------- | ------------------------------------------------------- | --------------------- |
| NHL            | `api.nhle.com` official stats API                       | 2 previous + current  |
| SM-liiga       | `liiga.fi/api/v2/games` (regular season, `runkosarja`)  | 2 previous + current  |
| Premier League | `fixturedownload.com/feed/json/epl-<year>`              | 2 previous + current  |
| Champions League | `data/ucl/ratings.json` seeded from clubelo.com, updated from `fixturedownload.com/feed/json/champions-league-<year>` | current |
| World Cup      | `data/soccer/ratings.json` seeded from eloratings.net   | —                     |

Live sources are re-fetched every 6 hours. The Champions League and World Cup seeds are refreshed by hand; see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for endpoints, season id conventions, what needs manual upkeep and the step-by-step refresh procedures.

## Tech Stack

### Backend

- **Node.js** with **Express**
- **TypeScript** for type safety
- **NHL API** for game data
- **Node-cache** for performance optimization

### Frontend

- **React 18** with **TypeScript**
- **Vite** for fast development and building
- **Modern CSS** with glassmorphism design
- **Responsive** mobile-first design

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd elo-predictor
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Add the odds API keys** to a `.env` file in the project root (gitignored, never commit it):
   ```
   THE_ODDS_API_KEY=...   # the morning scan and the hockey odds history (the-odds-api.com; the free tier covers the daily scan)
   ODDSPAPI_API_KEY=...   # Pinnacle prices prefilled on the bet forms and the sharp closing prices (oddspapi.io, free tier)
   ```
   The app runs without them; the scan and the sharp-price features do not.

4. **Start development servers**
   ```bash
   npm run dev
   ```
   This will start both the backend server (port 3000) and frontend dev server (port 3001) concurrently.

### Available Scripts

- `npm run dev` - Start both backend and frontend in development mode
- `npm run dev:server` - Start only the backend server
- `npm run dev:client` - Start only the frontend dev server
- `npm run build` - Build both backend and frontend for production
- `npm run build:server` - Build only the backend
- `npm run build:client` - Build only the frontend
- `npm start` - Start the production server
- `npm run odds:fetch -- epl 2012 2026` - Store football-data.co.uk odds per season under `data/odds/`
- `npm run games:fetch -- epl 2012 2026 --verify` - Store played games per season under `data/games/` and cross-check scores with the odds files
- `npm run backtest:market -- epl [--grid]` - Walk-forward backtest of the model against the stored odds; writes `data/reports/`
- `npm run odds:close` / `npm run odds:budget` - Fill sharp closing prices on settled bets from OddsPapi, and show the month's request budget
- `npm run fit:homeadv` - Grid-fit the Elo home advantage per league
- `npm run scan` - Morning scan: today's games, the bookmakers' consensus and the Finnish books' prices from The Odds API, with every price that clears the outlier rule; writes `data/scans/`
- `npm run backtest:outliers -- nhl` - The same outlier rule on the stored per-book closing lines, with an α sweep; writes `data/reports/`

See [docs/CONTINUOUS_IMPROVEMENT.md](docs/CONTINUOUS_IMPROVEMENT.md) for the improvement loop these scripts support. [docs/CAN_ELO_BEAT_THE_BOOKS.md](docs/CAN_ELO_BEAT_THE_BOOKS.md) is the assessment of whether the model can beat the bookmakers and what profitable betting would take. [docs/MORNING_SCAN.md](docs/MORNING_SCAN.md) is the daily procedure for the alternative: betting where a Finnish book stands above the market consensus.

### Daily betting routine

The model does not beat the market ([docs/CAN_ELO_BEAT_THE_BOOKS.md](docs/CAN_ELO_BEAT_THE_BOOKS.md)), so the betting routine is the outlier rule of Kaunitz et al. (2017): bet where a Finnish book's price stands clearly above the bookmakers' consensus. Full procedure and the evidence in [docs/MORNING_SCAN.md](docs/MORNING_SCAN.md).

1. **Morning: run the scan** (eight The Odds API credits for the four leagues; reruns within 30 minutes are free).
   ```bash
   npm run scan
   ```
   The "Candidates" table lists every outcome where Veikkaus, Unibet FI or LeoVegas FI prices above `1 / (p_cons − 0.05)`. Read the columns `Must beat`, `EV (α)` and `Sharp edge`; a candidate with a positive sharp edge is the strongest kind. An empty table means no bet today, which is the usual outcome. The per-league tables below it show the consensus, Pinnacle and the Finnish lines for every game.
2. **Place and log a candidate.** Check the price is still live on the book's site, then save the bet through the app's bet form for that game: it prefills Pinnacle's price from OddsPapi, so the ledger carries the sharp reference. Enter the Finnish book's price and the stake.
3. **Before the first kickoff** (optional): `npm run scan -- --max-age 0` fetches a fresh board to catch moved prices.
4. **After the games:** settle the bets on the dashboard and fill the sharp closing prices with `npm run odds:close`, so the closing line value accumulates.
5. **Weekly:** refresh the stored games and prices for the backtests:
   ```bash
   npm run games:fetch -- nhl 2026 --refresh && npm run games:fetch -- liiga 2026 --refresh
   npm run odds:fetch -- nhl 2026 && npm run odds:fetch -- liiga 2026
   ```
6. **Verdict:** read the dashboard's sharp CLV at fifty scan-driven bets. Positive means the Finnish books give away value at the prices taken; around zero means the rule does not work for these accounts.

Useful flags: `npm run scan -- nhl liiga` (leagues), `--hours 24` (window), `--alpha 0.03` (looser bar), `--books veikkaus_fi` (candidate books), `--offline` (last cached board, no credits). `npm run backtest:outliers -- nhl` reruns the rule on the stored history.

### Development URLs

- **Frontend**: http://localhost:3001 (development)
- **Backend API**: http://localhost:3000/api
- **Production**: http://localhost:3000 (serves both frontend and API)

## Project Structure

```
elo-predictor/
├── src/
│   ├── server/           # Backend Express server
│   │   ├── index.ts      # Server entry point
│   │   └── routes.ts    # API routes
│   ├── data/            # Data fetching logic
│   │   ├── leagueData.ts # Per-league game/ELO cache
│   │   ├── nhlFetcher.ts # NHL API integration
│   │   ├── liigaFetcher.ts # SM-liiga API integration
│   │   ├── uclFetcher.ts # Champions League seed + live updates
│   │   └── eplFetcher.ts # Premier League feed integration
│   ├── elo/             # ELO calculation logic
│   │   ├── calculator.ts
│   │   └── probabilities.ts
│   ├── utils/           # Shared utilities
│   │   ├── leagues.ts   # League registry + team tables
│   │   └── types.ts     # TypeScript type definitions
│   ├── components/      # React components
│   │   ├── TeamSelector.tsx
│   │   ├── PredictionResult.tsx
│   │   └── TeamList.tsx
│   ├── App.tsx          # Main React app
│   ├── main.tsx         # React entry point
│   └── App.css          # App styles
├── dist/                # Build output
│   ├── server/          # Compiled backend
│   └── client/          # Built frontend
├── package.json
├── tsconfig.json        # TypeScript config
├── vite.config.ts       # Vite config
└── index.html           # HTML template
```

## API Endpoints

All game-history endpoints take an optional `league=nhl|liiga|epl` query parameter (default `nhl`).

- `GET /api/leagues` - List supported leagues
- `GET /api/teams?league=` - Get all teams with current ELO ratings
- `GET /api/predict?league=&home=TEAM&away=TEAM` - 1X2 probabilities and fair odds. `market` is `fullTime` for soccer and `regulation` for hockey, where the draw is a game tied after 60 minutes; hockey responses also carry a two-way `moneyline` (winner incl. OT/SO)
- `GET /api/predict/score?league=&home=TEAM&away=TEAM` - Correct-score probabilities
- `GET /api/soccer/teams`, `GET /api/predict/soccer`, `GET /api/predict/soccer/score` - Seeded soccer competitions; `competition=worldcup` (default, neutral venues) or `competition=ucl` (home advantage on). `neutral=true|false` and `drawFactor=0` override per request.
- `GET /api/ucl/teams` - Champions League clubs with seed rating, current rating and games played

## How It Works

1. **Data Collection**: Fetches NHL game data from the official NHL API
2. **ELO Calculation**: Calculates ELO ratings based on game results
3. **Prediction**: Uses ELO ratings to calculate win probabilities
4. **Display**: Shows predictions and team rankings in a modern UI

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

ISC License - see LICENSE file for details
