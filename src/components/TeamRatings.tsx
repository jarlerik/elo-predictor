import React, { useEffect, useState } from "react";
import TeamList from "./TeamList";
import { LeagueId, LEAGUES, LEAGUE_IDS } from "../utils/leagues";

interface Team {
  abbr: string;
  elo: number;
}

const TeamRatings: React.FC = () => {
  const [league, setLeague] = useState<LeagueId>("nhl");
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/teams?league=${league}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || "Failed to load teams");
        }
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setTeams(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "An error occurred");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [league]);

  const info = LEAGUES[league];

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Team ELO Ratings</h1>
        <p>Current ELO ratings for all {info.name} teams</p>
      </div>

      <div className="league-tabs" role="tablist">
        {LEAGUE_IDS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={league === id}
            className={`league-tab ${league === id ? "active" : ""}`}
            onClick={() => setLeague(id)}
          >
            <span>{LEAGUES[id].icon}</span> {LEAGUES[id].name}
          </button>
        ))}
      </div>

      {error && (
        <div className="error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="teams-section">
        {loading ? (
          <div className="loading">Loading {info.name} teams...</div>
        ) : (
          <TeamList teams={teams} />
        )}
      </div>
    </div>
  );
};

export default TeamRatings;
