import React, { useEffect, useState } from "react";
import { Bucket, CalibrationChart } from "./Calibration";
import { pct } from "./metrics";

/** Response of GET /api/metrics/predictions (see src/data/predictions.ts). */
export interface ScoredPrediction {
  id: string;
  at: string;
  league: string;
  home: string;
  away: string;
  market: "regulation" | "fullTime";
  probs: [number, number, number];
  marketOdds: Record<string, number> | null;
  closingOdds: Record<string, number> | null;
  bet: boolean;
  gameDate: string | null;
  score: string | null;
  outcome: 0 | 1 | 2 | null;
  pActual: number | null;
}

export interface PredictionReport {
  logged: number;
  scored: number;
  awaiting: number;
  unscorable: number;
  brier: number | null;
  brierBaseline: number | null;
  logLoss: number | null;
  logLossBaseline: number | null;
  hit: { predicted: number; observed: number } | null;
  buckets: Bucket[];
  market: {
    sample: number;
    modelBrier: number;
    bookBrier: number;
    modelLogLoss: number;
    bookLogLoss: number;
  } | null;
  closing: { sample: number; modelBrier: number; closeBrier: number } | null;
  rows: ScoredPrediction[];
  minSample: number;
}

export function usePredictionReport() {
  const [report, setReport] = useState<PredictionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/metrics/predictions")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load prediction log");
        return (await res.json()) as PredictionReport;
      })
      .then((d) => {
        if (!cancelled) setReport(d);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load prediction log");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { report, error };
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fi-FI") : "";
const f3 = (v: number) => v.toFixed(3);
const OUTCOME = ["1", "X", "2"];
const ROWS_SHOWN = 20;

const Pair: React.FC<{
  label: string;
  a: { name: string; value: number };
  b: { name: string; value: number };
  sub: string;
  muted?: boolean;
  hint?: string;
}> = ({ label, a, b, sub, muted, hint }) => (
  <div className={`stat ${muted ? "muted" : ""}`} title={hint}>
    <div className="stat-label">{label}</div>
    <div className={`stat-value ${a.value < b.value ? "up" : a.value > b.value ? "down" : ""}`}>
      {f3(a.value)} <span className="stat-vs">vs</span> {f3(b.value)}
    </div>
    <div className="stat-sub">
      {a.name} vs {b.name} · {sub}
    </div>
  </div>
);

export const PredictionsPanel: React.FC = () => {
  const { report, error } = usePredictionReport();
  const [showAll, setShowAll] = useState(false);
  if (error) return <p className="error">Error: {error}</p>;
  if (!report) return <p className="chart-empty">Loading...</p>;
  if (report.logged === 0)
    return (
      <div className="chart-card">
        <p className="chart-empty">
          Nothing logged yet. Every 1X2 prediction shown on the league pages
          from now on is recorded here and scored once the game is played.
        </p>
      </div>
    );

  const small = report.scored < report.minSample;
  const rows = showAll ? report.rows : report.rows.slice(0, ROWS_SHOWN);
  const n = report.scored;

  return (
    <div className="chart-card calibration-card">
      <div className="calibration-meta">
        {report.logged} logged · {n} scored · {report.awaiting} awaiting a
        result
        {report.unscorable > 0 && (
          <> · {report.unscorable} without a game history (World Cup)</>
        )}
      </div>
      <div className="calibration-body">
        <div className="calibration-chart-wrap">
          <CalibrationChart buckets={report.buckets} />
          <div className="calibration-caption">
            Same chart as the backtest, over the predictions actually shown.
            The bets' own segment of the model, as it was on the day.
          </div>
        </div>
        <div className="stats">
          {report.brier !== null && report.brierBaseline !== null && (
            <Pair
              label="Brier (1X2)"
              a={{ name: "model", value: report.brier }}
              b={{ name: "league average", value: report.brierBaseline }}
              sub={`n=${n}`}
              muted={small}
              hint={small ? `${n} scored; ${report.minSample} needed before this means much` : undefined}
            />
          )}
          {report.logLoss !== null && report.logLossBaseline !== null && (
            <Pair
              label="Log loss (1X2)"
              a={{ name: "model", value: report.logLoss }}
              b={{ name: "league average", value: report.logLossBaseline }}
              sub={`n=${n}`}
              muted={small}
            />
          )}
          {report.hit && (
            <div className={`stat ${small ? "muted" : ""}`}>
              <div className="stat-label">Favourite hit</div>
              <div className="stat-value">
                {pct(report.hit.predicted)} <span className="stat-vs">vs</span>{" "}
                {pct(report.hit.observed)}
              </div>
              <div className="stat-sub">predicted vs observed · n={n}</div>
            </div>
          )}
          {report.market ? (
            <Pair
              label="Skill vs market"
              a={{ name: "model", value: report.market.modelBrier }}
              b={{ name: "de-vigged book", value: report.market.bookBrier }}
              sub={`Brier on n=${report.market.sample} with book prices`}
              muted={report.market.sample < report.minSample}
              hint="Negative gap = the model is sharper than the book on these games"
            />
          ) : (
            <div className="stat muted">
              <div className="stat-label">Skill vs market</div>
              <div className="stat-value">—</div>
              <div className="stat-sub">
                needs bets with full 1X2 book prices on scored games
              </div>
            </div>
          )}
          {report.closing && (
            <Pair
              label="Model vs close"
              a={{ name: "model", value: report.closing.modelBrier }}
              b={{ name: "closing line", value: report.closing.closeBrier }}
              sub={`Brier on n=${report.closing.sample} with closing prices`}
              muted={report.closing.sample < report.minSample}
            />
          )}
        </div>
      </div>
      <div className="season-table-wrap">
        <table className="season-table predictions-table">
          <thead>
            <tr>
              <th>Shown</th>
              <th>League</th>
              <th>Game</th>
              <th>1</th>
              <th>X</th>
              <th>2</th>
              <th>Book (1 / X / 2)</th>
              <th>Bet</th>
              <th>Result</th>
              <th>p(result)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.outcome === null ? "muted" : ""}>
                <td>{fmtDate(r.at)}</td>
                <td>{r.league.toUpperCase()}</td>
                <td>
                  {r.home} – {r.away}
                </td>
                {r.probs.map((p, i) => (
                  <td key={i} className={r.outcome === i ? "hit" : ""}>
                    {pct(p)}
                  </td>
                ))}
                <td>
                  {r.marketOdds
                    ? `${r.marketOdds.home} / ${r.marketOdds.draw} / ${r.marketOdds.away}`
                    : ""}
                </td>
                <td>{r.bet ? "✓" : ""}</td>
                <td>
                  {r.outcome === null
                    ? "—"
                    : `${OUTCOME[r.outcome]} (${r.score}, ${fmtDate(r.gameDate)})`}
                </td>
                <td>{r.pActual === null ? "" : pct(r.pActual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.rows.length > ROWS_SHOWN && (
        <button
          type="button"
          className="slice-button"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show fewer" : `Show all ${report.rows.length}`}
        </button>
      )}
    </div>
  );
};
