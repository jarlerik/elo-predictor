/**
 * Backtest of the outlier rule (Kaunitz et al. 2017; src/odds/outliers.ts)
 * on the stored per-bookmaker closing lines.
 *
 *   npm run backtest:outliers -- nhl
 *   npm run backtest:outliers -- epl --alpha 0.03,0.05,0.07 --from 2019
 *   npm run backtest:outliers -- liiga --books unibet_se,coolbet --detail 0.04
 *   npm run backtest:outliers -- nhl --exclude onexbet,marathonbet
 *
 * For every game and market the consensus is p_cons = 1 / mean odds over
 * the stored books (football-data's named books' closing columns for the
 * EPL; The Odds API's European books at ten minutes before the day's
 * first game for the hockey leagues and the NBA). One flat unit goes on each
 * (game, side) whose best price among the candidate books exceeds
 * 1 / (p_cons − α), as in the paper. Reports per α the number of bets,
 * hit rate against the paper's expected hit rate, yield with its standard
 * error, and the expectation of the same bets at the de-vigged sharp
 * price, then the α of `--detail` (default 0.05) by season, market, side
 * and book. Writes data/reports/outliers-<league>-<stamp>.md and .json.
 */
import fs from "fs";
import path from "path";
import { readStoredGames } from "../src/data/gameStore";
import { readAllOdds, joinOdds, gameKey } from "../src/odds/store";
import { OddsRecord } from "../src/odds/types";
import { Lines, meanOddsConsensus, kaunitzThreshold, kaunitzEv } from "../src/odds/outliers";
import { devig, MARKET_SIDES } from "../src/utils/sharp";
import { LeagueId, LEAGUES, MAIN_MARKET, isLeagueId } from "../src/utils/leagues";
import { GameRecord } from "../src/utils/types";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const league: LeagueId = isLeagueId(args[0]) ? args[0] : "nhl";
const alphas = (flag("--alpha") ?? "0.02,0.03,0.04,0.05,0.06,0.07,0.08").split(",").map(Number);
const detailAlpha = Number(flag("--detail") ?? 0.05);
const from = flag("--from") ? Number(flag("--from")) : undefined;
const to = flag("--to") ? Number(flag("--to")) : undefined;
const books = flag("--books")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const exclude = new Set(flag("--exclude")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []);
const minBooks = Number(flag("--min-books") ?? 3);

const { games, seasons } = readStoredGames(league, from, to);
const odds = readAllOdds(league).filter((o) => seasons.includes(o.season));
if (!games.length || !odds.length) {
  console.error(`no stored games/odds for ${league}`);
  process.exit(1);
}
const join = joinOdds(games, odds);

type Market = "fullTime" | "regulation" | "moneyline";
interface GameMarket {
  game: GameRecord;
  season: string;
  market: Market;
  lines: Lines;
  /** Winning side. */
  outcome: "home" | "draw" | "away";
  /** De-vigged sharp probability per side (Pinnacle where stored, else the record's consensus). */
  sharp: Record<string, number> | null;
  sharpBook: string;
}

function outcomeOf(g: GameRecord, market: Market): GameMarket["outcome"] {
  if (market === "regulation" && g.decidedInOTorSO) return "draw";
  if (g.homeGoals === g.awayGoals) return "draw";
  return g.homeGoals > g.awayGoals ? "home" : "away";
}

/** The record's own market per book. football-data stores pre-match and closing columns; keep the closing ones (suffix C). */
function mainLines(o: OddsRecord): Lines {
  const out: Lines = {};
  for (const [book, trio] of Object.entries(o.book ?? {})) {
    if (o.source === "football-data") {
      if (!book.endsWith("C")) continue;
      out[book.slice(0, -1)] = { ...trio } as Record<string, number>;
    } else {
      out[book] = { ...trio } as Record<string, number>;
    }
  }
  return out;
}

