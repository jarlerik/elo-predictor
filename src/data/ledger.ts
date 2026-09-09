/**
 * Bet ledger: one JSON object per line in data/ledger.jsonl.
 *
 * Every bet line (a winner pick or a single correct-score line) is one row.
 * Rows are appended when a bet is saved and rewritten in place when settled.
 * The per-game files in data/bets/ are still written for the Played Bets
 * pages; the ledger is the source of truth for totals and results.
 *
 * Row ids are "<bet file stem>#<index>", e.g. "HPK__ILV_07.09.2026_winner#0",
 * so a ledger row can always be traced back to the line in its bet file.
 * All lines of one game share a `positionId` (the game key), so correlated
 * exposure on one game can be summed.
 */
import fs from "fs";
import path from "path";
import { CURRENT_NHL_TEAMS } from "../utils/teamData";
import { EPL_TEAMS, LIIGA_TEAMS, UCL_TEAMS } from "../utils/leagues";
import { COUNTRY_NAMES } from "../utils/soccerTeams";

export type LedgerLeague = "nhl" | "liiga" | "epl" | "ucl" | "worldcup";
export type LedgerMarket =
  | "regulation"
  | "moneyline"
  | "fullTime"
  | "correctScore";
export type LedgerResult = "win" | "loss" | "void";

export interface ModelSnapshot {
  /** 1X2 probabilities as shown when the bet was placed. */
  probs?: { home: number; draw: number; away: number } | null;
  homeElo?: number | null;
  awayElo?: number | null;
  drawFactor?: number | null;
  homeAdv?: number | null;
  /** Correct-score bets: Poisson means used for the score grid. */
  lambdaHome?: number | null;
  lambdaAway?: number | null;
}

export interface LedgerRow {
  id: string;
  positionId: string;
  placedAt: string | null;
  league: LedgerLeague | null;
  game: {
    home: string;
    away: string;
    /** HOME__AWAY_DD.MM.YYYY, the bet file stem without "_winner". */
    key: string;
    /** Game date (ISO date). Not known for bets saved so far. */
    date: string | null;
  };
  market: LedgerMarket;
  /** Team code, "DRAW", or a score such as "2-1". */
  pick: string;
  stake: number;
  oddsTaken: number;
  /** Model probability of the pick at bet time. */
  probability: number;
  bookmaker: string | null;
  /** Bookmaker prices for every outcome of the market at bet time. */
  marketOdds: Record<string, number> | null;
  model: ModelSnapshot | null;
  closingOdds: number | null;
  bankrollBefore: number | null;
  kellyDivider: number | null;
  settledAt: string | null;
  result: LedgerResult | null;
  finalScore: string | null;
  decidedInOTorSO: boolean | null;
  return: number | null;
  /**
   * Data-quality markers. "migrated": imported from the bet files.
   * "oddsIsMinOdd": oddsTaken is the model's fair odd, not a bookmaker
   * price (score bets saved before step 2 of the metrics plan).
   * "lossInferred": marked lost because another line of the game settled.
   */
  flags: string[];
}

const DEFAULT_STAKE = 1;

export function ledgerPath(): string {
  return path.join(process.cwd(), "data", "ledger.jsonl");
}

export function betsDir(): string {
  return path.join(process.cwd(), "data", "bets");
}

export function resultsPath(): string {
  return path.join(process.cwd(), "data", "results.json");
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** "HOME__AWAY_DD.MM.YYYY_winner.json" -> parts, or null when malformed. */
export function parseBetFilename(filename: string): {
  stem: string;
  key: string;
  home: string;
  away: string;
  fileDate: string;
  isWinner: boolean;
} | null {
  if (!filename.endsWith(".json")) return null;
  const stem = filename.slice(0, -".json".length);
  const isWinner = stem.endsWith("_winner");
  const key = isWinner ? stem.slice(0, -"_winner".length) : stem;
  const parts = key.split("__");
  if (parts.length !== 2) return null;
  const rest = parts[1].split("_");
  if (rest.length < 2) return null;
  return {
    stem,
    key,
    home: parts[0],
    away: rest[0],
    fileDate: rest.slice(1).join("_"),
    isWinner,
  };
}

/** DD.MM.YYYY -> ISO date, or null. */
export function fileDateToIso(fileDate: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(fileDate);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function isLedgerLeague(v: unknown): v is LedgerLeague {
  return (
    v === "nhl" ||
    v === "liiga" ||
    v === "epl" ||
    v === "ucl" ||
    v === "worldcup"
  );
}

/**
 * Guess the league from the two team codes. Codes are unique across leagues
 * except that English clubs keep their EPL code in the Champions League, so
 * two EPL codes default to the Premier League.
 */
export function inferLeague(home: string, away: string): LedgerLeague | null {
  const inNhl = (c: string) => CURRENT_NHL_TEAMS.has(c);
  const inLiiga = (c: string) => c in LIIGA_TEAMS;
  const inEpl = (c: string) => c in EPL_TEAMS;
  const inUcl = (c: string) => c in UCL_TEAMS;
  const inWc = (c: string) => c in COUNTRY_NAMES;
  if (inNhl(home) && inNhl(away)) return "nhl";
  if (inLiiga(home) && inLiiga(away)) return "liiga";
  if (inEpl(home) && inEpl(away)) return "epl";
  if (inUcl(home) && inUcl(away)) return "ucl";
  if (inWc(home) && inWc(away)) return "worldcup";
  return null;
}

// ---------------------------------------------------------------------------
// File access
// ---------------------------------------------------------------------------

export function readLedger(): LedgerRow[] {
  const file = ledgerPath();
  if (!fs.existsSync(file)) return [];
  const rows: LedgerRow[] = [];
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as LedgerRow);
    } catch (e) {
      console.error("ledger: skipping unparsable line:", trimmed.slice(0, 80));
    }
  }
  return rows;
}

