import React, { useState, useEffect } from "react";

interface BetFile {
  filename: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  betCount: number;
}

const Results: React.FC = () => {
  const [totalBets, setTotalBets] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTotalBets();
  }, []);

  const fetchTotalBets = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/bets/list");
      if (!response.ok) {
        throw new Error("Failed to fetch bet files");
      }
      const data: BetFile[] = await response.json();
      const total = data.reduce((sum, file) => sum + file.betCount, 0);
      setTotalBets(total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Results</h1>
      </div>
      <div className="results-section">
        {loading ? (
          <p>Loading...</p>
        ) : error ? (
          <p className="error">Error: {error}</p>
        ) : (
          <p>Total played bets: {totalBets}</p>
        )}
      </div>
    </div>
  );
};

export default Results;

