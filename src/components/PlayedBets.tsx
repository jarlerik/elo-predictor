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

interface SelectedBet {
  filename: string;
  betIndex: number;
  bet: Bet;
  betFile: BetFile;
}

const PlayedBets: React.FC = () => {
  const [betFiles, setBetFiles] = useState<BetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [betData, setBetData] = useState<Record<string, Bet[]>>({});
  const [selectedBet, setSelectedBet] = useState<SelectedBet | null>(null);
  const [returnValue, setReturnValue] = useState<string>("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    fetchBetFiles();
  }, []);

  const parseDate = (dateStr: string): Date => {
    // Date format: DD.MM.YYYY
    const [day, month, year] = dateStr.split(".").map(Number);
    return new Date(year, month - 1, day);
  };

  const fetchBetFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/bets/list");
      if (!response.ok) {
        throw new Error("Failed to fetch bet files");
      }
      const data = await response.json();
      // Sort by date (newest first)
      const sortedData = data.sort((a: BetFile, b: BetFile) => {
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        return dateB.getTime() - dateA.getTime();
      });
      setBetFiles(sortedData);
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

  const handleScoreToggle = (
    filename: string,
    betIndex: number,
    bet: Bet,
    event: React.MouseEvent
  ) => {
    event.stopPropagation(); // Prevent row expansion/collapse
    const betFile = betFiles.find((f) => f.filename === filename);
    if (!betFile) return;

    // If clicking the same score, deselect it
    if (
      selectedBet &&
      selectedBet.filename === filename &&
      selectedBet.betIndex === betIndex
    ) {
      setSelectedBet(null);
      setReturnValue("");
    } else {
      setSelectedBet({ filename, betIndex, bet, betFile });
      setReturnValue("");
    }
  };

  const handleAddResult = async () => {
    if (!selectedBet || !returnValue) {
      return;
    }

    const returnNum = parseFloat(returnValue);
    if (isNaN(returnNum)) {
      setMessage({
        type: "error",
        text: "Please enter a valid return value",
      });
      return;
    }

    setMessage(null);

    try {
      // Extract game name from filename (remove .json extension)
      const gameName = selectedBet.filename.replace(".json", "");

      const response = await fetch("/api/results/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          game: gameName,
          score: selectedBet.bet.score,
          probability: selectedBet.bet.probability,
          odds: selectedBet.bet.odds,
          return: returnNum,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save result");
      }

      // Success - reset form and show confirmation
      const gameNameDisplay = selectedBet.filename.replace(".json", "");
      setSelectedBet(null);
      setReturnValue("");
      setMessage({
        type: "success",
        text: `Result added successfully! (${gameNameDisplay})`,
      });
    } catch (err) {
      console.error("Failed to add result:", err);
      setMessage({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "An error occurred while adding result",
      });
    }
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

  // Group bets by date
  const groupedByDate = betFiles.reduce((acc, betFile) => {
    const date = betFile.date;
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(betFile);
    return acc;
  }, {} as Record<string, BetFile[]>);

  // Get dates sorted (newest first)
  const dates = Object.keys(groupedByDate).sort((a, b) => {
    const dateA = parseDate(a);
    const dateB = parseDate(b);
    return dateB.getTime() - dateA.getTime();
  });

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Played Bets</h1>
        <p>View all your saved bet files</p>
      </div>

      {message && (
        <div
          style={{
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: "4px",
            backgroundColor: message.type === "success" ? "#d4edda" : "#f8d7da",
            color: message.type === "success" ? "#155724" : "#721c24",
            border: `1px solid ${
              message.type === "success" ? "#c3e6cb" : "#f5c6cb"
            }`,
          }}
        >
          {message.text}
          <button
            onClick={() => setMessage(null)}
            style={{
              float: "right",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "1.2rem",
              lineHeight: "1",
              padding: "0",
              marginLeft: "0.5rem",
            }}
          >
            ×
          </button>
        </div>
      )}

      {selectedBet && (
        <div
          className="add-result-section"
          style={{
            backgroundColor: "#262626",
            borderRadius: "8px",
            padding: "1.5rem",
            marginBottom: "2rem",
            border: "1px solid #404040",
          }}
        >
          <h3
            style={{
              marginTop: 0,
              marginBottom: "1rem",
              color: "#FFFFFF",
              fontSize: "1.1rem",
            }}
          >
            Add result for {getTeamName(selectedBet.betFile.homeTeam)} vs{" "}
            {getTeamName(selectedBet.betFile.awayTeam)}
          </h3>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1.5rem",
              flexWrap: "wrap",
              marginBottom: "1rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                flex: 1,
                minWidth: "300px",
              }}
            >
              <span
                style={{
                  color: "#FFFFFF",
                  fontSize: "1.1rem",
                  fontWeight: "600",
                }}
              >
                {selectedBet.bet.score}
              </span>
              <span
                style={{
                  color: "#a3a3a3",
                  fontSize: "1rem",
                }}
              >
                {formatProbability(selectedBet.bet.probability)}
              </span>
              <span
                style={{
                  color: "#f97316",
                  fontSize: "1.1rem",
                  fontWeight: "600",
                }}
              >
                {formatOdds(selectedBet.bet.odds)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                flex: 1,
                minWidth: "200px",
              }}
            >
              <label
                style={{
                  color: "#a3a3a3",
                  fontSize: "0.9rem",
                }}
              >
                Return:
              </label>
              <input
                type="number"
                value={returnValue}
                onChange={(e) => setReturnValue(e.target.value)}
                placeholder="Enter return"
                style={{
                  padding: "0.5rem 0.75rem",
                  border: "1px solid #404040",
                  borderRadius: "6px",
                  background: "#171717",
                  color: "#FFFFFF",
                  fontSize: "1rem",
                  flex: 1,
                  minWidth: "150px",
                }}
              />
              <button
                onClick={handleAddResult}
                style={{
                  padding: "0.5rem 1.5rem",
                  backgroundColor: "#f97316",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "1rem",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "#ea580c";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "#f97316";
                }}
              >
                Add result
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bets-section">
        {betFiles.length === 0 ? (
          <div className="empty-state">
            <p>No bet files found. Save some bets to see them here.</p>
          </div>
        ) : (
          <div className="bets-list">
            {dates.map((date) => (
              <div key={date} className="date-group">
                <div
                  className="date-header"
                  style={{
                    padding: "1rem",
                    marginBottom: "0.5rem",
                    marginTop: dates.indexOf(date) > 0 ? "2rem" : "0",
                    fontSize: "1.1rem",
                    fontWeight: "600",
                    color: "#FFFFFF",
                    borderBottom: "2px solid #404040",
                  }}
                >
                  {date}
                </div>
                {groupedByDate[date].map((betFile) => {
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
                        <span className="bet-count">
                          {betFile.betCount} bets
                        </span>
                      </div>
                      {isExpanded && (
                        <div className="bet-scores">
                          {bets.map((bet, index) => {
                            const isSelected =
                              selectedBet &&
                              selectedBet.filename === betFile.filename &&
                              selectedBet.betIndex === index;
                            return (
                              <div
                                key={index}
                                className="bet-score-item"
                                onClick={(e) =>
                                  handleScoreToggle(
                                    betFile.filename,
                                    index,
                                    bet,
                                    e
                                  )
                                }
                                style={{
                                  cursor: "pointer",
                                  backgroundColor: isSelected
                                    ? "#404040"
                                    : "transparent",
                                  transition: "background-color 0.2s",
                                }}
                                onMouseOver={(e) => {
                                  if (!isSelected) {
                                    e.currentTarget.style.backgroundColor =
                                      "#2a2a2a";
                                  }
                                }}
                                onMouseOut={(e) => {
                                  if (!isSelected) {
                                    e.currentTarget.style.backgroundColor =
                                      "transparent";
                                  }
                                }}
                              >
                                <span className="bet-score">{bet.score}</span>
                                <span className="bet-probability">
                                  {formatProbability(bet.probability)}
                                </span>
                                <span className="bet-odds">
                                  {formatOdds(bet.odds)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayedBets;