export function appendLedger(rows: LedgerRow[]): void {
  if (rows.length === 0) return;
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.appendFileSync(file, text);
}

export function writeLedger(rows: LedgerRow[]): void {
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  // Write to a temp file first so a crash mid-write cannot empty the ledger.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, rows.length ? text : "");
  fs.renameSync(tmp, file);
}

/** Ledger rows, importing the legacy bet files first if the ledger is new. */
export function ensureLedger(): LedgerRow[] {
  if (!fs.existsSync(ledgerPath())) {
    const { added } = migrateLegacyBets();
    if (added > 0) console.log(`ledger: imported ${added} legacy bet lines`);
  }
  return readLedger();
}

// ---------------------------------------------------------------------------
// Building rows
// ---------------------------------------------------------------------------

export function newRow(input: {
  fileStem: string;
  index: number;
  key: string;
  home: string;
  away: string;
  placedAt: string | null;
  league: LedgerLeague | null;
  market: LedgerMarket;
  pick: string;
  stake: number;
  oddsTaken: number;
  probability: number;
  bookmaker?: string | null;
  marketOdds?: Record<string, number> | null;
  model?: ModelSnapshot | null;
  bankrollBefore?: number | null;
  kellyDivider?: number | null;
  flags?: string[];
}): LedgerRow {
  return {
    id: `${input.fileStem}#${input.index}`,
    positionId: input.key,
    placedAt: input.placedAt,
    league: input.league,
    game: { home: input.home, away: input.away, key: input.key, date: null },
    market: input.market,
    pick: input.pick,
    stake: input.stake,
    oddsTaken: input.oddsTaken,
    probability: input.probability,
    bookmaker: input.bookmaker ?? null,
    marketOdds: input.marketOdds ?? null,
    model: input.model ?? null,
    closingOdds: null,
    bankrollBefore: input.bankrollBefore ?? null,
    kellyDivider: input.kellyDivider ?? null,
    settledAt: null,
    result: null,
    finalScore: null,
    decidedInOTorSO: null,
    return: null,
    flags: input.flags ?? [],
  };
}

export interface Settlement {
  result: LedgerResult;
  /** Payout in euros. Required for a win; loss is 0 and void is the stake. */
  return?: number | null;
  finalScore?: string | null;
  decidedInOTorSO?: boolean | null;
  settledAt?: string;
  flags?: string[];
}

export function applySettlement(row: LedgerRow, s: Settlement): LedgerRow {
  const payout =
    s.result === "loss"
      ? 0
      : s.result === "void"
      ? row.stake
      : round2(Number(s.return ?? 0));
  const flags = new Set(row.flags ?? []);
  for (const f of s.flags ?? []) flags.add(f);
  return {
    ...row,
    settledAt: s.settledAt ?? new Date().toISOString(),
    result: s.result,
    return: payout,
    finalScore: s.finalScore ?? row.finalScore ?? null,
    decidedInOTorSO: s.decidedInOTorSO ?? row.decidedInOTorSO ?? null,
    flags: [...flags],
  };
}

/** Settle the given ids in place. Returns the updated rows. */
export function settleRows(
  ids: string[],
  settlement: Settlement
): LedgerRow[] {
  const rows = ensureLedger();
  const wanted = new Set(ids);
  const updated: LedgerRow[] = [];
  const next = rows.map((row) => {
    if (!wanted.has(row.id)) return row;
    const settled = applySettlement(row, settlement);
    updated.push(settled);
    return settled;
  });
  if (updated.length > 0) writeLedger(next);
  return updated;
}

/** Set (or clear with null) the closing odds of the given lines. */
export function setClosingOdds(
  ids: string[],
  closingOdds: number | null
): LedgerRow[] {
  const rows = ensureLedger();
  const wanted = new Set(ids);
  const updated: LedgerRow[] = [];
  const next = rows.map((row) => {
    if (!wanted.has(row.id)) return row;
    const changed = { ...row, closingOdds };
    updated.push(changed);
    return changed;
  });
  if (updated.length > 0) writeLedger(next);
  return updated;
}

