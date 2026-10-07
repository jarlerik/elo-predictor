import React, { useCallback, useEffect, useState } from "react";
import { MARKET_SIDES, fairProbability } from "../utils/sharp";

/** One bet line from data/ledger.jsonl (see src/data/ledger.ts). */
export interface LedgerRow {
  id: string;
  positionId: string;
  placedAt: string | null;
  league: string | null;
  game: { home: string; away: string; key: string; date: string | null };
  market: "regulation" | "moneyline" | "fullTime" | "correctScore";
  pick: string;
  stake: number;
  oddsTaken: number;
  probability: number;
  closingOdds: number | null;
  /** Sharp reference prices at bet time and at the close (see src/data/ledger.ts). */
  sharpOdds?: Record<string, number> | null;
  sharpSource?: string | null;
  sharpClosingOdds?: Record<string, number> | null;
  settledAt: string | null;
  result: "win" | "loss" | "void" | null;
  return: number | null;
  flags: string[];
}

export type SettleResult = "win" | "loss" | "void";

/** Ledger id of a line in a bet file: "<file stem>#<index>". */
export const ledgerId = (filename: string, index: number) =>
  `${filename.replace(/\.json$/, "")}#${index}`;

/** Ledger rows keyed by id, with settle helpers. */
export function useLedger() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/ledger");
      if (!res.ok) throw new Error("Failed to load ledger");
      setRows(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ledger");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const byId = new Map(rows.map((r) => [r.id, r]));

  const settle = useCallback(
    async (
      ids: string[],
      result: SettleResult,
      extra: { return?: number; finalScore?: string } = {}
    ) => {
      const res = await fetch("/api/ledger/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, result, ...extra }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to settle");
      }
      await refresh();
    },
    [refresh]
  );

  /** Closing odds of one line (null clears it). */
  const setClosingOdds = useCallback(
    async (id: string, closingOdds: number | null) => {
      const res = await fetch("/api/ledger/closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, closingOdds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save closing odds");
      }
      await refresh();
    },
    [refresh]
  );

  /** Sharp closing prices of one line, every side of its market (null clears). */
  const setSharpClosing = useCallback(
    async (id: string, sharpClosingOdds: Record<string, number> | null) => {
      const res = await fetch("/api/ledger/sharp-closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, sharpClosingOdds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save sharp closing odds");
      }
      await refresh();
    },
    [refresh]
  );

  return { rows, byId, error, refresh, settle, setClosingOdds, setSharpClosing };
}

/** Which side of its market a row's pick is, for the price lists. */
export function pickSide(row: LedgerRow): "home" | "draw" | "away" | null {
  if (row.pick === "DRAW") return "draw";
  if (row.pick === row.game.home) return "home";
  if (row.pick === row.game.away) return "away";
  return null;
}

/** Edge of the odds taken against the de-vigged sharp close, or null. */
export function sharpClv(row: LedgerRow): number | null {
  const sides = MARKET_SIDES[row.market];
  const side = pickSide(row);
  if (!sides || !side) return null;
  const p = fairProbability(row.sharpClosingOdds, side, sides);
  return p === null ? null : row.oddsTaken * p - 1;
}

const badgeStyle = (color: string): React.CSSProperties => ({
  color,
  border: `1px solid ${color}`,
  borderRadius: "4px",
  padding: "0.1rem 0.4rem",
  fontSize: "0.8rem",
  fontWeight: 600,
  whiteSpace: "nowrap",
});

/** Settlement state of one line: pending, won (with payout), lost or void. */
export const LineStatus: React.FC<{ row: LedgerRow | undefined }> = ({
  row,
}) => {
  if (!row) return <span style={badgeStyle("#525252")}>no ledger</span>;
  if (!row.settledAt) return <span style={badgeStyle("#a3a3a3")}>pending</span>;
  if (row.result === "win")
    return (
      <span style={badgeStyle("#22c55e")}>
        won {(row.return ?? 0).toFixed(2)}€
      </span>
    );
  if (row.result === "void")
    return <span style={badgeStyle("#eab308")}>void</span>;
  return <span style={badgeStyle("#f85149")}>lost</span>;
};

const smallButton = (color: string): React.CSSProperties => ({
  background: "none",
  border: `1px solid ${color}`,
  color,
  borderRadius: "4px",
  padding: "0.15rem 0.5rem",
  fontSize: "0.8rem",
  cursor: "pointer",
});

/** "Lost" / "Void" buttons for a pending line. */
export const SettleButtons: React.FC<{
  row: LedgerRow | undefined;
  onSettle: (result: "loss" | "void") => void;
}> = ({ row, onSettle }) => {
  if (!row || row.settledAt) return null;
  return (
    <span style={{ display: "inline-flex", gap: "0.35rem" }}>
      <button
        style={smallButton("#f85149")}
        onClick={(e) => {
          e.stopPropagation();
          onSettle("loss");
        }}
        title="Mark this line as lost"
      >
        Lost
      </button>
      <button
        style={smallButton("#eab308")}
        onClick={(e) => {
          e.stopPropagation();
          onSettle("void");
        }}
        title="Void: stake returned"
      >
        Void
      </button>
    </span>
  );
};

/** Button that marks every pending line of one bet file as lost. */
export const SettleRestButton: React.FC<{
  pendingIds: string[];
  onSettle: (ids: string[]) => void;
}> = ({ pendingIds, onSettle }) => {
  if (pendingIds.length === 0) return null;
  return (
    <button
      style={{ ...smallButton("#a3a3a3"), marginLeft: "0.75rem" }}
      onClick={(e) => {
        e.stopPropagation();
        onSettle(pendingIds);
      }}
      title="Mark every pending line of this game as lost"
    >
      {pendingIds.length} pending → lost
    </button>
  );
};

