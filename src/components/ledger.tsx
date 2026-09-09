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

  return { rows, byId, error, refresh, settle };
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