// ---------------------------------------------------------------------------
// Migration from data/bets/*.json + data/results.json
// ---------------------------------------------------------------------------

interface LegacyResult {
  game: string;
  score?: string;
  team?: string;
  probability: number;
  odds: number;
  return: number;
}

function stakeOf(bet: any): number {
  const n = Number(bet?.stake);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STAKE;
}

/**
 * Turn one legacy bet file into ledger rows (unsettled). The winner-file
 * `market` field is missing on old bets, which were all moneyline / fullTime.
 */
export function rowsFromBetFile(
  filename: string,
  bets: any[]
): LedgerRow[] {
  const parsed = parseBetFilename(filename);
  if (!parsed) return [];
  const league = inferLeague(parsed.home, parsed.away);
  const fileDay = fileDateToIso(parsed.fileDate);
  const rows: LedgerRow[] = [];
  bets.forEach((bet, index) => {
    if (parsed.isWinner) {
      const market: LedgerMarket =
        bet.market === "regulation" ||
        bet.market === "moneyline" ||
        bet.market === "fullTime"
          ? bet.market
          : league === "nhl" || league === "liiga"
          ? "moneyline"
          : "fullTime";
      rows.push(
        newRow({
          fileStem: parsed.stem,
          index,
          key: parsed.key,
          home: bet.homeTeam ?? parsed.home,
          away: bet.awayTeam ?? parsed.away,
          placedAt:
            typeof bet.timestamp === "string"
              ? bet.timestamp
              : fileDay
              ? `${fileDay}T00:00:00.000Z`
              : null,
          league,
          market,
          pick: String(bet.team),
          stake: stakeOf(bet),
          oddsTaken: Number(bet.odds),
          probability: Number(bet.probability),
          flags: ["migrated"],
        })
      );
    } else {
      rows.push(
        newRow({
          fileStem: parsed.stem,
          index,
          key: parsed.key,
          home: parsed.home,
          away: parsed.away,
          placedAt: fileDay ? `${fileDay}T00:00:00.000Z` : null,
          league,
          market: "correctScore",
          pick: String(bet.score),
          stake: stakeOf(bet),
          oddsTaken: Number(bet.odds),
          probability: Number(bet.probability),
          flags: ["migrated", "oddsIsMinOdd"],
        })
      );
    }
  });
  return rows;
}

/**
 * Import every bet line that is not yet in the ledger, then apply
 * results.json: a line with a result entry is settled with that return; the
 * other lines of a game that has any result are marked lost, matching how
 * the totals were computed before the ledger existed.
 */
export function migrateLegacyBets(): { added: number; settled: number } {
  const existing = readLedger();
  const known = new Set(existing.map((r) => r.id));
  const dir = betsDir();
  const added: LedgerRow[] = [];

  if (fs.existsSync(dir)) {
    for (const filename of fs.readdirSync(dir).sort()) {
      if (!filename.endsWith(".json")) continue;
      let bets: any;
      try {
        bets = JSON.parse(fs.readFileSync(path.join(dir, filename), "utf-8"));
      } catch (e) {
        console.error(`ledger: cannot read ${filename}`, e);
        continue;
      }
      if (!Array.isArray(bets)) continue;
      for (const row of rowsFromBetFile(filename, bets)) {
        if (!known.has(row.id)) {
          added.push(row);
          known.add(row.id);
        }
      }
    }
  }

  let results: LegacyResult[] = [];
  if (fs.existsSync(resultsPath())) {
    try {
      const raw = JSON.parse(fs.readFileSync(resultsPath(), "utf-8"));
      if (Array.isArray(raw)) results = raw;
    } catch (e) {
      console.error("ledger: cannot read results.json", e);
    }
  }

  // Results only settle rows imported in this run; rows already in the
  // ledger carry their own settlement state.
  const gamesWithResult = new Set(results.map((r) => r.game));
  const settledAt = new Date().toISOString();
  let settled = 0;
  const finalRows = added.map((row) => {
    const hit = results.find(
      (r) =>
        r.game === row.game.key &&
        (row.market === "correctScore"
          ? r.score === row.pick
          : !r.score && r.team === row.pick)
    );
    if (hit) {
      settled++;
      return applySettlement(row, {
        result: hit.return > 0 ? "win" : "loss",
        return: hit.return,
        settledAt,
      });
    }
    if (gamesWithResult.has(row.game.key)) {
      settled++;
      return applySettlement(row, {
        result: "loss",
        settledAt,
        flags: ["lossInferred"],
      });
    }
    return row;
  });

  appendLedger(finalRows);
  return { added: finalRows.length, settled };
}