const markets: GameMarket[] = [];
for (const g of games) {
  const o = join.matched.get(gameKey(g));
  if (!o) continue;
  const main = mainLines(o);
  if (Object.keys(main).length >= minBooks) {
    const market: Market = MAIN_MARKET[LEAGUES[league].sport];
    markets.push({
      game: g,
      season: o.season,
      market,
      lines: main,
      outcome: outcomeOf(g, market),
      sharp: devig({ ...o.sharp } as Record<string, number>, MARKET_SIDES[market]),
      sharpBook: o.sharpBook,
    });
  }
  if (o.moneyline?.book && Object.keys(o.moneyline.book).length >= minBooks) {
    const lines: Lines = {};
    for (const [b, t] of Object.entries(o.moneyline.book)) lines[b] = { ...t };
    markets.push({
      game: g,
      season: o.season,
      market: "moneyline",
      lines,
      outcome: outcomeOf(g, "moneyline"),
      sharp: devig({ ...o.moneyline.sharp } as Record<string, number>, MARKET_SIDES.moneyline),
      sharpBook: o.moneyline.sharpBook,
    });
  }
}

interface Bet {
  season: string;
  market: Market;
  side: string;
  book: string;
  odds: number;
  pCons: number;
  ev: number;
  sharpP: number | null;
  won: boolean;
  ret: number;
}

function simulate(alpha: number): Bet[] {
  const bets: Bet[] = [];
  for (const m of markets) {
    const sides = MARKET_SIDES[m.market];
    const cons = meanOddsConsensus(m.lines, sides, exclude, minBooks);
    if (!cons) continue;
    for (const side of sides) {
      let best: { odds: number; book: string } | null = null;
      for (const [book, o] of Object.entries(m.lines)) {
        if (books && !books.includes(book)) continue;
        if (exclude.has(book)) continue;
        const odds = o[side];
        if (typeof odds === "number" && odds > 1 && (!best || odds > best.odds)) best = { odds, book };
      }
      if (!best || best.odds <= kaunitzThreshold(cons.p[side], alpha)) continue;
      const won = m.outcome === side;
      bets.push({
        season: m.season,
        market: m.market,
        side,
        book: best.book,
        odds: best.odds,
        pCons: cons.p[side],
        ev: kaunitzEv(best.odds, cons.p[side], alpha),
        sharpP: m.sharp ? m.sharp[side] : null,
        won,
        ret: won ? best.odds - 1 : -1,
      });
    }
  }
  return bets;
}

interface Summary {
  n: number;
  hit: number | null;
  expectedHit: number | null;
  meanOdds: number | null;
  pnl: number;
  yield: number | null;
  yieldSe: number | null;
  sharpExpectation: number | null;
}

function summarize(bets: Bet[], alpha: number): Summary {
  const n = bets.length;
  if (!n) return { n: 0, hit: null, expectedHit: null, meanOdds: null, pnl: 0, yield: null, yieldSe: null, sharpExpectation: null };
  const pnl = bets.reduce((s, b) => s + b.ret, 0);
  const y = pnl / n;
  const sd = Math.sqrt(bets.reduce((s, b) => s + (b.ret - y) ** 2, 0) / Math.max(1, n - 1));
  const withSharp = bets.filter((b) => b.sharpP != null);
  return {
    n,
    hit: bets.filter((b) => b.won).length / n,
    expectedHit: bets.reduce((s, b) => s + (b.pCons - alpha), 0) / n,
    meanOdds: bets.reduce((s, b) => s + b.odds, 0) / n,
    pnl,
    yield: y,
    yieldSe: sd / Math.sqrt(n),
    sharpExpectation: withSharp.length
      ? withSharp.reduce((s, b) => s + (b.sharpP! * b.odds - 1), 0) / withSharp.length
      : null,
  };
}

