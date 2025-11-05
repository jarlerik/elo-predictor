import React, { useState, useEffect } from "react";

interface Result {
  game: string;
  score: string;
  probability: number;
  odds: number;
  return: number;
}

const Results: React.FC = () => {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchResults();
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

  const formatPercentage = (value: number): string => {
    return `${(value * 100).toFixed(2)}%`;
  };

  const formatCurrency = (value: number): string => {
    return `${value.toFixed(2)}€`;
  };

  const totalResults = results.length;
  const totalReturn = results.reduce((sum, r) => sum + r.return, 0);

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Results</h1>
      </div>
      <div className="results-summary">
        <p>
          Total Results: <strong>{totalResults}</strong>
        </p>
        <p>
          Total Return: <strong>{formatCurrency(totalReturn)}</strong>
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
              <div className="results-cell results-header-cell">Score</div>
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
                  <div className="results-cell" data-label="Score">
                    {result.score}
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
