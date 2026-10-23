/**
 * Fill the sharp closing prices of settled-or-played ledger lines from
 * OddsPapi's Pinnacle price history, so the dashboard's CLV vs the sharp
 * close no longer depends on typing them in.
 *
 *   ODDSPAPI_API_KEY=... npm run odds:close                # fill every eligible line
 *   ODDSPAPI_API_KEY=... npm run odds:close -- --dry-run   # list what would be fetched
 *   ODDSPAPI_API_KEY=... npm run odds:close -- --max 5     # at most 5 games (requests)
 *
 * Eligible: sharpClosingOdds empty, game.date known and in the past, league
 * nhl/liiga/epl/ucl, market regulation/moneyline/fullTime. Lines on the
 * same game share one fixture lookup (the billable call); the price
 * history itself is free. The matching prediction-log row (same league and
 * pairing, shown within 14 days before kickoff) gets its closing list too.
 */
import { ensureLedger, LedgerRow, setSharpClosingOdds } from "../src/data/ledger";
import { loadDotEnv } from "../src/utils/env";

loadDotEnv();
import { readPredictions, setPredictionClosing } from "../src/data/predictions";
import {
  BudgetExceeded,
  budget,
  fetchClosingOdds,
  isConfigured,
  unmatchedNames,
} from "../src/odds/oddspapi";
import { isOddsLeague, OddsLeague } from "../src/odds/oddspapiAliases";
import { PriceTrio } from "../src/odds/types";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const maxIdx = args.indexOf("--max");
const max = maxIdx >= 0 ? Number(args[maxIdx + 1]) || Infinity : Infinity;

if (!isConfigured()) {
  console.log("ODDSPAPI_API_KEY not set; nothing fetched");
  process.exit(0);
}

const now = Date.now();
const rows = ensureLedger().filter(
  (r) =>
    r.sharpClosingOdds == null &&
    r.game.date &&
    new Date(r.game.date).getTime() < now &&
    isOddsLeague(r.league) &&
    (r.market === "regulation" || r.market === "moneyline" || r.market === "fullTime")
);

interface Group {
  league: OddsLeague;
  home: string;
  away: string;
  kickoff: string;
  rows: LedgerRow[];
}
const groups = new Map<string, Group>();
for (const r of rows) {
  const key = `${r.league}:${r.game.home}:${r.game.away}:${r.game.date!.slice(0, 10)}`;
  let g = groups.get(key);
  if (!g) {
    g = { league: r.league as OddsLeague, home: r.game.home, away: r.game.away, kickoff: r.game.date!, rows: [] };
    groups.set(key, g);
  }
  g.rows.push(r);
}

const before = budget();
console.log(`${rows.length} lines on ${groups.size} games need a sharp close; budget ${before.used}/${before.limit} used`);

const trioFor = (market: string, v: { sharpOdds: PriceTrio; moneyline?: { home: number; away: number } }) => {
  if (market === "moneyline") return v.moneyline ?? null;
  const t = v.sharpOdds;
  return t.draw === undefined ? null : t;
};

const asList = (t: PriceTrio | { home: number; away: number }): Record<string, number> => {
  const out: Record<string, number> = { home: t.home, away: t.away };
  if ("draw" in t && t.draw !== undefined) out.draw = t.draw;
  return out;
};

let done = 0;
let filled = 0;
const predictions = readPredictions();
for (const g of groups.values()) {
  if (done >= max) break;
  const label = `${g.league} ${g.home}-${g.away} ${g.kickoff.slice(0, 16)}`;
  if (dryRun) {
    console.log(`would fetch  ${label}  (${g.rows.length} line${g.rows.length === 1 ? "" : "s"})`);
    done++;
    continue;
  }
  try {
    const { value, cached } = await fetchClosingOdds({ league: g.league, home: g.home, away: g.away, kickoff: g.kickoff });
    done++;
    if (!value) {
      console.log(`no close     ${label}`);
      continue;
    }
    for (const r of g.rows) {
      const trio = trioFor(r.market, value);
      if (!trio) {
        console.log(`no ${r.market} price  ${r.id}`);
        continue;
      }
      setSharpClosingOdds([r.id], asList(trio));
      filled++;
      console.log(`${cached ? "cached" : "filled"}       ${r.id}  ${JSON.stringify(asList(trio))}`);
    }
    // Prediction log: the 1X2 row shown for this pairing before kickoff.
    const kickoffT = new Date(g.kickoff).getTime();
    const main = value.sharpOdds.draw === undefined ? null : asList(value.sharpOdds);
    if (main) {
      for (const p of predictions) {
        if (p.league !== g.league || p.closingOdds) continue;
        if (p.game.home !== g.home || p.game.away !== g.away) continue;
        const at = new Date(p.at).getTime();
        if (at > kickoffT + 6 * 3600 * 1000 || at < kickoffT - 14 * 24 * 3600 * 1000) continue;
        setPredictionClosing(p.id, main);
        console.log(`prediction   ${p.id}`);
      }
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      console.log(`stopped: ${e.message}`);
      break;
    }
    console.error(`failed       ${label}`, (e as Error).message);
  }
}

const after = budget();
console.log(`filled ${filled} lines; budget ${after.used}/${after.limit} used (${after.used - before.used} spent)`);
for (const [league, names] of unmatchedNames) {
  if (names.size)
    console.log(`unmatched ${league} names (add to src/odds/oddspapiAliases.ts): ${[...names].join(", ")}`);
}
