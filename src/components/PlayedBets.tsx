import React, { useState, useEffect } from "react";
import { TEAM_FULL_NAMES } from "../utils/teamData";

interface BetFile {
  filename: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  betCount: number;
}

interface Bet {
  score: string;
  probability: number;
  odds: number;
}

const PlayedBets: React.FC = () => {
  const [betFiles, setBetFiles] = useState<BetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [betData, setBetData] = useState<Record<string, Bet[]>>({});

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

  const fetchBetData = async (filename: string) => {
    if (betData[filename]) {
      return; // Already fetched
    }

    try {
      const response = await fetch(`/api/bets/${filename}`);
      if (!response.ok) {
        throw new Error("Failed to fetch bet data");
      }
      const data = await response.json();
      setBetData((prev) => ({ ...prev, [filename]: data }));
    } catch (err) {
      console.error("Failed to fetch bet data:", err);
    }
  };

  const toggleRow = (filename: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(filename)) {
      newExpanded.delete(filename);
    } else {
      newExpanded.add(filename);
      fetchBetData(filename);
    }
    setExpandedRows(newExpanded);
  };

  const getTeamName = (abbr: string): string => {
    return TEAM_FULL_NAMES[abbr] || abbr;
  };

  const formatProbability = (prob: number): string => {
    return `${(prob * 100).toFixed(2)}%`;
  };

  const formatOdds = (odds: number): string => {
    return odds.toFixed(2);
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
            {betFiles.map((betFile) => {
              const isExpanded = expandedRows.has(betFile.filename);
              const bets = betData[betFile.filename] || [];

              return (
                <div key={betFile.filename}>
                  <div
                    className="bet-file-row"
                    onClick={() => toggleRow(betFile.filename)}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="bet-match">
                      {getTeamName(betFile.homeTeam)} vs{" "}
                      {getTeamName(betFile.awayTeam)}
                    </span>
                    <span className="bet-date">{betFile.date}</span>
                    <span className="bet-count">{betFile.betCount} bets</span>
                  </div>
                  {isExpanded && (
                    <div className="bet-scores">
                      {bets.map((bet, index) => (
                        <div key={index} className="bet-score-item">
                          <span className="bet-score">{bet.score}</span>
                          <span className="bet-probability">
                            {formatProbability(bet.probability)}
                          </span>
                          <span className="bet-odds">
                            {formatOdds(bet.odds)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayedBets;
