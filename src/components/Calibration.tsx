import React, { useEffect, useState } from "react";
import { LeagueId, LEAGUE_IDS } from "../utils/leagues";
import { pct } from "./metrics";

/** Response of GET /api/metrics/model (see src/data/backtest.ts). */
export interface Bucket {
  lo: number;
  hi: number;
  count: number;
  predicted: number;
  observed: number;
}

export interface Check {
  predicted: number;
  observed: number;
}

export interface Segment {
  label: string;
  n: number;
  from: string;
  to: string;
  brier: number;
  brierBaseline: number;
  logLoss: number;
  logLossBaseline: number;
  outcomes: { home: Check; draw: Check; away: Check };
  buckets: Bucket[];
  bucketsByOutcome: { home: Bucket[]; draw: Bucket[]; away: Bucket[] };
  moneyline: {
    brier: number;
    brierBaseline: number;
    logLoss: number;
    logLossBaseline: number;
    home: Check;
  } | null;
  correctScore: {
    logLoss: number;
    logLossBaseline: number;
    meanProbability: number;
    topScore: Check;
    meanGoals: { home: number; away: number };
  };
}

export interface RollingPoint {
  index: number;
  date: string;
  brier: number;
  brierBaseline: number;
  logLoss: number;
  logLossBaseline: number;
}

export interface Backtest {
  league: LeagueId;
  name: string;
  sport: "hockey" | "soccer";
  market: "regulation" | "fullTime";
  homeAdv: number;
  drawFactor: number;
  games: number;
  overall: Segment;
  seasons: Segment[];
  rolling: { window: number; step: number; points: RollingPoint[] };
  baseline: { home: number; draw: number; away: number };
  skillVsMarket: null;
  computedAt: string;
}

type Loaded =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: Backtest };

