import React, { useCallback, useEffect, useState } from "react";

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

  return { rows, byId, error, refresh, settle, setClosingOdds };
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
