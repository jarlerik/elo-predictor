/**
 * Log a bet in the ledger (data/ledger.jsonl).
 *
 *   npm run bet -- --candidate 1 --stake 10          # candidate 1 of the latest scan
 *   npm run bet -- liiga LUK TPS LUK 1.82 10 --market moneyline --book Veikkaus --line 1.82,1.98
 *   npm run bet -- epl TOT COV DRAW 4.35 5 --line 1.55,4.35,5.65 --sharp 1.56,4.59,5.71 --sharp-source "Pinnacle (The Odds API)"
 *   npm run bet -- ... --dry-run                       # show the row, write nothing
 *
 * Positional form: <league> <HOME> <AWAY> <pick: team code | DRAW> <odds> <stake>.
 * `--market` defaults to the league's 1X2 (regulation for hockey, fullTime
 * for soccer); `--line` is the book's full price list for the market
 * (home,draw,away or home,away) and `--sharp` the sharp reference list;
 * without `--sharp` Pinnacle's prices are fetched from OddsPapi when the
 * key is set. The model's probability and ratings are attached from the
 * live league state; when a team is unknown to the model the de-vigged
 * sharp probability stands in (flag "probabilityIsSharp").
 */
import fs from "fs";
import path from "path";
import { loadDotEnv } from "../src/utils/env";
import { argv, localDay, pct, money } from "../src/utils/table";
import {
  appendLedger,
  ensureLedger,
  inferLeague,
  isLedgerLeague,
  LedgerLeague,
  LedgerMarket,
  newRow,
} from "../src/data/ledger";
import { bankrollState, readBankroll } from "../src/data/bankroll";
import { modelView } from "../src/data/modelSnapshot";
import { ensureLeague, kickoffOf } from "../src/data/leagueData";
import { ensureUcl } from "../src/data/uclFetcher";
import { devig, MARKET_SIDES } from "../src/utils/sharp";
import { kellyStake } from "../src/utils/kelly";
import { fetchSharpOdds, isConfigured as oddspapiConfigured } from "../src/odds/oddspapi";
import { isOddsLeague } from "../src/odds/oddspapiAliases";
import { Candidate } from "../src/odds/scan";
import { LEAGUES } from "../src/utils/leagues";

loadDotEnv();
const { flag, has, positional } = argv();

const BOOK_NAMES: Record<string, string> = { veikkaus_fi: "Veikkaus", unibet_fi: "Unibet", leovegas_fi: "LeoVegas" };

function parseList(value: string | undefined, sides: string[]): Record<string, number> | null {
  if (!value) return null;
  const nums = value.split(",").map(Number);
  if (nums.length !== sides.length || nums.some((n) => !(n > 1))) {
    throw new Error(`a price list for this market has ${sides.length} prices above 1 (${sides.join(",")}); got "${value}"`);
  }
  return Object.fromEntries(sides.map((s, i) => [s, Math.round(nums[i] * 100) / 100]));
}

function latestScan(): { file: string; candidates: Candidate[] } | null {
  const dir = path.join(process.cwd(), "data", "scans");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return null;
  const file = path.join(dir, files[files.length - 1]);
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  const candidates: Candidate[] = (raw.leagues as { candidates: Candidate[] }[]).flatMap((l) => l.candidates).sort((a, b) => b.ev - a.ev);
  return { file, candidates };
}

interface Input {
  league: LedgerLeague;
  home: string;
  away: string;
  pick: string;
  odds: number;
  stake: number;
  market: LedgerMarket;
  bookmaker: string | null;
  marketOdds: Record<string, number> | null;
  sharpOdds: Record<string, number> | null;
  sharpSource: string | null;
  date: string | null;
}

async function fromCandidate(n: number, stake: number): Promise<Input> {
  const scan = latestScan();
  if (!scan) throw new Error("no scan under data/scans; run npm run scan first");
  const c = scan.candidates[n - 1];
  if (!c) throw new Error(`the latest scan (${path.basename(scan.file)}) has ${scan.candidates.length} candidates`);
  const sides = MARKET_SIDES[c.market];
  return {
    league: c.league,
    home: c.home,
    away: c.away,
    pick: c.pick,
    odds: c.odds,
    stake,
    market: c.market,
    bookmaker: BOOK_NAMES[c.book] ?? c.book,
    marketOdds: Object.fromEntries(sides.map((s) => [s, c.bookLine[s]])),
    sharpOdds: c.sharpLine,
    sharpSource: c.sharpSource === "pinnacle" ? "Pinnacle (The Odds API)" : c.sharpSource ? "Consensus median (The Odds API)" : null,
    date: c.commence,
  };
}

