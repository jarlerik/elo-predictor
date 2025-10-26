import React from "react";

interface Team {
  abbr: string;
  elo: number;
}

interface TeamListProps {
  teams: Team[];
}

const TeamList: React.FC<TeamListProps> = ({ teams }) => {
  const sortedTeams = [...teams].sort((a, b) => b.elo - a.elo);

  return (
    <div className="team-list">
      <div className="team-list-header">
        <span>Team</span>
        <span>ELO Rating</span>
      </div>
      <div className="team-list-items">
        {sortedTeams.map((team, index) => (
          <div key={team.abbr} className="team-item">
            <div className="team-rank">#{index + 1}</div>
            <div className="team-name">{team.abbr}</div>
            <div className="team-elo">{team.elo.toFixed(0)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TeamList;