/**
 * Closing odds of a line: the bookmaker's price on the pick just before
 * kick-off, typed by hand. Shown as "close 1.85" once set; click to change.
 * Feeds CLV (odds taken / closing odds − 1).
 */
export const ClosingOdds: React.FC<{
  row: LedgerRow | undefined;
  onSave: (closingOdds: number | null) => Promise<void>;
}> = ({ row, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  if (!row) return null;

  const save = async () => {
    const n = Number(value.replace(",", "."));
    if (value !== "" && !(n > 1)) return;
    setBusy(true);
    try {
      await onSave(value === "" ? null : Math.round(n * 100) / 100);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    const clv =
      row.closingOdds && row.closingOdds > 1
        ? (row.oddsTaken / row.closingOdds - 1) * 100
        : null;
    return (
      <button
        style={{
          ...smallButton(row.closingOdds ? "#a3a3a3" : "#525252"),
          borderStyle: row.closingOdds ? "solid" : "dashed",
        }}
        onClick={(e) => {
          e.stopPropagation();
          setValue(row.closingOdds ? String(row.closingOdds) : "");
          setEditing(true);
        }}
        title={
          row.closingOdds
            ? `Closing odds ${row.closingOdds}; CLV ${clv! >= 0 ? "+" : ""}${clv!.toFixed(1)}%. Click to change.`
            : "Enter the bookmaker's odds on this pick just before kick-off"
        }
      >
        {row.closingOdds
          ? `close ${row.closingOdds.toFixed(2)} (${clv! >= 0 ? "+" : ""}${clv!.toFixed(1)}%)`
          : "close?"}
      </button>
    );
  }
  return (
    <span
      style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="number"
        min="1.01"
        step="0.01"
        inputMode="decimal"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="closing odds"
        className="book-odds-input"
      />
      <button style={smallButton("#22c55e")} onClick={save} disabled={busy}>
        Save
      </button>
      <button style={smallButton("#a3a3a3")} onClick={() => setEditing(false)}>
        Cancel
      </button>
    </span>
  );
};

const SIDE_LABELS: Record<string, string> = { home: "1", draw: "X", away: "2" };

/**
 * Sharp closing prices of a line: the reference market's full price list
 * for the bet's market just before kick-off. De-vigged, the pick's fair
 * closing odds are what the odds taken are measured against (closing line
 * value). Shown as "sharp close 2.37/4.10/2.60 (+4.2%)" once set.
 */
export const SharpClosing: React.FC<{
  row: LedgerRow | undefined;
  onSave: (odds: Record<string, number> | null) => Promise<void>;
}> = ({ row, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!row) return null;
  const sides = MARKET_SIDES[row.market];
  if (!sides) return null;

  const parsed = (): Record<string, number> | null => {
    const out: Record<string, number> = {};
    for (const side of sides) {
      const n = Number((values[side] ?? "").replace(",", "."));
      if (!(n > 1)) return null;
      out[side] = Math.round(n * 100) / 100;
    }
    return out;
  };
  const empty = sides.every((side) => !(values[side] ?? "").trim());

  const save = async () => {
    const odds = parsed();
    if (!empty && odds === null) return;
    setBusy(true);
    try {
      await onSave(empty ? null : odds);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    const has = !!row.sharpClosingOdds;
    const clv = sharpClv(row);
    const list = has
      ? sides.map((side) => row.sharpClosingOdds![side]?.toFixed(2) ?? "?").join("/")
      : "";
    const clvText =
      clv === null ? "" : ` (${clv >= 0 ? "+" : ""}${(clv * 100).toFixed(1)}%)`;
    return (
      <button
        style={{
          ...smallButton(has ? "#a3a3a3" : "#525252"),
          borderStyle: has ? "solid" : "dashed",
        }}
        onClick={(e) => {
          e.stopPropagation();
          const next: Record<string, string> = {};
          for (const side of sides)
            next[side] = row.sharpClosingOdds?.[side] ? String(row.sharpClosingOdds[side]) : "";
          setValues(next);
          setEditing(true);
        }}
        title={
          has
            ? `Sharp closing prices ${list}; edge of the odds taken at the de-vigged close${clvText}. Click to change.`
            : "Enter the sharp market's full price list just before kick-off"
        }
      >
        {has ? `sharp close ${list}${clvText}` : "sharp close?"}
      </button>
    );
  }
  return (
    <span
      style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}
      onClick={(e) => e.stopPropagation()}
    >
      {sides.map((side) => (
        <label key={side} style={{ display: "inline-flex", gap: "0.2rem", alignItems: "center", fontSize: "0.8rem" }}>
          {SIDE_LABELS[side] ?? side}
          <input
            type="number"
            min="1.01"
            step="0.01"
            inputMode="decimal"
            value={values[side] ?? ""}
            autoFocus={side === sides[0]}
            onChange={(e) => setValues((v) => ({ ...v, [side]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="book-odds-input"
          />
        </label>
      ))}
      <button
        style={smallButton("#22c55e")}
        onClick={save}
        disabled={busy || (!empty && parsed() === null)}
      >
        Save
      </button>
      <button style={smallButton("#a3a3a3")} onClick={() => setEditing(false)}>
        Cancel
      </button>
    </span>
  );
};
