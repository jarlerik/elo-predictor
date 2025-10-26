import React, { useState } from "react";
import TeamSelector from "./TeamSelector";
import PredictionResult from "./PredictionResult";
import ScorePrediction from "./ScorePrediction";

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

interface GamePredictionProps {
  teams: Team[];
}

const GamePrediction: React.FC<GamePredictionProps> = ({ teams }) => {
  const [error, setError] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [scorePrediction, setScorePrediction] =
    useState<ScorePrediction | null>(null);
  const [selectedHome, setSelectedHome] = useState<string>("");
  const [selectedAway, setSelectedAway] = useState<string>("");

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

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Game Prediction</h1>
        <p>Calculate probabilities for betting</p>
      </div>

      {error && (
        <div className="error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="prediction-section">
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
    </div>
  );
};

export default GamePrediction;
