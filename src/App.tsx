import React, { useState, useEffect } from "react";
import "./App.css";
import TeamSelector from "./components/TeamSelector";
import PredictionResult from "./components/PredictionResult";
import ScorePrediction from "./components/ScorePrediction";
import TeamList from "./components/TeamList";

interface Team {
  abbr: string;
  elo: number;
}

interface Prediction {
  homeTeam: string;
  awayTeam: string;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  minHomeOdd?: number;
  minAwayOdd?: number;
}

interface ScorePrediction {
  homeTeam: string;
  awayTeam: string;
  lambdaHome: number;
  lambdaAway: number;
  top10: any[];
}

function App() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [scorePrediction, setScorePrediction] =
    useState<ScorePrediction | null>(null);
  const [selectedHome, setSelectedHome] = useState<string>("");
  const [selectedAway, setSelectedAway] = useState<string>("");

  useEffect(() => {
    fetchTeams();
  }, []);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/teams");
      if (!response.ok) {
        throw new Error("Failed to fetch teams");
      }
      const data = await response.json();
      setTeams(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handlePredict = async () => {
    if (!selectedHome || !selectedAway) {
      setError("Please select both home and away teams");
      return;
    }

    try {
      setError(null);

      // Fetch both predictions in parallel
      const [predictionResponse, scoreResponse] = await Promise.all([
        fetch(`/api/predict?home=${selectedHome}&away=${selectedAway}`),
        fetch(`/api/predict/score?home=${selectedHome}&away=${selectedAway}`),
      ]);

      if (!predictionResponse.ok) {
        throw new Error("Failed to get prediction");
      }
      if (!scoreResponse.ok) {
        throw new Error("Failed to get score prediction");
      }

      const predictionData = await predictionResponse.json();
      const scoreData = await scoreResponse.json();

      setPrediction(predictionData);
      setScorePrediction(scoreData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading NHL teams...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🏒 NHL ELO Predictor</h1>
        <p>Predict NHL game outcomes using ELO ratings</p>
      </header>

      <main className="app-main">
        {error && (
          <div className="error">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        <div className="prediction-section">
          <h2>Game Prediction</h2>
          <TeamSelector
            teams={teams}
            selectedHome={selectedHome}
            selectedAway={selectedAway}
            onHomeChange={setSelectedHome}
            onAwayChange={setSelectedAway}
            onPredict={handlePredict}
          />

          {prediction && <PredictionResult prediction={prediction} />}
          {scorePrediction && (
            <ScorePrediction scorePrediction={scorePrediction} />
          )}
        </div>

        <div className="teams-section">
          <h2>Team ELO Ratings</h2>
          <TeamList teams={teams} />
        </div>
      </main>
    </div>
  );
}

export default App;
