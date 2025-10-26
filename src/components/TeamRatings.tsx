import React from "react";
import TeamList from "./TeamList";

interface Team {
  abbr: string;
  elo: number;
}

interface TeamRatingsProps {
  teams: Team[];
}

const TeamRatings: React.FC<TeamRatingsProps> = ({ teams }) => {
  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Team ELO Ratings</h1>
        <p>Current ELO ratings for all NHL teams</p>
      </div>

      <div className="teams-section">
        <TeamList teams={teams} />
      </div>
    </div>
  );
};

export default TeamRatings;
