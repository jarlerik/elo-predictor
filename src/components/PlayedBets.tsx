import React, { useState, useEffect } from "react";
import { TEAM_FULL_NAMES } from "../utils/teamData";

interface BetFile {
  filename: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  betCount: number;
}

const PlayedBets: React.FC = () => {
  const [betFiles, setBetFiles] = useState<BetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBetFiles();
  }, []);

  const fetchBetFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/bets/list");
      if (!response.ok) {
        throw new Error("Failed to fetch bet files");
      }
      const data = await response.json();
      setBetFiles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const getTeamName = (abbr: string): string => {
    return TEAM_FULL_NAMES[abbr] || abbr;
  };

  if (loading) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>Played Bets</h1>
          <p>Loading bet files...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>Played Bets</h1>
          <p className="error">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Played Bets</h1>
        <p>View all your saved bet files</p>
      </div>

      <div className="bets-section">
        {betFiles.length === 0 ? (
          <div className="empty-state">
            <p>No bet files found. Save some bets to see them here.</p>
          </div>
        ) : (
          <div className="bets-list">
            {betFiles.map((betFile) => (
              <div key={betFile.filename} className="bet-file-row">
                <span className="bet-match">
                  {getTeamName(betFile.homeTeam)} vs {getTeamName(betFile.awayTeam)}
                </span>
                <span className="bet-date">{betFile.date}</span>
                <span className="bet-count">{betFile.betCount} bets</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayedBets;

