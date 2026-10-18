/**
 * Fetch historical bookmaker odds into data/odds/<league>/<season>.json.
 *
 *   npm run odds:fetch                       # epl, last three seasons
 *   npm run odds:fetch -- epl 2012 2026      # start years, inclusive
 *   npm run odds:fetch -- epl 2024 --refresh # refetch even if stored
 *   npm run odds:fetch -- epl --file E0.csv --season 2024   # hand-downloaded CSV
 *
 * Completed seasons are never refetched; the current season is refetched
 * when its file is older than a day. Team names the alias table cannot
 * place are printed so src/odds/aliases.ts can be extended; nothing is
 * guessed.
 */
import { importSeasonFile } from "../src/odds/footballData";
import { historicalProviderFor } from "../src/odds";
import { readOddsSeason, seasonLabelFor, joinOdds } from "../src/odds/store";
import { readGameSeason } from "../src/data/gameStore";
import { LeagueId, isLeagueId } from "../src/utils/leagues";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(name);
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const league: LeagueId = isLeagueId(positional[0]) ? positional[0] : "epl";
const thisSeason = new Date().getUTCMonth() >= 6 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
const from = Number(positional[1]) || thisSeason - 2;
const to = Number(positional[2]) || (Number(positional[1]) ? from : thisSeason);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function report(startYear: number) {
  const season = seasonLabelFor(league, startYear);
  const file = readOddsSeason(league, season);
  if (!file) return;
  const books = new Map<string, number>();
  for (const r of file.records) books.set(r.sharpBook, (books.get(r.sharpBook) ?? 0) + 1);
  const withMax = file.records.filter((r) => r.max).length;
  console.log(
    `${season}: ${file.records.length} rows (sharp: ${[...books].map(([k, v]) => `${k} ${v}`).join(", ")}; ` +
      `max close ${withMax}), skipped no-result ${file.skipped?.noResult ?? 0}, no-sharp ${file.skipped?.noSharp ?? 0}` +
      (file.complete ? "" : " [in progress]")
  );
  if (file.unmatched.length) {
    const names = new Set<string>();
    for (const u of file.unmatched) {
      names.add(u.home);
      names.add(u.away);
    }
    console.log(`  UNMATCHED team names (${file.unmatched.length} rows): ${[...names].join(" | ")}`);
  }
  const games = readGameSeason(league, season);
  if (games) {
    const join = joinOdds(games.games, file.records);
    console.log(
      `  join vs data/games: ${join.matched.size}/${games.games.length} games matched, ` +
        `${join.unmatchedOdds.length} odds rows unmatched` +
        (join.duplicates.length ? `, duplicates: ${join.duplicates.join(", ")}` : "")
    );
  }
}

if (has("--file")) {
  const path = flag("--file")!;
  const startYear = Number(flag("--season"));
  if (!startYear) throw new Error("--file needs --season <start year>");
  importSeasonFile(path, league, startYear);
  report(startYear);
} else {
  const provider = historicalProviderFor(league);
  if (!provider) {
    console.error(`no historical odds provider for ${league}`);
    process.exit(1);
  }
  for (let y = from; y <= to; y++) {
    const before = readOddsSeason(league, seasonLabelFor(league, y));
    await provider.fetchSeason(league, y, { force: has("--refresh") });
    report(y);
    const after = readOddsSeason(league, seasonLabelFor(league, y));
    const fetched = !before || after?.fetchedAt !== before.fetchedAt;
    if (fetched && y < to) await sleep(3000);
  }
}