async function fromArgs(): Promise<Input> {
  const [leagueArg, homeArg, awayArg, pickArg, oddsArg, stakeArg] = positional;
  if (!leagueArg || !homeArg || !awayArg || !pickArg || !oddsArg) {
    throw new Error("usage: npm run bet -- <league> <HOME> <AWAY> <pick> <odds> [stake] [--market ...] | --candidate <n> --stake <x>");
  }
  const home = homeArg.toUpperCase();
  const away = awayArg.toUpperCase();
  const league = isLedgerLeague(leagueArg) ? leagueArg : inferLeague(home, away);
  if (!league) throw new Error(`unknown league "${leagueArg}"`);
  const pick = pickArg.toUpperCase() === "DRAW" ? "DRAW" : pickArg.toUpperCase();
  if (pick !== "DRAW" && pick !== home && pick !== away) throw new Error(`pick must be ${home}, ${away} or DRAW`);
  const odds = Number(oddsArg);
  if (!(odds > 1)) throw new Error("odds must be above 1");
  const stake = Number(flag("--stake") ?? stakeArg ?? 1);
  if (!(stake > 0)) throw new Error("stake must be positive");
  const hockey = league === "nhl" || league === "liiga";
  const marketArg = flag("--market");
  const market: LedgerMarket =
    marketArg === "regulation" || marketArg === "moneyline" || marketArg === "fullTime" ? marketArg : hockey ? "regulation" : "fullTime";
  if (market === "moneyline" && pick === "DRAW") throw new Error("the moneyline has no draw");
  const sides = MARKET_SIDES[market];
  let sharpOdds = parseList(flag("--sharp"), sides);
  let sharpSource = sharpOdds ? flag("--sharp-source") ?? "manual" : null;
  let date = flag("--date") ?? null;
  if (!date) {
    try {
      if (league === "nhl" || league === "liiga" || league === "epl") date = kickoffOf((await ensureLeague(league)).upcoming, home, away);
      else if (league === "ucl") date = kickoffOf((await ensureUcl()).upcoming, home, away);
    } catch (e) {
      console.error(`kickoff lookup failed: ${(e as Error).message}`);
    }
  }
  if (!sharpOdds && oddspapiConfigured() && isOddsLeague(league)) {
    const { value } = await fetchSharpOdds({ league, home, away, kickoff: date });
    const list = market === "moneyline" ? value?.moneyline : value?.sharpOdds;
    if (list && sides.every((s) => typeof (list as Record<string, number>)[s] === "number")) {
      sharpOdds = Object.fromEntries(sides.map((s) => [s, (list as Record<string, number>)[s]]));
      sharpSource = value!.sharpSource;
    }
  }
  return {
    league,
    home,
    away,
    pick,
    odds,
    stake,
    market,
    bookmaker: flag("--book") ?? null,
    marketOdds: parseList(flag("--line"), sides),
    sharpOdds,
    sharpSource,
    date,
  };
}

async function main() {
  const candidate = flag("--candidate");
  const input = candidate ? await fromCandidate(Number(candidate), Number(flag("--stake") ?? 1)) : await fromArgs();
  const sides = MARKET_SIDES[input.market];
  const side = input.pick === "DRAW" ? "draw" : input.pick === input.home ? "home" : "away";

  const view = await modelView(input.league, input.home, input.away, input.market).catch((e) => {
    console.error(`model lookup failed: ${(e as Error).message}`);
    return null;
  });
  const sharpFair = input.sharpOdds ? devig(input.sharpOdds, sides) : null;
  const flags: string[] = [];
  let probability = view?.probs[side] ?? null;
  if (probability == null && sharpFair) {
    probability = Math.round(sharpFair[side] * 10000) / 10000;
    flags.push("probabilityIsSharp");
  }
  if (probability == null) throw new Error(`neither the model nor a sharp price gives a probability for ${input.pick}; pass --sharp`);
  if (!input.marketOdds) flags.push("noMarketLine");

  const rows = ensureLedger();
  const placedAt = new Date().toISOString();
  const day = localDay(placedAt).split("-").reverse().join(".");
  const key = `${input.home}__${input.away}_${day}`;
  const stem = `${key}_winner`;
  const index = rows.filter((r) => r.id.startsWith(`${stem}#`)).length;
  const bank = bankrollState(readBankroll(), rows);
  const row = newRow({
    fileStem: stem,
    index,
    key,
    home: input.home,
    away: input.away,
    date: input.date,
    placedAt,
    league: input.league,
    market: input.market,
    pick: input.pick,
    stake: Math.round(input.stake * 100) / 100,
    oddsTaken: input.odds,
    probability,
    bookmaker: input.bookmaker,
    marketOdds: input.marketOdds,
    model: view?.snapshot ?? null,
    sharpOdds: input.sharpOdds,
    sharpSource: input.sharpSource,
    bankrollBefore: bank.current,
    kellyDivider: bank.kellyDivider,
    flags,
  });

  const sharpEdge = sharpFair ? sharpFair[side] * input.odds - 1 : null;
  const modelEdge = view ? view.probs[side] * input.odds - 1 : null;
  console.log(`${LEAGUES[input.league as keyof typeof LEAGUES]?.name ?? input.league.toUpperCase()}  ${input.home} v ${input.away}  ${input.market}  pick ${input.pick} @ ${input.odds}  stake ${money(input.stake)}${input.bookmaker ? `  (${input.bookmaker})` : ""}`);
  console.log(`kickoff ${input.date ?? "unknown"}  id ${row.id}`);
  console.log(`model p ${view ? upctLocal(view.probs[side]) : "–"} (edge ${pct(modelEdge)})   sharp p ${sharpFair ? upctLocal(sharpFair[side]) : "–"} (edge ${pct(sharpEdge)}${input.sharpSource ? `, ${input.sharpSource}` : ""})`);
  if (bank.current != null && sharpFair) {
    console.log(`Kelly /${bank.kellyDivider} at the sharp probability on a ${money(bank.current)} bankroll: ${money(kellyStake(bank.current, sharpFair[side], input.odds, bank.kellyDivider))}`);
  }
  if (has("--dry-run")) {
    console.log("dry run; nothing written");
    console.log(JSON.stringify(row, null, 1));
    return;
  }
  appendLedger([row]);
  console.log(`saved to ${path.relative(process.cwd(), path.join(process.cwd(), "data", "ledger.jsonl"))}`);
}

const upctLocal = (x: number) => `${(x * 100).toFixed(1)} %`;

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
