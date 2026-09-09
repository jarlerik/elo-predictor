import React from "react";
import {
  HeadlineTiles,
  ProfitChart,
  SegmentTable,
  useSummary,
} from "./metrics";
import { CalibrationPanel } from "./Calibration";
import { PredictionsPanel } from "./Predictions";
import {
  BankrollPanel,
  OpenPositions,
  StakingChart,
  useBankroll,
  useStaking,
} from "./bankroll";

/**
 * Betting dashboard (docs/METRICS_AND_DASHBOARD.md). Headline tiles and the
 * cumulative profit chart (step 3), model calibration per league (step 4),
 * the segment table (step 5), bankroll, open positions and the staking
 * chart (step 6), the prediction log (step 7).
 */
const Dashboard: React.FC = () => {
  const { summary, error, refresh } = useSummary();
  const bank = useBankroll();
  const { staking, error: stakingError } = useStaking(bank.bankroll);

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
      <h2 className="panel-title calibration-heading">Logged predictions</h2>
      <p className="panel-note">
        Every 1X2 prediction shown on the league pages, bet or not, scored
        once the game is played. Where a bet stored the book's prices, the
        model is compared with the de-vigged book on the same games.
      </p>
      <PredictionsPanel />
      <h2 className="panel-title calibration-heading">Segments</h2>
      <p className="panel-note">
        The same figures as the tiles, sliced. Pick a slice to see where the
        bets are and which of them carry the result.
      </p>
      <SegmentTable />
      <h2 className="panel-title calibration-heading">Bankroll</h2>
      <p className="panel-note">
        Start amount plus deposits, withdrawals and the profit of bets
        settled since. The bet forms read it to show the Kelly stake.
      </p>
      <BankrollPanel
        bankroll={bank.bankroll}
        error={bank.error}
        onChange={(b) => {
          bank.setBankroll(b);
          refresh();
        }}
      />
      <h2 className="panel-title calibration-heading">Open positions</h2>
      <p className="panel-note">
        Pending bets grouped by game: score lines on one game are one
        position. A warning appears when one day's open stakes exceed the
        exposure limit.
      </p>
      {stakingError ? (
        <p className="error">Error: {stakingError}</p>
      ) : !staking ? (
        <p className="chart-empty">Loading...</p>
      ) : (
        <>
          <OpenPositions staking={staking} />
          <h2 className="panel-title calibration-heading">Stake vs Kelly</h2>
          <p className="panel-note">
            Each bet's stake divided by the fractional-Kelly stake its model
            probability and odds implied. 1× is on plan; well above it means
            over-staking.
          </p>
          <StakingChart staking={staking} />
        </>
      )}
    </div>
  );
};

export default Dashboard;
