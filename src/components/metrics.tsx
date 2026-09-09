import React, { useCallback, useEffect, useState } from "react";

/** Response of GET /api/metrics/summary (see src/data/metrics.ts). */
export interface SeriesPoint {
  id: string;
  at: string | null;
  actual: number;
  expected: number;
  sigma: number;
}

export interface Summary {
  counts: { settled: number; pending: number; voided: number; wins: number };
  turnover: number;
  profit: number;
  yield: number | null;
  expectedProfit: number;
  expectedYield: number | null;
  hitRate: number | null;
  expectedHitRate: number | null;
  zScore: number | null;
  sigma: number;
  market: {
    sample: number;
    turnover: number;
    actual: number;
    modelExpected: number;
    expectedProfit: number;
  };
  clv: { sample: number; mean: number | null; beatCloseShare: number | null };
  maxDrawdown: {
    amount: number;
    from: number;
    to: number;
    percentOfBankroll: number | null;
  };
  pending: { stake: number; expectedProfit: number };
  bankroll: number | null;
  series: SeriesPoint[];
  minSample: number;
}

export function useSummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics/summary");
      if (!res.ok) throw new Error("Failed to load metrics");
      setSummary(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { summary, error, refresh };
}

export const eur = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : ""}${n.toFixed(2)}€`;
export const pct = (x: number, signed = false) =>
  `${signed && x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

const toneOf = (n: number | null): "" | "up" | "down" =>
  n === null || n === 0 ? "" : n > 0 ? "up" : "down";

const Tile: React.FC<{
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "" | "up" | "down";
  muted?: boolean;
  hint?: string;
}> = ({ label, value, sub, tone = "", muted = false, hint }) => (
  <div className={`tile ${muted ? "muted" : ""}`} title={hint}>
    <div className="tile-label">{label}</div>
    <div className={`tile-value ${tone}`}>{value}</div>
    {sub && <div className="tile-sub">{sub}</div>}
  </div>
);

/**
 * Headline figures. Tiles that depend on the settled sample are muted while
 * it is below `minSample`; tiles whose input is not recorded yet say so.
 */
export const HeadlineTiles: React.FC<{ summary: Summary }> = ({ summary }) => {
  const s = summary;
  const n = s.counts.settled;
  const small = n < s.minSample;
  const sizeHint = small
    ? `${n} settled bets; ${s.minSample} needed before this means much`
    : `${n} settled bets`;
  const settledNote = `n=${n}`;

  return (
    <div className="tiles">
      <Tile
        label="Bankroll"
        value={s.bankroll === null ? "—" : eur(s.bankroll)}
        sub={s.bankroll === null ? "not tracked yet" : undefined}
        muted={s.bankroll === null}
        hint="Set up in step 6 of the metrics plan"
      />
      <Tile
        label="Yield"
        value={s.yield === null ? "—" : pct(s.yield, true)}
        tone={toneOf(s.yield)}
        sub={
          <>
            {eur(s.profit, true)} on {eur(s.turnover)} · {settledNote}
            {s.expectedYield !== null && (
              <> · model expected {pct(s.expectedYield, true)}</>
            )}
          </>
        }
        muted={small}
        hint={sizeHint}
      />
      <Tile
        label="Profit vs expected"
        value={
          n === 0
            ? "—"
            : `${eur(s.profit, true)} / ${eur(s.expectedProfit, true)}`
        }
        tone={toneOf(n === 0 ? null : s.profit - s.expectedProfit)}
        sub={
          s.zScore === null ? (
            settledNote
          ) : (
            <>
              z = {s.zScore.toFixed(2)} (σ {eur(s.sigma)}) ·{" "}
              {Math.abs(s.zScore) < 2 ? "within luck" : "beyond luck"}
            </>
          )
        }
        muted={small}
        hint={sizeHint}
      />
      <Tile
        label="Hit rate"
        value={s.hitRate === null ? "—" : pct(s.hitRate)}
        sub={
          s.expectedHitRate === null ? (
            settledNote
          ) : (
            <>
              model expected {pct(s.expectedHitRate)} · {s.counts.wins} of {n}
            </>
          )
        }
        muted={small}
        hint={sizeHint}
      />
      <Tile
        label="Book's view"
        value={s.market.sample === 0 ? "—" : eur(s.market.expectedProfit, true)}
        tone={toneOf(s.market.sample === 0 ? null : s.market.expectedProfit)}
        sub={
          s.market.sample === 0 ? (
            "no bets with full book prices yet"
          ) : (
            <>
              de-vigged expectation on n={s.market.sample} · actual{" "}
              {eur(s.market.actual, true)} · model{" "}
              {eur(s.market.modelExpected, true)}
            </>
          )
        }
        muted={s.market.sample < s.minSample}
        hint="Bets whose bookmaker prices cover every outcome of the market"
      />
      <Tile
        label="CLV"
        value={s.clv.mean === null ? "—" : pct(s.clv.mean, true)}
        tone={toneOf(s.clv.mean)}
        sub={
          s.clv.mean === null ? (
            "needs closing odds (step 7)"
          ) : (
            <>
              beat the close {pct(s.clv.beatCloseShare ?? 0)} · n=
              {s.clv.sample}
            </>
          )
        }
        muted={s.clv.sample < s.minSample}
        hint="Mean of odds taken / closing odds − 1"
      />
      <Tile
        label="Max drawdown"
        value={n === 0 ? "—" : eur(-s.maxDrawdown.amount)}
        tone={s.maxDrawdown.amount > 0 ? "down" : ""}
        sub={
          s.maxDrawdown.amount > 0 ? (
            <>
              bets {s.maxDrawdown.from + 1}→{s.maxDrawdown.to + 1}
              {s.maxDrawdown.percentOfBankroll !== null && (
                <> · {pct(s.maxDrawdown.percentOfBankroll)} of bankroll</>
              )}
            </>
          ) : (
            settledNote
          )
        }
        muted={small}
        hint={sizeHint}
      />
      <Tile
        label="Bets"
        value={`${n} settled`}
        sub={
          <>
            {s.counts.pending} pending ({eur(s.pending.stake)}, model expects{" "}
            {eur(s.pending.expectedProfit, true)})
            {s.counts.voided > 0 && <> · {s.counts.voided} void</>}
          </>
        }
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Cumulative profit chart: actual line, model-expected line with a ±1σ band.
// Plain SVG; one point per settled bet in settlement order.
// ---------------------------------------------------------------------------

const W = 640;
const H = 260;
const PAD = { left: 52, right: 14, top: 14, bottom: 30 };

/** Round tick step: 1, 2, 5 × 10^k so that about `count` ticks fit. */
function tickStep(range: number, count: number): number {
  const raw = range / Math.max(count, 1);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fi-FI") : "";

export const ProfitChart: React.FC<{ series: SeriesPoint[] }> = ({
  series,
}) => {
  if (series.length === 0) {
    return <p className="chart-empty">No settled bets yet.</p>;
  }
  // Index 0 is the start (nothing settled, profit 0).
  const points = [{ actual: 0, expected: 0, sigma: 0 }, ...series];
  const n = points.length - 1;
  let lo = 0;
  let hi = 0;
  for (const p of points) {
    lo = Math.min(lo, p.actual, p.expected - p.sigma);
    hi = Math.max(hi, p.actual, p.expected + p.sigma);
  }
  if (hi === lo) hi = lo + 1;
  const step = tickStep(hi - lo, 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (innerW * i) / Math.max(n, 1);
  const y = (v: number) => PAD.top + innerH * (1 - (v - lo) / (hi - lo));
  const path = (pick: (p: (typeof points)[number]) => number) =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(pick(p))}`).join(" ");

  const band =
    points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.expected + p.sigma)}`).join(" ") +
    " " +
    [...points]
      .reverse()
      .map((p, j) => `L${x(n - j)},${y(p.expected - p.sigma)}`)
      .join(" ") +
    " Z";

  const yTicks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) yTicks.push(round(v));
  const xStep = Math.max(1, Math.ceil(n / 8));
  const xTicks: number[] = [];
  for (let i = 0; i <= n; i += xStep) xTicks.push(i);
  if (xTicks[xTicks.length - 1] !== n) xTicks.push(n);

  const last = series[series.length - 1];
  const first = series[0];

  return (
    <div className="chart-card">
      <div className="chart-legend">
        <span className="legend-item">
          <i className="swatch actual" /> actual {eur(last.actual, true)}
        </span>
        <span className="legend-item">
          <i className="swatch expected" /> model expected{" "}
          {eur(last.expected, true)}
        </span>
        <span className="legend-item">
          <i className="swatch band" /> ±1σ ({eur(last.sigma)})
        </span>
        <span className="legend-range">
          {fmtDate(first.at)}
          {first.at !== last.at && <> – {fmtDate(last.at)}</>}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="profit-chart"
        role="img"
        aria-label="Cumulative profit per settled bet"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className={v === 0 ? "grid zero" : "grid"}
            />
            <text x={PAD.left - 6} y={y(v) + 3} className="tick" textAnchor="end">
              {v}€
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - PAD.bottom + 16}
            className="tick"
            textAnchor="middle"
          >
            {i}
          </text>
        ))}
        <text
          x={W - PAD.right}
          y={H - 4}
          className="tick"
          textAnchor="end"
        >
          settled bets
        </text>
        <path d={band} className="band" />
        <path d={path((p) => p.expected)} className="line expected" />
        <path d={path((p) => p.actual)} className="line actual" />
        <circle cx={x(n)} cy={y(last.actual)} r={3} className="dot actual" />
      </svg>
    </div>
  );
};

const round = (v: number) => Math.round(v * 100) / 100;
