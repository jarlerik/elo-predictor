import React from "react";
import { TEAM_FULL_NAMES } from "../utils/teamData";

interface ScoreProbability {
  home: number;
  away: number;
  score: string;
  probability: number;
  minOdd: number;
  expectedValue?: number | null;
}

interface ScorePrediction {
  homeTeam: string;
  awayTeam: string;
  lambdaHome: number;
  lambdaAway: number;
  top10: ScoreProbability[];
}

interface ScorePredictionProps {
  scorePrediction: ScorePrediction;
}

const ScorePrediction: React.FC<ScorePredictionProps> = ({
  scorePrediction,
}) => {
  return (
    <div className="score-prediction">
      <h3>Top 10 Score Value Bets</h3>

      <div className="expected-goals">
        <div className="goal-expectation">
          <span className="team-name">
            {TEAM_FULL_NAMES[scorePrediction.homeTeam] ||
              scorePrediction.homeTeam}
          </span>
          <span className="lambda">
            Expected Goals: {scorePrediction.lambdaHome}
          </span>
        </div>
        <div className="goal-expectation">
          <span className="team-name">
            {TEAM_FULL_NAMES[scorePrediction.awayTeam] ||
              scorePrediction.awayTeam}
          </span>
          <span className="lambda">
            Expected Goals: {scorePrediction.lambdaAway}
          </span>
        </div>
      </div>

      <div className="value-bets">
        {scorePrediction.top10.map((bet, index) => (
          <div key={index} className="value-bet-card">
            <div className="bet-info">
              <div className="bet-type">Score: {bet.score}</div>
              <div className="bet-details">
                {TEAM_FULL_NAMES[scorePrediction.homeTeam] ||
                  scorePrediction.homeTeam}{" "}
                {bet.home} - {bet.away}{" "}
                {TEAM_FULL_NAMES[scorePrediction.awayTeam] ||
                  scorePrediction.awayTeam}
              </div>
            </div>
            <div className="bet-stats">
              <div className="probability">
                {(bet.probability * 100).toFixed(2)}%
              </div>
              <div className="odds">Min Odds: {bet.minOdd.toFixed(2)}</div>
              {bet.expectedValue && (
                <div className="value">
                  Expected Value: {bet.expectedValue.toFixed(2)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ScorePrediction;
