import React, { useCallback, useEffect, useState } from "react";
import { eur, pct } from "./metrics";

/** Response of GET /api/bankroll (see src/data/bankroll.ts). */
export interface Movement {
  at: string;
  amount: number;
  note: string | null;
}

export interface Bankroll {
  tracked: boolean;
  start: number | null;
  startedAt: string | null;
  kellyDivider: number;
  dailyExposureLimit: number;
  movements: Movement[];
  deposits: number;
  withdrawals: number;
  settledProfit: number;
  settledBets: number;
  current: number | null;
  openStake: number;
}

/** What the bet forms need to show a Kelly stake next to the stake input. */
export interface KellySettings {
  bankroll: number;
  divider: number;
}

export function useBankroll() {
  const [bankroll, setBankroll] = useState<Bankroll | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/bankroll");
      if (!res.ok) throw new Error("Failed to load bankroll");
      setBankroll(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bankroll");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const kelly: KellySettings | null =
    bankroll?.current && bankroll.current > 0
      ? { bankroll: bankroll.current, divider: bankroll.kellyDivider }
      : null;

  return { bankroll, kelly, error, refresh, setBankroll };
}

/** "Kelly", "½ Kelly", "¼ Kelly", "1/5 Kelly". */
export function kellyLabel(divider: number): string {
  if (divider === 1) return "Kelly";
  if (divider === 2) return "½ Kelly";
  if (divider === 4) return "¼ Kelly";
  return `1/${divider} Kelly`;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fi-FI") : "";
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Bankroll panel: starting amount and settings, deposits and withdrawals.
// ---------------------------------------------------------------------------

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as Bankroll;
}

const SettingsForm: React.FC<{
  bankroll: Bankroll;
  onSaved: (b: Bankroll) => void;
  onCancel?: () => void;
}> = ({ bankroll, onSaved, onCancel }) => {
  const [start, setStart] = useState(bankroll.start?.toString() ?? "");
  const [startedAt, setStartedAt] = useState(bankroll.startedAt ?? today());
  const [divider, setDivider] = useState(String(bankroll.kellyDivider));
  const [limit, setLimit] = useState(
    String(Math.round(bankroll.dailyExposureLimit * 100))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await post("/api/bankroll", {
          start: Number(start),
          startedAt,
          kellyDivider: Number(divider),
          dailyExposureLimit: Number(limit) / 100,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="bankroll-form" onSubmit={submit}>
      <label className="stake-field">
        <span>Bankroll (€)</span>
        <input
          type="number"
          min="0"
          step="1"
          inputMode="decimal"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="stake-input"
          required
        />
      </label>
      <label className="stake-field">
        <span>As of</span>
        <input
          type="date"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
          className="stake-input"
          required
        />
      </label>
      <label className="stake-field">
        <span>Kelly divider</span>
        <input
          type="number"
          min="1"
          max="20"
          step="1"
          value={divider}
          onChange={(e) => setDivider(e.target.value)}
          className="stake-input"
          required
        />
      </label>
      <label className="stake-field">
        <span>Daily exposure limit (%)</span>
        <input
          type="number"
          min="1"
          max="100"
          step="1"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="stake-input"
          required
        />
      </label>
      <button type="submit" className="bet-button" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      {onCancel && (
        <button type="button" className="slice-button" onClick={onCancel}>
          Cancel
        </button>
      )}
      {error && <span className="error">{error}</span>}
    </form>
  );
};

const MovementForm: React.FC<{ onSaved: (b: Bankroll) => void }> = ({
  onSaved,
}) => {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (sign: 1 | -1) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await post("/api/bankroll/movement", {
          amount: sign * Math.abs(Number(amount)),
          note: note || undefined,
        })
      );
      setAmount("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const valid = Number(amount) > 0;
  return (
    <div className="bankroll-form">
      <label className="stake-field">
        <span>Amount (€)</span>
        <input
          type="number"
          min="0.01"
          step="1"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="stake-input"
        />
      </label>
      <label className="stake-field">
        <span>Note</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="stake-input book-name-input"
          placeholder="optional"
        />
      </label>
      <button
        type="button"
        className="bet-button"
        disabled={busy || !valid}
        onClick={() => submit(1)}
      >
        Deposit
      </button>
      <button
        type="button"
        className="bet-button"
        disabled={busy || !valid}
        onClick={() => submit(-1)}
      >
        Withdraw
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
};

export const BankrollPanel: React.FC<{
  bankroll: Bankroll | null;
  error: string | null;
  onChange: (b: Bankroll) => void;
}> = ({ bankroll, error, onChange }) => {
  const [editing, setEditing] = useState(false);

  if (error) return <p className="error">Error: {error}</p>;
  if (!bankroll) return <p className="chart-empty">Loading...</p>;

  if (!bankroll.tracked || editing) {
    return (
      <div className="chart-card">
        <p className="calibration-caption">
          {bankroll.tracked
            ? "Change the starting amount, its date, or the staking settings."
            : "Enter the bankroll as it stands today. Profit from bets settled after this date is added to it; deposits and withdrawals go in below."}
        </p>
        <SettingsForm
          bankroll={bankroll}
          onSaved={(b) => {
            onChange(b);
            setEditing(false);
          }}
          onCancel={bankroll.tracked ? () => setEditing(false) : undefined}
        />
      </div>
    );
  }

  const remove = async (index: number) => {
    try {
      onChange(await post(`/api/bankroll/movement/${index}`, undefined, "DELETE"));
    } catch {
      // the list stays as it was
    }
  };

  return (
    <div className="chart-card">
      <div className="tiles bankroll-tiles">
        <div className="tile">
          <div className="tile-label">Bankroll now</div>
          <div className="tile-value">{eur(bankroll.current ?? 0)}</div>
          <div className="tile-sub">
            {eur(bankroll.openStake)} of it open in pending bets
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Start</div>
          <div className="tile-value">{eur(bankroll.start ?? 0)}</div>
          <div className="tile-sub">as of {fmtDate(bankroll.startedAt)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Movements</div>
          <div className="tile-value">
            {eur(bankroll.deposits - bankroll.withdrawals, true)}
          </div>
          <div className="tile-sub">
            {eur(bankroll.deposits)} in · {eur(bankroll.withdrawals)} out
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Settled since start</div>
          <div
            className={`tile-value ${
              bankroll.settledProfit > 0 ? "up" : bankroll.settledProfit < 0 ? "down" : ""
            }`}
          >
            {eur(bankroll.settledProfit, true)}
          </div>
          <div className="tile-sub">{bankroll.settledBets} bets</div>
        </div>
        <div className="tile">
          <div className="tile-label">Staking</div>
          <div className="tile-value">{kellyLabel(bankroll.kellyDivider)}</div>
          <div className="tile-sub">
            warn above {pct(bankroll.dailyExposureLimit)} open per day ·{" "}
            <button
              type="button"
              className="link-button"
              onClick={() => setEditing(true)}
            >
              edit
            </button>
          </div>
        </div>
      </div>
      <MovementForm onSaved={onChange} />
      {bankroll.movements.length > 0 && (
        <div className="season-table-wrap">
          <table className="season-table movements-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bankroll.movements.map((m, i) => (
                <tr key={`${m.at}-${i}`}>
                  <td>{fmtDate(m.at)}</td>
                  <td className={m.amount > 0 ? "up" : "down"}>
                    {eur(m.amount, true)}
                  </td>
                  <td>{m.note ?? ""}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => remove(i)}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Staking: open positions and the stake / Kelly-stake scatter.
// ---------------------------------------------------------------------------

/** Response of GET /api/metrics/staking (see src/data/metrics.ts). */
export interface StakingBet {
  id: string;
  positionId: string;
  placedAt: string | null;
  league: string | null;
  market: string;
  home: string;
  away: string;
  gameDate: string | null;
  pick: string;
  stake: number;
  oddsTaken: number;
  probability: number;
  edge: number;
  kellyFraction: number;
  bankroll: number | null;
  bankrollAssumed: boolean;
  kellyDivider: number;
  kellyStake: number | null;
  ratio: number | null;
  bankrollFraction: number | null;
  status: "pending" | "win" | "loss" | "void";
  noPrice: boolean;
}

export interface Staking {
  bankroll: number | null;
  kellyDivider: number;
  dailyExposureLimit: number;
  bets: StakingBet[];
  summary: {
    withRatio: number;
    meanRatio: number | null;
    medianRatio: number | null;
    overKelly: number;
    noEdge: number;
    noPrice: number;
    assumed: number;
  };
  open: {
    bets: number;
    stake: number;
    expectedProfit: number;
    fraction: number | null;
    byDay: {
      date: string;
      stake: number;
      fraction: number | null;
      bets: number;
      positions: number;
      overLimit: boolean;
    }[];
    byPosition: {
      positionId: string;
      league: string | null;
      home: string;
      away: string;
      gameDate: string | null;
      market: string;
      lines: number;
      stake: number;
      fraction: number | null;
      expectedProfit: number;
      picks: string[];
    }[];
  };
}

export function useStaking(version: unknown) {
  const [staking, setStaking] = useState<Staking | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/metrics/staking")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load staking");
        return (await res.json()) as Staking;
      })
      .then((d) => {
        if (!cancelled) {
          setStaking(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load staking");
      });
    return () => {
      cancelled = true;
    };
  }, [version]);
  return { staking, error };
}

const MARKET_SHORT: Record<string, string> = {
  regulation: "60-min 1X2",
  moneyline: "Moneyline",
  fullTime: "Full-time 1X2",
  correctScore: "Correct score",
  mixed: "Mixed",
};

export const OpenPositions: React.FC<{ staking: Staking }> = ({ staking }) => {
  const { open, bankroll } = staking;
  if (open.bets === 0) return <p className="chart-empty">No pending bets.</p>;
  const warnDays = open.byDay.filter((d) => d.overLimit);
  return (
    <div className="chart-card">
      <div className="calibration-meta">
        {open.bets} pending bets · {eur(open.stake)} open
        {open.fraction !== null && <> · {pct(open.fraction)} of bankroll</>} ·
        model expects {eur(open.expectedProfit, true)}
      </div>
      {warnDays.map((d) => (
        <p key={d.date} className="exposure-warning">
          ⚠ {eur(d.stake)} open on {fmtDate(d.date)} is{" "}
          {pct(d.fraction ?? 0)} of the bankroll, above the{" "}
          {pct(staking.dailyExposureLimit)} limit.
        </p>
      ))}
      <div className="season-table-wrap">
        <table className="season-table positions-table">
          <thead>
            <tr>
              <th>Game</th>
              <th>Date</th>
              <th>Market</th>
              <th>Picks</th>
              <th>Lines</th>
              <th>Stake</th>
              <th>% bankroll</th>
              <th>Model edge</th>
            </tr>
          </thead>
          <tbody>
            {open.byPosition.map((p) => (
              <tr key={p.positionId}>
                <td>
                  {p.home} – {p.away}
                  {p.league && <span className="stat-vs"> {p.league.toUpperCase()}</span>}
                </td>
                <td>{fmtDate(p.gameDate)}</td>
                <td>{MARKET_SHORT[p.market] ?? p.market}</td>
                <td>{p.picks.join(", ")}</td>
                <td>{p.lines}</td>
                <td>{eur(p.stake)}</td>
                <td>{p.fraction === null ? "—" : pct(p.fraction)}</td>
                <td className={p.expectedProfit > 0 ? "up" : p.expectedProfit < 0 ? "down" : ""}>
                  {eur(p.expectedProfit, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bankroll === null && (
        <p className="calibration-caption">
          Set the bankroll above to see exposure as a share of it.
        </p>
      )}
    </div>
  );
};

const SW = 640;
const SH = 220;
const SPAD = { left: 44, right: 14, top: 12, bottom: 28 };
const RATIO_CAP = 5;

export const StakingChart: React.FC<{ staking: Staking }> = ({ staking }) => {
  const bets = staking.bets.filter((b) => b.ratio !== null);
  if (bets.length === 0) {
    return (
      <p className="chart-empty">
        {staking.bankroll === null
          ? "Set the bankroll to compare stakes with the Kelly stake."
          : "No bets with a model edge yet."}
      </p>
    );
  }
  const n = bets.length;
  const hi = Math.min(
    RATIO_CAP,
    Math.max(1.5, Math.ceil(Math.max(...bets.map((b) => b.ratio ?? 0)) * 2) / 2)
  );
  const innerW = SW - SPAD.left - SPAD.right;
  const innerH = SH - SPAD.top - SPAD.bottom;
  const x = (i: number) => SPAD.left + (innerW * (i + 0.5)) / n;
  const y = (v: number) => SPAD.top + innerH * (1 - Math.min(v, hi) / hi);
  const yTicks: number[] = [];
  for (let v = 0; v <= hi + 1e-9; v += hi > 3 ? 1 : 0.5) yTicks.push(v);
  const s = staking.summary;

  return (
    <div className="chart-card">
      <div className="chart-legend">
        <span className="legend-item">
          <i className="swatch dot-win" /> won
        </span>
        <span className="legend-item">
          <i className="swatch dot-loss" /> lost
        </span>
        <span className="legend-item">
          <i className="swatch dot-pending" /> pending / void
        </span>
        <span className="legend-range">
          median {s.medianRatio?.toFixed(2)}× · {s.overKelly} of {s.withRatio}{" "}
          above {kellyLabel(staking.kellyDivider)}
          {s.noEdge > 0 && <> · {s.noEdge} with no edge (not shown)</>}
          {s.noPrice > 0 && <> · {s.noPrice} saved at model odds (not shown)</>}
          {s.assumed > 0 && <> · {s.assumed} measured against today's bankroll</>}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${SW} ${SH}`}
        className="staking-chart"
        role="img"
        aria-label="Stake divided by Kelly stake, per bet"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={SPAD.left}
              x2={SW - SPAD.right}
              y1={y(v)}
              y2={y(v)}
              className={v === 1 ? "grid one" : "grid"}
            />
            <text x={SPAD.left - 6} y={y(v) + 3} className="tick" textAnchor="end">
              {v}×
            </text>
          </g>
        ))}
        <text x={SW - SPAD.right} y={SH - 4} className="tick" textAnchor="end">
          bets in order placed
        </text>
        {bets.map((b, i) => (
          <circle
            key={b.id}
            cx={x(i)}
            cy={y(b.ratio ?? 0)}
            r={b.bankrollAssumed ? 3 : 4}
            className={`dot ${b.status} ${(b.ratio ?? 0) > hi ? "capped" : ""}`}
          >
            <title>
              {`${b.home}–${b.away} ${b.pick} @ ${b.oddsTaken}: stake ${eur(b.stake)}, ${kellyLabel(
                b.kellyDivider
              )} ${eur(b.kellyStake ?? 0)} (${(b.ratio ?? 0).toFixed(2)}×)${
                b.bankrollAssumed ? ", against today's bankroll" : ""
              }`}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
};
