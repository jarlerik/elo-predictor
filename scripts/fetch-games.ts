/**
 * Store played games per season under data/games/<league>/<season>.json so
 * backtests run offline and identically from one run to the next.
 *
 *   npm run games:fetch -- epl 2012 2026            # start years, inclusive
 *   npm run games:fetch -- epl 2012 2026 --verify   # also cross-check scores with the odds files
 *   npm run games:fetch -- epl 2026 --refresh
 *
 * EPL: fixturedownload.com covers 2016-17 onwards; earlier seasons are
 * derived from the football-data odds files (which carry the results), so
 * `npm run odds:fetch` must have stored them first. NHL: the stats API,
 * regular season and playoffs (preseason dropped). Liiga: liiga.fi, regular
 * season only. --verify compares the games with the odds files on every
 * season that has both and fails on any score mismatch.
 */
import {
  currentStartYear,
  fetchSeasonFromFeed,
  gamesFromOdds,
  readGameSeason,
  writeGameSeason,
  GameSeasonFile,
} from "../src/data/gameStore";
import { readOddsSeason, seasonLabelFor, joinOdds, gameKey } from "../src/odds/store";
import { LeagueId, isLeagueId } from "../src/utils/leagues";

const args = process.argv.slice(2);
const has = (name: string) => args.includes(name);
const positional = args.filter((a) => !a.startsWith("--"));
const league: LeagueId = isLeagueId(positional[0]) ? positional[0] : "epl";
const thisSeason = currentStartYear(league);
const from = Number(positional[1]) || thisSeason - 2;
const to = Number(positional[2]) || (Number(positional[1]) ? from : thisSeason);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;

for (let y = from; y <= to; y++) {
  const season = seasonLabelFor(league, y);
  const stored = readGameSeason(league, season);
  const stale =
    !stored ||
    has("--refresh") ||
    (!stored.complete && Date.now() - new Date(stored.fetchedAt).getTime() > 24 * 3600 * 1000);
  let file: GameSeasonFile | null = stale ? null : stored;

  if (!file) {
    const unknown = new Set<string>();
    let fromFeed: GameSeasonFile | null = null;
    try {
      fromFeed = await fetchSeasonFromFeed(league, y, (n) => unknown.add(n));
    } catch (e) {
      console.log(`${season}: feed unavailable (${(e as Error).message.slice(0, 60)})`);
    }
    if (unknown.size) {
      console.error(`${season}: UNKNOWN team names in the fixture feed: ${[...unknown].join(" | ")} (add to the league's team table)`);
      failed = true;
      continue;
    }
    if (fromFeed) {
      file = fromFeed;
    } else {
      const odds = readOddsSeason(league, season);
      if (!odds) {
        console.error(`${season}: no fixture feed and no odds file to derive from; run npm run odds:fetch -- epl ${y}`);
        failed = true;
        continue;
      }
      const games = gamesFromOdds(league, y, odds.records);
      const teams = new Set<string>();
      for (const g of games) {
        teams.add(g.homeAbbr);
        teams.add(g.awayAbbr);
      }
      file = {
        fetchedAt: new Date().toISOString(),
        source: "football-data",
        complete: odds.complete,
        games,
        currentTeams: [...teams],
      };
    }
    writeGameSeason(league, season, file);
    if (y < to) await sleep(1000);
  }

  const teams = new Set(file.currentTeams).size;
  console.log(
    `${season}: ${file.games.length} games, ${teams} teams, source ${file.source}` +
      (file.complete ? "" : " [in progress]") +
      (stale ? "" : " (cached)")
  );

  if (has("--verify")) {
    const odds = readOddsSeason(league, season);
    if (!odds) {
      console.log("  verify: no odds file");
      continue;
    }
    const join = joinOdds(file.games, odds.records);
    let mismatches = 0;
    for (const g of file.games) {
      const o = join.matched.get(gameKey(g));
      if (!o?.result) continue;
      if (o.result.homeGoals !== g.homeGoals || o.result.awayGoals !== g.awayGoals) {
        mismatches++;
        if (mismatches <= 5)
          console.log(`  score mismatch ${g.date.slice(0, 10)} ${g.homeAbbr}-${g.awayAbbr}: feed ${g.homeGoals}-${g.awayGoals}, odds ${o.result.homeGoals}-${o.result.awayGoals}`);
      }
    }
    const unmatched = join.unmatchedGames.length;
    console.log(
      `  verify: ${join.matched.size}/${file.games.length} joined, ${unmatched} games without odds, ` +
        `${join.unmatchedOdds.length} odds rows without a game, ${mismatches} score mismatches` +
        (join.duplicates.length ? `, duplicates ${join.duplicates.join(", ")}` : "")
    );
    if (unmatched > 5)
      for (const g of join.unmatchedGames.slice(0, 5))
        console.log(`    no odds: ${g.date.slice(0, 10)} ${g.homeAbbr}-${g.awayAbbr}`);
    if (mismatches > 0 || join.duplicates.length) failed = true;
  }
}
if (failed) process.exit(1);
