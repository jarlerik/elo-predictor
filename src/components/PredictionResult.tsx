import React from "react";

interface Prediction {
  homeTeam: string;
  awayTeam: string;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
}

interface PredictionResultProps {
  prediction: Prediction;
}

const PredictionResult: React.FC<PredictionResultProps> = ({ prediction }) => {
  const homePercent = (prediction.homeWinProbability * 100).toFixed(1);
  const awayPercent = (prediction.awayWinProbability * 100).toFixed(1);
  const drawPercent = (prediction.drawProbability * 100).toFixed(1);

  return (
    <div className="prediction-result">
      <h3>Prediction Results</h3>
      <div className="game-matchup">
        <span className="away-team">{prediction.awayTeam}</span>
        <span className="vs">@</span>
        <span className="home-team">{prediction.homeTeam}</span>
      </div>

      <div className="probabilities">
        <div className="probability-card away-win">
          <div className="team-name">{prediction.awayTeam}</div>
          <div className="percentage">{awayPercent}%</div>
          <div className="bar">
            <div
              className="bar-fill"
              style={{ width: `${awayPercent}%` }}
            ></div>
          </div>
        </div>

        <div className="probability-card draw">
          <div className="team-name">Draw</div>
          <div className="percentage">{drawPercent}%</div>
          <div className="bar">
            <div
              className="bar-fill"
              style={{ width: `${drawPercent}%` }}
            ></div>
          </div>
        </div>

        <div className="probability-card home-win">
          <div className="team-name">{prediction.homeTeam}</div>
          <div className="percentage">{homePercent}%</div>
          <div className="bar">
            <div
              className="bar-fill"
              style={{ width: `${homePercent}%` }}
            ></div>
          </div>
        </div>
      </div>

      <div className="prediction-summary">
        <p>
          <strong>Most Likely Outcome:</strong>{" "}
          {prediction.homeWinProbability > prediction.awayWinProbability
            ? `${prediction.homeTeam} wins at home`
            : `${prediction.awayTeam} wins on the road`}
        </p>
      </div>
    </div>
  );
};

export default PredictionResult;
