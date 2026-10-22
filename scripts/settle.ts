/**
 * Settle open bets from the leagues' results.
 *
 *   npm run settle                       # every open bet whose game has been played
 *   npm run settle -- --dry-run
 *   npm run settle -- --id "LUK__TPS_23.10.2026_winner#0" --result loss
 *   npm run settle -- --id "..." --result win --return 18.2 --score 2-1 [--ot]
 *   npm run settle -- --id "..." --result void
 *
 * Results come from the same feeds the ratings use (NHL stats API, liiga.fi,
 * fixturedownload for the EPL and the Champions League); World Cup bets
 * are settled by hand with --id. A bet settles as a win when its pick is
 * the market's outcome: the 60-minute result for `regulation` (a game
 * decided in OT/SO is the draw), the final result for `moneyline` and
 * `fullTime`, the exact final score for `correctScore`.
 */
import { loadDotEnv } from "../src/utils/env";
import { argv, table, money, localDateTime } from "../src/utils/table";
import { ensureLedger, LedgerRow, LedgerResult, round2, settleRows } from "../src/data/ledger";
import { ensureLeague } from "../src/data/leagueData";
import { ensureUcl } from "../src/data/uclFetcher";
import { GameRecord } from "../src/utils/types";

loadDotEnv();
const { flag, has } = argv();
const dryRun = has("--dry-run");
const DAY_MS = 86_400_000;

function outcomeOf(g: GameRecord, market: LedgerRow["market"]): string {
  if (market === "correctScore") return `${g.homeGoals}-${g.awayGoals}`;
  if (market === "regulation" && g.decidedInOTorSO) return "DRAW";
  if (g.homeGoals === g.awayGoals) return "DRAW";
  return g.homeGoals > g.awayGoals ? g.homeAbbr : g.awayAbbr;
}

/** The bet's game among the played ones: same pairing within a day of the recorded kickoff (or the key's date). */
function findGame(row: LedgerRow, games: GameRecord[]): GameRecord | null {
  let at: number | null = row.game.date ? new Date(row.game.date).getTime() : null;
  if (at == null) {
    const m = row.game.key.match(/_(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) at = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`).getTime();
  }
  if (at == null) return null;
  let best: GameRecord | null = null;
  for (const g of games) {
    if (g.homeAbbr !== row.game.home || g.awayAbbr !== row.game.away) continue;
    const dt = Math.abs(new Date(g.date).getTime() - at);
    if (dt <= 1.5 * DAY_MS && (!best || dt < Math.abs(new Date(best.date).getTime() - at))) best = g;
  }
  return best;
}

async function playedGames(league: LedgerRow["league"]): Promise<GameRecord[] | null> {
  if (league === "nhl" || league === "liiga" || league === "epl") return (await ensureLeague(league)).games;
  if (league === "ucl") return (await ensureUcl()).games;
  return null;
}

async function manual() {
  const id = flag("--id")!;
  const result = flag("--result");
  if (result !== "win" && result !== "loss" && result !== "void") throw new Error("--result must be win, loss or void");
  const row = ensureLedger().find((r) => r.id === id);
  if (!row) throw new Error(`no ledger row ${id}`);
  const ret = result === "win" ? Number(flag("--return") ?? round2(row.stake * row.oddsTaken)) : null;
  if (result === "win" && !(ret! > 0)) throw new Error("a win needs --return above 0");
  console.log(`${id}: ${result}${ret != null ? ` return ${money(ret)}` : ""}`);
  if (dryRun) return;
  settleRows([id], { result: result as LedgerResult, return: ret, finalScore: flag("--score") ?? null, decidedInOTorSO: has("--ot") ? true : null });
  console.log("settled");
}

async function automatic() {
  const open = ensureLedger().filter((r) => !r.settledAt);
  if (!open.length) {
    console.log("no open bets");
    return;
  }
  const now = Date.now();
  const rows: (string | number | null)[][] = [];
  const cache = new Map<string, GameRecord[] | null>();
  let settled = 0;
  for (const row of open) {
    const league = row.league ?? "?";
    if (!cache.has(league)) {
      try {
        cache.set(league, await playedGames(row.league));
      } catch (e) {
        console.error(`${league}: results fetch failed: ${(e as Error).message}`);
        cache.set(league, null);
      }
    }
    const games = cache.get(league);
    const game = games ? findGame(row, games) : null;
    if (!game) {
      const future = row.game.date && new Date(row.game.date).getTime() > now;
      rows.push([row.id, row.market, row.pick, row.oddsTaken, money(row.stake), future ? "not played yet" : games ? "no result found" : "settle by hand (--id)", "–", "–"]);
      continue;
    }
    const outcome = outcomeOf(game, row.market);
    const won = outcome === row.pick;
    const ret = won ? round2(row.stake * row.oddsTaken) : 0;
    rows.push([row.id, row.market, row.pick, row.oddsTaken, money(row.stake), `${game.homeGoals}-${game.awayGoals}${game.decidedInOTorSO ? " OT" : ""}`, won ? "win" : "loss", money(ret - row.stake)]);
    if (!dryRun) {
      settleRows([row.id], {
        result: won ? "win" : "loss",
        return: ret,
        finalScore: `${game.homeGoals}-${game.awayGoals}`,
        decidedInOTorSO: game.decidedInOTorSO,
      });
      settled++;
    }
  }
  console.log(table(["Bet", "Market", "Pick", "Odds", "Stake", "Score", "Result", "P&L"], rows));
  console.log(dryRun ? "dry run; nothing written" : `settled ${settled} of ${open.length} open bets`);
}

(flag("--id") ? manual() : automatic()).catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
