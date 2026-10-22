/**
 * Morning scan: which games are on today, what the market thinks, and
 * where a Finnish book stands above the consensus by more than the
 * margin (Kaunitz et al. 2017; see docs/MORNING_SCAN.md).
 *
 *   npm run scan                                  # nhl liiga epl ucl, next 36 h
 *   npm run scan -- nhl liiga --hours 24
 *   npm run scan -- --alpha 0.04 --books veikkaus_fi
 *   npm run scan -- --max-age 120                 # reuse a board fetched within 2 h
 *   npm run scan -- --offline                     # never call the API
 *
 * Costs two The Odds API credits per league per fresh fetch (eu + fi
 * regions, one market). Writes data/scans/<date>-<time>.md and .json and
 * prints the Markdown.
 */
import fs from "fs";
import path from "path";
import { loadDotEnv } from "../src/utils/env";
import { fetchLiveBoard, isConfigured, isScanLeague, SCAN_LEAGUES, ScanLeague, FI_BOOKS } from "../src/odds/liveBoard";
import { scanBoard, LeagueScan, Candidate } from "../src/odds/scan";
import { KAUNITZ_ALPHA } from "../src/odds/outliers";

loadDotEnv();

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(name);
const leagues: ScanLeague[] = args.filter(isScanLeague);
if (!leagues.length) leagues.push(...SCAN_LEAGUES);
const alpha = Number(flag("--alpha") ?? KAUNITZ_ALPHA);
const hours = Number(flag("--hours") ?? 36);
const books = (flag("--books") ?? FI_BOOKS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const maxAgeMinutes = Number(flag("--max-age") ?? 30);
const offline = has("--offline");

if (!offline && !isConfigured()) {
  console.error("THE_ODDS_API_KEY is not set (put it in .env); use --offline to read the last cached board");
  process.exit(1);
}

const TZ = "Europe/Helsinki";
const localTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .replace(",", "");
const localDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const pct = (x: number | null | undefined, d = 1) => (x == null ? "–" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)} %`);
const p3 = (x: number | null | undefined) => (x == null ? "–" : (x * 100).toFixed(1));
const o2 = (x: number | null | undefined) => (x == null ? "–" : x.toFixed(2));
const lineOf = (o: Record<string, number> | null | undefined) =>
  !o ? "–" : o.draw != null ? `${o2(o.home)} / ${o2(o.draw)} / ${o2(o.away)}` : `${o2(o.home)} / ${o2(o.away)}`;
const shortBook = (b: string) => b.replace(/_fi$/, "").replace(/_/g, " ");
const marketLabel: Record<string, string> = { fullTime: "1X2", regulation: "1X2 60'", moneyline: "ML" };

function candidateRow(c: Candidate): string {
  return `| ${localTime(c.commence)} | ${c.league.toUpperCase()} | ${c.home} v ${c.away} | ${marketLabel[c.market]} | ${c.pick} | ${shortBook(c.book)} | ${o2(c.odds)} | ${o2(c.meanOdds)} | ${p3(c.pCons)} | ${o2(c.threshold)} | ${pct(c.ev)} | ${pct(c.sharpEdge)} (${c.sharpSource === "pinnacle" ? "Pin" : c.sharpSource ? "med" : "–"}) | ${c.bookOverround == null ? "–" : ((c.bookOverround - 1) * 100).toFixed(1) + " %"} |`;
}

function gameRow(g: LeagueScan["games"][number], books: string[]): string {
  const hockey = g.league === "nhl" || g.league === "liiga";
  const cons = hockey
    ? `${g.pTwo ? `${p3(g.pTwo.home)} / ${p3(g.pTwo.away)}` : "–"} (${g.twoWayBooks}) · ${g.pThree ? `${p3(g.pThree.home)} / ${p3(g.pThree.draw)} / ${p3(g.pThree.away)}` : "–"} (${g.threeWayBooks})`
    : `${g.pThree ? `${p3(g.pThree.home)} / ${p3(g.pThree.draw)} / ${p3(g.pThree.away)}` : "–"} (${g.threeWayBooks})`;
  const fi = books
    .map((b) => {
      const l = g.books[b];
      if (!l) return null;
      const parts = Object.entries(l).map(([m, o]) => `${hockey ? marketLabel[m] + " " : ""}${lineOf(o)}`);
      return `${shortBook(b)} ${parts.join(" · ")}`;
    })
    .filter(Boolean)
    .join("; ");
  const best = g.best ? `${g.best.pick} @ ${shortBook(g.best.book)} ${o2(g.best.odds)} (${pct(g.best.ev)})` : "–";
  return `| ${localTime(g.commence)} | ${g.home} v ${g.away}${g.mapped ? "" : " ⚠"} | ${cons} | ${lineOf(g.pinnacle)} | ${fi || "–"} | ${best} |`;
}

async function main() {
  const scans: LeagueScan[] = [];
  for (const league of leagues) {
    try {
      const board = await fetchLiveBoard(league, { maxAgeMinutes, offline });
      if (!board) {
        console.error(`${league}: no cached board (offline)`);
        continue;
      }
      scans.push(scanBoard(board, { alpha, books, hours }));
    } catch (e) {
      console.error(`${league}: ${(e as Error).message}`);
    }
  }
  if (!scans.length) process.exit(1);

  const now = new Date();
  const stamp = `${localDay(now.toISOString()).replace(/-/g, "")}-${new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(":", "")}`;
  const all = scans.flatMap((s) => s.candidates).sort((a, b) => b.ev - a.ev);
  const credits = scans.map((s) => s.creditsLeft).filter((x): x is number => x != null);
  const lines: string[] = [];
  lines.push(`# Morning scan ${localDay(now.toISOString())} ${localTime(now.toISOString())} (Helsinki)`);
  lines.push("");
  lines.push(
    `Rule: bet when a book's odds exceed 1 / (p_cons − α) with α = ${alpha}, p_cons = 1 / mean odds of the other books (Kaunitz et al. 2017). ` +
      `Books checked: ${books.map(shortBook).join(", ")}. Games starting within ${hours} h. ` +
      `${credits.length ? `The Odds API credits left: ${Math.min(...credits)}.` : ""}`
  );
  lines.push("");
  lines.push(`## Candidates (${all.length})`);
  lines.push("");
  if (all.length) {
    lines.push("| Kickoff | League | Game | Market | Pick | Book | Odds | Mean odds | p_cons % | Must beat | EV (α) | Sharp edge | Book margin |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const c of all) lines.push(candidateRow(c));
  } else {
    lines.push("No book clears the threshold on any game in the window.");
  }
  for (const s of scans) {
    lines.push("");
    lines.push(`## ${s.league.toUpperCase()}: ${s.games.length} game${s.games.length === 1 ? "" : "s"} (board ${s.cached ? "cached " : "fetched "}${localTime(s.fetchedAt)})`);
    lines.push("");
    if (s.unmatched.length) lines.push(`Unmapped team names: ${s.unmatched.join(", ")} (add them to src/odds/liveBoard.ts or oddspapiAliases.ts).`);
    if (!s.games.length) {
      lines.push("No games in the window.");
      continue;
    }
    const hockey = s.league === "nhl" || s.league === "liiga";
    lines.push(`| Kickoff | Game | Consensus p % ${hockey ? "ML (books) · 1X2 60' (books)" : "1X2 (books)"} | Pinnacle | Finnish books | Best value |`);
    lines.push("|---|---|---|---|---|---|");
    for (const g of s.games) lines.push(gameRow(g, s.books));
  }
  lines.push("");
  lines.push("Sharp edge: de-vigged Pinnacle probability × odds − 1 (Pin), or the de-vigged median of the other books (med) where Pinnacle does not quote the market. Book margin: the candidate book's overround on the market.");
  const md = lines.join("\n") + "\n";

  const dir = path.join(process.cwd(), "data", "scans");
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `scan-${stamp}`);
  fs.writeFileSync(`${base}.md`, md);
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify({ generatedAt: now.toISOString(), alpha, books, hours, leagues: scans }, null, 1)
  );
  console.log(md);
  console.error(`wrote ${base}.md and .json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
