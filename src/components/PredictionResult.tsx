import React from "react";
import { TEAM_FULL_NAMES } from "../utils/teamData";

interface Prediction {
  homeTeam: string;
  awayTeam: string;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  minHomeOdd?: number;
  minAwayOdd?: number;
}

interface PredictionResultProps {
  prediction: Prediction;
}

const PredictionResult: React.FC<PredictionResultProps> = ({ prediction }) => {
  const homePercent = (prediction.homeWinProbability * 100).toFixed(1);
  const awayPercent = (prediction.awayWinProbability * 100).toFixed(1);

  return (
    <div className="prediction-result">
      <h3>Prediction Results</h3>
      <div className="game-matchup">
        <span className="home-team">
          {TEAM_FULL_NAMES[prediction.homeTeam] || prediction.homeTeam}
        </span>
        <span className="vs">vs</span>
        <span className="away-team">
          {TEAM_FULL_NAMES[prediction.awayTeam] || prediction.awayTeam}
        </span>
      </div>

      <div className="probabilities">
        <div className="probability-card home-win">
          <div className="team-name">
            {TEAM_FULL_NAMES[prediction.homeTeam] || prediction.homeTeam}
          </div>
          <div className="percentage">{homePercent}%</div>
          {prediction.minHomeOdd && (
            <div className="odds">
              Min Odds: {prediction.minHomeOdd.toFixed(2)}
            </div>
          )}
          <div className="bar">
            <div
              className="bar-fill"
              style={{ width: `${homePercent}%` }}
            ></div>
          </div>
        </div>

        <div className="probability-card away-win">
          <div className="team-name">
            {TEAM_FULL_NAMES[prediction.awayTeam] || prediction.awayTeam}
          </div>
          <div className="percentage">{awayPercent}%</div>
          {prediction.minAwayOdd && (
            <div className="odds">
              Min Odds: {prediction.minAwayOdd.toFixed(2)}
            </div>
          )}
          <div className="bar">
            <div
              className="bar-fill"
              style={{ width: `${awayPercent}%` }}
            ></div>
          </div>
        </div>
      </div>

      <div className="prediction-summary">
        <p>
          <strong>Most Likely Outcome:</strong>{" "}
          {prediction.homeWinProbability > prediction.awayWinProbability
            ? `${
                TEAM_FULL_NAMES[prediction.homeTeam] || prediction.homeTeam
              } wins at home`
            : `${
                TEAM_FULL_NAMES[prediction.awayTeam] || prediction.awayTeam
              } wins on the road`}
        </p>
      </div>
    </div>
  );
};

export default PredictionResult;