const pct = (x: number | null, d = 1) => (x == null ? "–" : `${(x * 100).toFixed(d)} %`);
const spct = (x: number | null, d = 1) => (x == null ? "–" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)} %`);
const f2 = (x: number | null) => (x == null ? "–" : x.toFixed(2));

function groupBy<K extends string>(bets: Bet[], key: (b: Bet) => K): [K, Bet[]][] {
  const m = new Map<K, Bet[]>();
  for (const b of bets) {
    const k = key(b);
    const list = m.get(k);
    if (list) list.push(b);
    else m.set(k, [b]);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

const sweep = alphas.map((alpha) => {
  const bets = simulate(alpha);
  return { alpha, overall: summarize(bets, alpha), byMarket: groupBy(bets, (b) => b.market).map(([k, v]) => [k, summarize(v, alpha)] as const) };
});
const detailBets = simulate(detailAlpha);

const md: string[] = [];
const bookCount = new Set(markets.flatMap((m) => Object.keys(m.lines))).size;
md.push(`# Outlier rule backtest: ${LEAGUES[league].name}`);
md.push("");
md.push(
  `${games.length} stored games over ${seasons.length} seasons (${seasons[0]}–${seasons[seasons.length - 1]}), ${join.matched.size} with prices, ` +
    `${markets.length} game-markets with at least ${minBooks} books, ${bookCount} distinct books. ` +
    `Candidates: ${books ? books.join(", ") : "every book"}${exclude.size ? `; excluded ${[...exclude].join(", ")}` : ""}. ` +
    `Rule: one flat unit on each (game, side) whose best candidate price exceeds 1 / (p_cons − α), p_cons = 1 / mean odds across the books.`
);
md.push("");
md.push("## α sweep");
md.push("");
md.push("| α | Market | Bets | Hit | Expected hit | Mean odds | P&L | Yield | ± se | Sharp expectation |");
md.push("|---|---|---|---|---|---|---|---|---|---|");
for (const s of sweep) {
  md.push(`| ${s.alpha} | all | ${s.overall.n} | ${pct(s.overall.hit)} | ${pct(s.overall.expectedHit)} | ${f2(s.overall.meanOdds)} | ${s.overall.pnl.toFixed(1)} | ${spct(s.overall.yield)} | ${pct(s.overall.yieldSe)} | ${spct(s.overall.sharpExpectation)} |`);
  for (const [market, m] of s.byMarket) {
    md.push(`| ${s.alpha} | ${market} | ${m.n} | ${pct(m.hit)} | ${pct(m.expectedHit)} | ${f2(m.meanOdds)} | ${m.pnl.toFixed(1)} | ${spct(m.yield)} | ${pct(m.yieldSe)} | ${spct(m.sharpExpectation)} |`);
  }
}
md.push("");
md.push(`Expected hit = mean(p_cons − α) over the bets, the paper's accuracy forecast. Sharp expectation = mean(p_sharp × odds − 1), with p_sharp the de-vigged sharp price stored with the game (${[...new Set(markets.map((m) => m.sharpBook))].join(", ")}): positive means the sharp price also calls the bet value; negative means the outlier is the book's own opinion or a stale line.`);
md.push("");
md.push(`## α = ${detailAlpha} in detail (${detailBets.length} bets)`);
for (const [title, key] of [
  ["By season", (b: Bet) => b.season],
  ["By market and side", (b: Bet) => `${b.market} ${b.side}`],
  ["By book", (b: Bet) => b.book],
] as const) {
  md.push("");
  md.push(`### ${title}`);
  md.push("");
  md.push("| Group | Bets | Hit | Expected hit | Mean odds | P&L | Yield | ± se | Sharp expectation |");
  md.push("|---|---|---|---|---|---|---|---|---|");
  const groups = groupBy(detailBets, key).sort((a, b) => b[1].length - a[1].length);
  for (const [g, v] of groups) {
    const s = summarize(v, detailAlpha);
    md.push(`| ${g} | ${s.n} | ${pct(s.hit)} | ${pct(s.expectedHit)} | ${f2(s.meanOdds)} | ${s.pnl.toFixed(1)} | ${spct(s.yield)} | ${pct(s.yieldSe)} | ${spct(s.sharpExpectation)} |`);
  }
}
md.push("");
const text = md.join("\n") + "\n";

const dir = path.join(process.cwd(), "data", "reports");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
const base = path.join(dir, `outliers-${league}-${stamp}`);
fs.writeFileSync(`${base}.md`, text);
fs.writeFileSync(
  `${base}.json`,
  JSON.stringify({ league, generatedAt: new Date().toISOString(), seasons, candidates: books, exclude: [...exclude], minBooks, sweep, detailAlpha, detailBets }, null, 1)
);
console.log(text);
console.error(`wrote ${base}.md and .json`);
