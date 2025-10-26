import React from "react";
import { TEAM_FULL_NAMES } from "../utils/teamData";

interface Team {
  abbr: string;
  elo: number;
}

interface TeamSelectorProps {
  teams: Team[];
  selectedHome: string;
  selectedAway: string;
  onHomeChange: (team: string) => void;
  onAwayChange: (team: string) => void;
  onPredict: () => void;
}

const TeamSelector: React.FC<TeamSelectorProps> = ({
  teams,
  selectedHome,
  selectedAway,
  onHomeChange,
  onAwayChange,
  onPredict,
}) => {
  const sortedTeams = [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr));

  return (
    <div className="team-selector">
      <div className="team-selection">
        <div className="team-field">
          <label htmlFor="home-team">Home Team:</label>
          <select
            id="home-team"
            value={selectedHome}
            onChange={(e) => onHomeChange(e.target.value)}
            className="team-select"
          >
            <option value="">Select home team</option>
            {sortedTeams.map((team) => (
              <option key={team.abbr} value={team.abbr}>
                {TEAM_FULL_NAMES[team.abbr] || team.abbr}
              </option>
            ))}
          </select>
        </div>

        <div className="vs-divider">
          <span>vs</span>
        </div>

        <div className="team-field">
          <label htmlFor="away-team">Away Team:</label>
          <select
            id="away-team"
            value={selectedAway}
            onChange={(e) => onAwayChange(e.target.value)}
            className="team-select"
          >
            <option value="">Select away team</option>
            {sortedTeams.map((team) => (
              <option key={team.abbr} value={team.abbr}>
                {TEAM_FULL_NAMES[team.abbr] || team.abbr}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={onPredict}
        disabled={!selectedHome || !selectedAway}
        className="predict-button"
      >
        Predict Outcome
      </button>
    </div>
  );
};

export default TeamSelector;