/** One backtest per league, fetched in parallel; each card renders on its own. */
export function useBacktests(leagues: LeagueId[] = LEAGUE_IDS) {
  const [state, setState] = useState<Record<string, Loaded>>(() =>
    Object.fromEntries(leagues.map((l) => [l, { status: "loading" }]))
  );

  useEffect(() => {
    let cancelled = false;
    for (const league of leagues) {
      fetch(`/api/metrics/model?league=${league}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to load ${league} backtest`);
          return (await res.json()) as Backtest;
        })
        .then((data) => {
          if (!cancelled)
            setState((s) => ({ ...s, [league]: { status: "ready", data } }));
        })
        .catch((e) => {
          if (!cancelled)
            setState((s) => ({
              ...s,
              [league]: {
                status: "error",
                error: e instanceof Error ? e.message : "Failed to load",
              },
            }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagues.join(",")]);

  return state;
}

const fmtDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("fi-FI") : "";
const f3 = (v: number) => v.toFixed(3);

/** Model score against its baseline; lower is better for both. */
const Score: React.FC<{
  label: string;
  value: number;
  baseline: number;
  hint?: string;
}> = ({ label, value, baseline, hint }) => {
  const better = value < baseline;
  const gain = baseline > 0 ? (baseline - value) / baseline : 0;
  return (
    <div className="stat" title={hint}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${better ? "up" : "down"}`}>{f3(value)}</div>
      <div className="stat-sub">
        baseline {f3(baseline)} · {better ? "" : "−"}
        {pct(Math.abs(gain))} {better ? "better" : "worse"}
      </div>
    </div>
  );
};

/** Predicted share against observed share of an outcome. */
const Rate: React.FC<{ label: string; check: Check; hint?: string }> = ({
  label,
  check,
  hint,
}) => {
  const gap = check.predicted - check.observed;
  return (
    <div className="stat" title={hint}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {pct(check.predicted)} <span className="stat-vs">vs</span>{" "}
        {pct(check.observed)}
      </div>
      <div className="stat-sub">
        predicted vs observed ·{" "}
        {Math.abs(gap) < 0.01
          ? "in line"
          : `${pct(Math.abs(gap))} ${gap > 0 ? "over" : "under"}`}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Calibration chart: predicted (x) vs observed (y) per bucket, with the
// bucket sizes as bars underneath.
// ---------------------------------------------------------------------------

const CW = 300;
const PLOT = 220;
const BARS = 56;
const CPAD = { left: 40, right: 12, top: 10, gap: 8, bottom: 22 };
const CH = CPAD.top + PLOT + CPAD.gap + BARS + CPAD.bottom;

export const CalibrationChart: React.FC<{ buckets: Bucket[] }> = ({
  buckets,
}) => {
  const innerW = CW - CPAD.left - CPAD.right;
  const x = (p: number) => CPAD.left + innerW * p;
  const y = (p: number) => CPAD.top + PLOT * (1 - p);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const barTop = CPAD.top + PLOT + CPAD.gap;
  const filled = buckets.filter((b) => b.count > 0);
  const line = filled
    .map((b, i) => `${i ? "L" : "M"}${x(b.predicted)},${y(b.observed)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${CW} ${CH}`}
      className="calibration-chart"
      role="img"
      aria-label="Predicted probability against observed frequency"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={x(0)} x2={x(1)} y1={y(v)} y2={y(v)} className="grid" />
          <line x1={x(v)} x2={x(v)} y1={y(0)} y2={y(1)} className="grid" />
          <text x={x(0) - 5} y={y(v) + 3} className="tick" textAnchor="end">
            {Math.round(v * 100)}%
          </text>
          <text
            x={x(v)}
            y={CH - 6}
            className="tick"
            textAnchor={v === 0 ? "start" : v === 1 ? "end" : "middle"}
          >
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="diagonal" />
      {filled.length > 1 && <path d={line} className="line" />}
      {filled.map((b) => (
        <circle
          key={b.lo}
          cx={x(b.predicted)}
          cy={y(b.observed)}
          r={3.5}
          className="dot"
        >
          <title>
            {`${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%: predicted ${pct(
              b.predicted
            )}, observed ${pct(b.observed)}, n=${b.count}`}
          </title>
        </circle>
      ))}
      {buckets.map((b) => {
        const h = (BARS * b.count) / maxCount;
        return (
          <rect
            key={b.lo}
            x={x(b.lo) + 1}
            y={barTop + BARS - h}
            width={innerW / buckets.length - 2}
            height={h}
            className="bar"
          >
            <title>{`${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%: ${b.count} predictions`}</title>
          </rect>
        );
      })}
      <text
        x={CPAD.left - 5}
        y={barTop + BARS - 2}
        className="tick"
        textAnchor="end"
      >
        n
      </text>
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Rolling Brier: model against the baseline over the last `window` games,
// one point per `step` games, so a drift stands out.
// ---------------------------------------------------------------------------

const RW = 640;
const RH = 180;
const RPAD = { left: 48, right: 14, top: 10, bottom: 26 };

export const RollingChart: React.FC<{
  points: RollingPoint[];
  window: number;
}> = ({ points, window }) => {
  if (points.length < 2) {
    return (
      <p className="chart-empty">
        Rolling window needs at least {window} games.
      </p>
    );
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    lo = Math.min(lo, p.brier, p.brierBaseline);
    hi = Math.max(hi, p.brier, p.brierBaseline);
  }
  lo = Math.floor(lo * 20) / 20;
  hi = Math.ceil(hi * 20) / 20;
  if (hi === lo) hi = lo + 0.05;
  const innerW = RW - RPAD.left - RPAD.right;
  const innerH = RH - RPAD.top - RPAD.bottom;
  const first = points[0].index;
  const last = points[points.length - 1].index;
  const x = (i: number) =>
    RPAD.left + (innerW * (i - first)) / Math.max(last - first, 1);
  const y = (v: number) => RPAD.top + innerH * (1 - (v - lo) / (hi - lo));
  const path = (pick: (p: RollingPoint) => number) =>
    points.map((p, i) => `${i ? "L" : "M"}${x(p.index)},${y(pick(p))}`).join(" ");
  const yTicks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += 0.05) yTicks.push(Math.round(v * 100) / 100);
  const xTicks = points.filter(
    (_, i) => i % Math.max(1, Math.ceil(points.length / 6)) === 0
  );

  return (
    <svg
      viewBox={`0 0 ${RW} ${RH}`}
      className="rolling-chart"
      role="img"
      aria-label={`Brier score over the last ${window} games`}
    >
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={RPAD.left} x2={RW - RPAD.right} y1={y(v)} y2={y(v)} className="grid" />
          <text x={RPAD.left - 6} y={y(v) + 3} className="tick" textAnchor="end">
            {v.toFixed(2)}
          </text>
        </g>
      ))}
      {xTicks.map((p) => (
        <text
          key={p.index}
          x={x(p.index)}
          y={RH - RPAD.bottom + 16}
          className="tick"
          textAnchor="middle"
        >
          {fmtDate(p.date)}
        </text>
      ))}
      <path d={path((p) => p.brierBaseline)} className="line baseline" />
      <path d={path((p) => p.brier)} className="line model" />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// One league's card.
// ---------------------------------------------------------------------------

type OutcomeKey = "all" | "home" | "draw" | "away";

const LeagueCalibration: React.FC<{ bt: Backtest }> = ({ bt }) => {
  const [segmentIndex, setSegmentIndex] = useState(-1); // -1 = overall
  const [outcome, setOutcome] = useState<OutcomeKey>("all");
  const seg = segmentIndex < 0 ? bt.overall : bt.seasons[segmentIndex];
  const buckets = outcome === "all" ? seg.buckets : seg.bucketsByOutcome[outcome];
  const marketLabel =
    bt.market === "regulation" ? "60-minute 1X2" : "full-time 1X2";
  const drawLabel = bt.sport === "hockey" ? "Draw rate (OT/SO)" : "Draw rate";

  return (
    <div className="chart-card calibration-card">
      <div className="calibration-head">
        <div>
          <h3 className="calibration-title">{bt.name}</h3>
          <div className="calibration-meta">
            {marketLabel} · {bt.games} games · {fmtDate(bt.overall.from)} –{" "}
            {fmtDate(bt.overall.to)} · draw factor {bt.drawFactor.toFixed(2)} ·
            home advantage {bt.homeAdv}
          </div>
        </div>
        <div className="calibration-controls">
          <select
            className="kelly-select"
            value={segmentIndex}
            onChange={(e) => setSegmentIndex(Number(e.target.value))}
            aria-label="Season"
          >
            <option value={-1}>All seasons ({bt.overall.n})</option>
            {bt.seasons.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label} ({s.n})
              </option>
            ))}
          </select>
          <select
            className="kelly-select"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as OutcomeKey)}
            aria-label="Outcome"
          >
            <option value="all">All outcomes</option>
            <option value="home">Home win</option>
            <option value="draw">Draw</option>
            <option value="away">Away win</option>
          </select>
        </div>
      </div>

      <div className="calibration-body">
        <div className="calibration-chart-wrap">
          <CalibrationChart buckets={buckets} />
          <div className="calibration-caption">
            Predicted probability (x) against how often it happened (y).
            Points above the diagonal: the model is underconfident there;
            below: overconfident. Bars show how many predictions fall in
            each bucket.
          </div>
        </div>
        <div className="stats">
          <Score
            label="Brier (1X2)"
            value={seg.brier}
            baseline={seg.brierBaseline}
            hint="Mean squared error over the three outcomes; baseline = always the league's outcome frequencies"
          />
          <Score
            label="Log loss (1X2)"
            value={seg.logLoss}
            baseline={seg.logLossBaseline}
            hint="−mean log p(actual outcome); the score Kelly growth depends on"
          />
          <Rate label={drawLabel} check={seg.outcomes.draw} />
          <Rate label="Home win rate" check={seg.outcomes.home} />
          <Rate label="Away win rate" check={seg.outcomes.away} />
          {seg.moneyline && (
            <Score
              label="Brier (moneyline)"
              value={seg.moneyline.brier}
              baseline={seg.moneyline.brierBaseline}
              hint="Two-way market including OT/SO"
            />
          )}
          <Score
            label="Log loss (correct score)"
            value={seg.correctScore.logLoss}
            baseline={seg.correctScore.logLossBaseline}
            hint={`Poisson layer; baseline = independent Poisson at the league's mean goals (${bt.overall.correctScore.meanGoals.home.toFixed(2)} home, ${bt.overall.correctScore.meanGoals.away.toFixed(2)} away)`}
          />
          <Rate
            label="Top score hit"
            check={seg.correctScore.topScore}
            hint="How often the model's most likely score happened, against what it thought"
          />
          <div className="stat muted" title="Needs bookmaker odds for played games (step 7)">
            <div className="stat-label">Skill vs market</div>
            <div className="stat-value">—</div>
            <div className="stat-sub">needs stored odds (step 7)</div>
          </div>
        </div>
      </div>

      <div className="season-table-wrap">
        <table className="season-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Games</th>
              <th>Brier</th>
              <th>Baseline</th>
              <th>Log loss</th>
              <th>Baseline</th>
              <th>Draw pred / obs</th>
              <th>Home pred / obs</th>
              <th>Score log loss</th>
            </tr>
          </thead>
          <tbody>
            {[...bt.seasons, bt.overall].map((s) => (
              <tr key={s.label} className={s === bt.overall ? "total" : ""}>
                <td>{s.label}</td>
                <td>{s.n}</td>
                <td className={s.brier < s.brierBaseline ? "up" : "down"}>
                  {f3(s.brier)}
                </td>
                <td>{f3(s.brierBaseline)}</td>
                <td className={s.logLoss < s.logLossBaseline ? "up" : "down"}>
                  {f3(s.logLoss)}
                </td>
                <td>{f3(s.logLossBaseline)}</td>
                <td>
                  {pct(s.outcomes.draw.predicted)} / {pct(s.outcomes.draw.observed)}
                </td>
                <td>
                  {pct(s.outcomes.home.predicted)} / {pct(s.outcomes.home.observed)}
                </td>
                <td
                  className={
                    s.correctScore.logLoss < s.correctScore.logLossBaseline
                      ? "up"
                      : "down"
                  }
                >
                  {f3(s.correctScore.logLoss)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="chart-legend rolling-legend">
        <span className="legend-item">
          <i className="swatch model" /> model Brier, last {bt.rolling.window}{" "}
          games
        </span>
        <span className="legend-item">
          <i className="swatch baseline" /> baseline
        </span>
      </div>
      <RollingChart points={bt.rolling.points} window={bt.rolling.window} />
    </div>
  );
};

/** Dashboard panel: one calibration card per game-history league. */
export const CalibrationPanel: React.FC = () => {
  const backtests = useBacktests();
  return (
    <div className="calibration-panel">
      {LEAGUE_IDS.map((league) => {
        const item = backtests[league];
        if (!item || item.status === "loading")
          return (
            <div key={league} className="chart-card">
              <p className="chart-empty">Loading {league.toUpperCase()} backtest…</p>
            </div>
          );
        if (item.status === "error")
          return (
            <div key={league} className="chart-card">
              <p className="error">Error: {item.error}</p>
            </div>
          );
        return <LeagueCalibration key={league} bt={item.data} />;
      })}
    </div>
  );
};
