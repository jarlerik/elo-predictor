import React from "react";

interface SidebarProps {
  activePage: string;
  onPageChange: (page: string) => void;
  isMobileMenuOpen: boolean;
  onMobileMenuToggle: (open: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onPageChange,
  isMobileMenuOpen,
  onMobileMenuToggle,
}) => {
  return (
    <>
      <button
        className="mobile-menu-button"
        onClick={() => onMobileMenuToggle(!isMobileMenuOpen)}
        aria-label="Toggle menu"
      >
        <span className="hamburger-icon">☰</span>
      </button>
      <div className={`sidebar ${isMobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-header">
          <h2>ELO Predictor</h2>
          <p>v1.0.0 BETA</p>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${
              activePage === "prediction" ? "active" : ""
            }`}
            onClick={() => onPageChange("prediction")}
          >
            <span className="nav-icon">🏒</span>
            <span className="nav-text">NHL</span>
          </button>

          <button
            className={`nav-item ${activePage === "liiga" ? "active" : ""}`}
            onClick={() => onPageChange("liiga")}
          >
            <span className="nav-icon">🇫🇮</span>
            <span className="nav-text">SM-LIIGA</span>
          </button>

          <button
            className={`nav-item ${activePage === "epl" ? "active" : ""}`}
            onClick={() => onPageChange("epl")}
          >
            <span className="nav-icon">⚽</span>
            <span className="nav-text">PREMIER LEAGUE</span>
          </button>

          <button
            className={`nav-item ${activePage === "soccer" ? "active" : ""}`}
            onClick={() => onPageChange("soccer")}
          >
            <span className="nav-icon">🏆</span>
            <span className="nav-text">WORLD CUP</span>
          </button>

          <button
            className={`nav-item ${activePage === "ratings" ? "active" : ""}`}
            onClick={() => onPageChange("ratings")}
          >
            <span className="nav-icon">📊</span>
            <span className="nav-text">TEAM RATINGS</span>
          </button>

          <button
            className={`nav-item ${activePage === "kelly" ? "active" : ""}`}
            onClick={() => onPageChange("kelly")}
          >
            <span className="nav-icon">💰</span>
            <span className="nav-text">KELLY BET</span>
          </button>

          <button
            className={`nav-item ${
              activePage === "played-bets" ? "active" : ""
            }`}
            onClick={() => onPageChange("played-bets")}
          >
            <span className="nav-icon">📋</span>
            <span className="nav-text">PLAYED SCORE BETS</span>
          </button>

          <button
            className={`nav-item ${
              activePage === "played-winner-bets" ? "active" : ""
            }`}
            onClick={() => onPageChange("played-winner-bets")}
          >
            <span className="nav-icon">🏆</span>
            <span className="nav-text">PLAYED WINNER BETS</span>
          </button>

          <button
            className={`nav-item ${activePage === "results" ? "active" : ""}`}
            onClick={() => onPageChange("results")}
          >
            <span className="nav-icon">📈</span>
            <span className="nav-text">RESULTS</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="system-status">
            <span className="status-label">SYSTEM</span>
            <span className="status-value">ONLINE</span>
          </div>
          <div className="status-info">
            <span>NHL · Liiga · EPL</span>
            <span>ELO Updated</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
