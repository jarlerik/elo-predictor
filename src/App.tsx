import React, { useState } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import GamePrediction from "./components/GamePrediction";
import SoccerPrediction from "./components/SoccerPrediction";
import TeamRatings from "./components/TeamRatings";
import KellyBet from "./components/KellyBet";
import PlayedBets from "./components/PlayedBets";
import PlayedWinnerBets from "./components/PlayedWinnerBets";
import Results from "./components/Results";

function App() {
  const [activePage, setActivePage] = useState<string>("prediction");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
        {activePage === "prediction" && <GamePrediction league="nhl" />}
        {activePage === "liiga" && <GamePrediction league="liiga" />}
        {activePage === "epl" && <GamePrediction league="epl" />}
        {activePage === "ucl" && <SoccerPrediction competition="ucl" />}
        {activePage === "soccer" && <SoccerPrediction competition="worldcup" />}
        {activePage === "ratings" && <TeamRatings />}
        {activePage === "kelly" && <KellyBet />}
        {activePage === "played-bets" && <PlayedBets />}
        {activePage === "played-winner-bets" && <PlayedWinnerBets />}
        {activePage === "results" && <Results />}
      </main>
    </div>
  );
}

export default App;
