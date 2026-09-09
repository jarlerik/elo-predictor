import React from "react";
import {
  HeadlineTiles,
  ProfitChart,
  SegmentTable,
  useSummary,
} from "./metrics";
import { CalibrationPanel } from "./Calibration";

/**
 * Betting dashboard (docs/METRICS_AND_DASHBOARD.md). Headline tiles and the
 * cumulative profit chart (step 3), model calibration per league (step 4),
 * the segment table (step 5). Staking and open positions follow later.
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
      <h2 className="panel-title calibration-heading">Model calibration</h2>
      <p className="panel-note">
        Backtest over every played game in the history: the probabilities the
        model would have shown before each game, scored against what
        happened. Independent of the bets.
      </p>
      <CalibrationPanel />
      <h2 className="panel-title calibration-heading">Segments</h2>
      <p className="panel-note">
        The same figures as the tiles, sliced. Pick a slice to see where the
        bets are and which of them carry the result.
      </p>
      <SegmentTable />
    </div>
  );
};

export default Dashboard;
