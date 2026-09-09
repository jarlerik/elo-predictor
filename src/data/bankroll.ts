/**
 * Bankroll (data change 3 of docs/METRICS_AND_DASHBOARD.md): a starting
 * amount as of a date, deposits and withdrawals, and the staking settings
 * the bet forms read. Current bankroll = start + movements + profit of the
 * bets settled since the start date.
 */
import fs from "fs";
import path from "path";
import { LedgerRow, round2 } from "./ledger";

export interface Movement {
  at: string;
  /** Positive = deposit, negative = withdrawal. */
  amount: number;
  note: string | null;
}

export interface BankrollFile {
  start: number;
  /** ISO date the start amount was counted on. */
  startedAt: string;
  kellyDivider: number;
  /** Share of the bankroll open on one day before the dashboard warns. */
  dailyExposureLimit: number;
  movements: Movement[];
}

export const DEFAULT_KELLY_DIVIDER = 4;
export const DEFAULT_DAILY_EXPOSURE_LIMIT = 0.1;

export interface BankrollState {
  tracked: boolean;
  start: number | null;
  startedAt: string | null;
  kellyDivider: number;
  dailyExposureLimit: number;
  movements: Movement[];
  deposits: number;
  withdrawals: number;
  /** Profit of win/loss bets settled since startedAt. */
  settledProfit: number;
  settledBets: number;
  current: number | null;
  /** Stake tied up in pending bets (not deducted from current). */
  openStake: number;
}

export function bankrollPath(): string {
  return path.join(process.cwd(), "data", "bankroll.json");
}

export function readBankroll(): BankrollFile | null {
  const p = bankrollPath();
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return {
    start: Number(raw.start) || 0,
    startedAt: String(raw.startedAt ?? "").slice(0, 10),
    kellyDivider: Number(raw.kellyDivider) || DEFAULT_KELLY_DIVIDER,
    dailyExposureLimit:
      Number(raw.dailyExposureLimit) || DEFAULT_DAILY_EXPOSURE_LIMIT,
    movements: Array.isArray(raw.movements)
      ? raw.movements.map((m: any) => ({
          at: String(m.at),
          amount: Number(m.amount) || 0,
          note: m.note ? String(m.note) : null,
        }))
      : [],
  };
}

export function writeBankroll(file: BankrollFile): void {
  const p = bankrollPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

export function bankrollState(
  file: BankrollFile | null,
  rows: LedgerRow[]
): BankrollState {
  const openStake = rows
    .filter((r) => !r.settledAt)
    .reduce((s, r) => s + r.stake, 0);
  if (!file) {
    return {
      tracked: false,
      start: null,
      startedAt: null,
      kellyDivider: DEFAULT_KELLY_DIVIDER,
      dailyExposureLimit: DEFAULT_DAILY_EXPOSURE_LIMIT,
      movements: [],
      deposits: 0,
      withdrawals: 0,
      settledProfit: 0,
      settledBets: 0,
      current: null,
      openStake: round2(openStake),
    };
  }
  let settledProfit = 0;
  let settledBets = 0;
  for (const r of rows) {
    if (!r.settledAt || (r.result !== "win" && r.result !== "loss")) continue;
    if (r.settledAt.slice(0, 10) < file.startedAt) continue;
    settledProfit += (r.return ?? 0) - r.stake;
    settledBets++;
  }
  const deposits = file.movements
    .filter((m) => m.amount > 0)
    .reduce((s, m) => s + m.amount, 0);
  const withdrawals = file.movements
    .filter((m) => m.amount < 0)
    .reduce((s, m) => s - m.amount, 0);
  return {
    tracked: true,
    start: file.start,
    startedAt: file.startedAt,
    kellyDivider: file.kellyDivider,
    dailyExposureLimit: file.dailyExposureLimit,
    movements: file.movements,
    deposits: round2(deposits),
    withdrawals: round2(withdrawals),
    settledProfit: round2(settledProfit),
    settledBets,
    current: round2(file.start + deposits - withdrawals + settledProfit),
    openStake: round2(openStake),
  };
}

/** Current bankroll for the metrics, null when not tracked. */
export function currentBankroll(rows: LedgerRow[]): number | null {
  return bankrollState(readBankroll(), rows).current;
}
