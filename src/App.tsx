import React, { useState, useEffect } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import GamePrediction from "./components/GamePrediction";
import TeamRatings from "./components/TeamRatings";
import KellyBet from "./components/KellyBet";

interface Team {
  abbr: string;
  elo: number;
}

function App() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<string>("prediction");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetchTeams();
  }, []);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/teams");
      if (!response.ok) {
        throw new Error("Failed to fetch teams");
      }
      const data = await response.json();
      setTeams(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading NHL teams...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        activePage={activePage}
        onPageChange={(page) => {
          setActivePage(page);
          setIsMobileMenuOpen(false);
        }}
        isMobileMenuOpen={isMobileMenuOpen}
        onMobileMenuToggle={setIsMobileMenuOpen}
      />

      <div
        className={`sidebar-overlay ${isMobileMenuOpen ? "active" : ""}`}
        onClick={() => setIsMobileMenuOpen(false)}
      />

      <main className="app-main">
        {activePage === "prediction" && <GamePrediction teams={teams} />}
        {activePage === "ratings" && <TeamRatings teams={teams} />}
        {activePage === "kelly" && <KellyBet />}
      </main>
    </div>
  );
}

export default App;
