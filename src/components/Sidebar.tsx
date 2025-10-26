import React from "react";

interface SidebarProps {
  activePage: string;
  onPageChange: (page: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activePage, onPageChange }) => {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>NHL ELO Predictor</h2>
        <p>v1.0.0 BETA</p>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-item ${activePage === "prediction" ? "active" : ""}`}
          onClick={() => onPageChange("prediction")}
        >
          <span className="nav-icon">🎯</span>
          <span className="nav-text">PREDICT GAME</span>
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
      </nav>

      <div className="sidebar-footer">
        <div className="system-status">
          <span className="status-label">SYSTEM</span>
          <span className="status-value">ONLINE</span>
        </div>
        <div className="status-info">
          <span>Teams: 32</span>
          <span>ELO Updated</span>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
