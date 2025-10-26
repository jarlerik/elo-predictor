# NHL ELO Predictor

A full-stack web application that predicts NHL game outcomes using ELO ratings. Built with Node.js/Express backend and React/TypeScript frontend.

## Features

- 🏒 **NHL Game Predictions**: Predict game outcomes using ELO ratings
- 📊 **Team Rankings**: View current ELO ratings for all NHL teams
- 🎯 **Probability Calculations**: Get win probabilities for home/away teams
- 📱 **Responsive Design**: Modern, mobile-friendly interface
- ⚡ **Real-time Data**: Fetches live NHL data from official APIs

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

3. **Start development servers**
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
│   │   └── nhlFetcher.ts # NHL API integration
│   ├── elo/             # ELO calculation logic
│   │   ├── calculator.ts
│   │   └── probabilities.ts
│   ├── utils/           # Shared utilities
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

- `GET /api/teams` - Get all teams with current ELO ratings
- `GET /api/predict?home=TEAM&away=TEAM` - Get game prediction

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
