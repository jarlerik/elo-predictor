import React, { useState, useEffect } from "react";

interface Result {
  game: string;
  /** Correct-score bets. */
  score?: string;
  /** Winner bets: picked team abbreviation, or "DRAW". */
  team?: string;
  probability: number;
  odds: number;
  return: number;
}

const Results: React.FC = () => {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Sum of stakes in euros across all saved bets, plus how many entries.
  const [totalBets, setTotalBets] = useState<number>(0);
  const [betCount, setBetCount] = useState<number>(0);

  useEffect(() => {
    fetchResults();
    fetchTotalBets();
  }, []);

  const fetchResults = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/results");
      if (!response.ok) {
        throw new Error("Failed to fetch results");
      }
      const data: Result[] = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const fetchTotalBets = async () => {
    try {
      const response = await fetch("/api/bets/total");
      if (!response.ok) {
        throw new Error("Failed to fetch total bets");
      }
      const data = await response.json();
      setTotalBets(data.total || 0);
      setBetCount(data.count || 0);
    } catch (err) {
      console.error("Failed to fetch total bets:", err);
    }
  };

  const formatGameName = (game: string): string => {
    // Format: COL__TBL_04.11.2025 -> COL vs TBL 04.11.2025
    const parts = game.split("__");
    if (parts.length === 2) {
      const rest = parts[1];
      const restParts = rest.split("_");
      if (restParts.length >= 2) {
        const awayTeam = restParts[0];
        const date = restParts.slice(1).join("_");
        return `${parts[0]} vs ${awayTeam} ${date}`;
      }
    }
    return game;
  };

  // Game key is HOME__AWAY_DD.MM.YYYY.
  const parseTeams = (game: string): { home: string; away: string } | null => {
    const parts = game.split("__");
    if (parts.length !== 2) return null;
    const away = parts[1].split("_")[0];
    return away ? { home: parts[0], away } : null;
  };

  // Score bets show the score; winner bets show the 1X2 pick.
  const formatPick = (result: Result): string => {
    if (result.score) return result.score;
    if (!result.team) return "";
    if (result.team === "DRAW") return "X";
    const teams = parseTeams(result.game);
    if (teams?.home === result.team) return `1 (${result.team})`;
    if (teams?.away === result.team) return `2 (${result.team})`;
    return result.team;
  };

  const formatPercentage = (value: number): string => {
    return `${(value * 100).toFixed(2)}%`;
  };

  const formatCurrency = (value: number): string => {
    return `${value.toFixed(2)}€`;
  };

  const totalResults = results.length;
  const totalReturn = results.reduce((sum, r) => sum + r.return, 0);
  const returnRate =
    totalBets > 0 ? ((totalReturn - totalBets) / totalBets) * 100 : 0;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Results</h1>
      </div>
      <div className="results-summary">
        <p>
          Total staked: <strong>{formatCurrency(totalBets)}</strong>{" "}
          <span style={{ opacity: 0.7 }}>({betCount} bets)</span>
        </p>
        <p>
          Total Return: <strong>{formatCurrency(totalReturn)}</strong>
        </p>
        <p>
          Return rate: <strong>{returnRate.toFixed(2)}%</strong>
        </p>
      </div>
      <div className="results-section">
        {loading ? (
          <p>Loading...</p>
        ) : error ? (
          <p className="error">Error: {error}</p>
        ) : results.length === 0 ? (
          <p>No results found.</p>
        ) : (
          <div className="results-table-container">
            <div className="results-table">
              <div className="results-cell results-header-cell">Game</div>
              <div className="results-cell results-header-cell">Pick</div>
              <div className="results-cell results-header-cell">
                Probability
              </div>
              <div className="results-cell results-header-cell">Odds</div>
              <div className="results-cell results-header-cell">Return</div>
              {results.map((result, index) => (
                <React.Fragment key={index}>
                  <div className="results-cell" data-label="Game">
                    {formatGameName(result.game)}
                  </div>
                  <div className="results-cell" data-label="Pick">
                    {formatPick(result)}
                  </div>
                  <div className="results-cell" data-label="Probability">
                    {formatPercentage(result.probability)}
                  </div>
                  <div className="results-cell" data-label="Odds">
                    {result.odds.toFixed(2)}
                  </div>
                  <div className="results-cell" data-label="Return">
                    {formatCurrency(result.return)}
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Results;
