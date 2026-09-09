import React from "react";
import { HeadlineTiles, ProfitChart, useSummary } from "./metrics";

/**
 * Betting dashboard (docs/METRICS_AND_DASHBOARD.md). Step 3: headline
 * tiles and the cumulative profit chart. Calibration, segments, staking and
 * open positions follow in later steps.
 */
const Dashboard: React.FC = () => {
  const { summary, error } = useSummary();

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>
          Settled bets scored against what the model expected. Muted tiles
          have too few bets behind them to mean much yet.
        </p>
      </div>
      {error ? (
        <p className="error">Error: {error}</p>
      ) : !summary ? (
        <p>Loading...</p>
      ) : (
        <>
          <HeadlineTiles summary={summary} />
          <h2 className="panel-title">Cumulative profit</h2>
          <ProfitChart series={summary.series} />
        </>
      )}
    </div>
  );
};

export default Dashboard;
