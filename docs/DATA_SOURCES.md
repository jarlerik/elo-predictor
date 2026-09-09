# Data sources and refresh procedures

This app mixes two kinds of data:

- **Live game history** (NHL, SM-liiga, Premier League): pulled from public
  feeds at runtime, Elo computed from scratch on every load. Nothing to
  maintain except the team tables when the league's membership changes.
- **Seeded ratings** (Champions League, World Cup): a JSON file in `data/`
  that a person refreshes by hand. The Champions League seed is additionally
  updated at runtime with played games; the World Cup seed is used as-is.

All runtime data is cached in memory and re-fetched every **6 hours**
(`REFRESH_MS` in `src/data/leagueData.ts` and `src/data/uclFetcher.ts`).
Restarting the server also forces a refresh. If a refresh fails, the previous
in-memory data keeps being served and the error is logged.

## Summary

| Competition      | Source                                  | Seasons               | Automatic refresh | Manual upkeep                                                      |
| ---------------- | --------------------------------------- | --------------------- | ----------------- | ------------------------------------------------------------------ |
| NHL              | `api.nhle.com` stats API                | 2 previous + current  | every 6 h         | `CURRENT_NHL_TEAMS` / `NHL_TEAM_NAMES` on expansion or rename       |
| SM-liiga         | `liiga.fi/api/v2/games`                 | 2 previous + current  | every 6 h         | `LIIGA_TEAMS` when a club joins or is renamed                       |
| Premier League   | `fixturedownload.com/feed/json/epl-*`   | 2 previous + current  | every 6 h         | `EPL_TEAMS` when a promoted club is missing                         |
| Champions League | `data/ucl/ratings.json` + `fixturedownload.com/feed/json/champions-league-*` | current | games every 6 h | seed + `UCL_TEAMS` once per season                        |
| World Cup        | `data/soccer/ratings.json`              | —                     | none              | seed before and during the tournament                               |

Team tables live in `src/utils/leagues.ts` (Liiga, EPL, UCL) and
`src/utils/teamData.ts` (NHL). Codes must be unique across every league
because `TEAM_FULL_NAMES` merges them into one lookup, and they should avoid
the FIFA country codes in `src/utils/soccerTeams.ts` so saved bets never show
the wrong name.

## NHL

- **Endpoint:** `https://api.nhle.com/stats/rest/en/game?cayenneExp=season=<id>&limit=-1`
  plus `https://api.nhle.com/stats/rest/en/team` for id → tri-code mapping.
- **Season id:** `YYYY(YYYY+1)`, e.g. `20262027`. Computed from the date in
  `nhlSeasonFor()`: July onwards belongs to the season starting that year.
- **Played-game filter:** only `gameStateId` 6 (final) or 7 (official final)
  count. The feed includes the whole schedule with 0-0 placeholders.
- **OT / shootout:** `period` 4 = overtime, 5 = shootout. These games are
  down-weighted (`otFactor` 0.75) and count as regulation-time draws when the
  hockey 1X2 draw factor is fitted (`fitDrawFactor`). `gameType` is *not* the OT flag; it is
  1 preseason / 2 regular season / 3 playoffs.
- **Upkeep:** the tri-code set in `CURRENT_NHL_TEAMS` decides which teams are
  returned. Update it and `NHL_TEAM_NAMES` when the league expands or a
  franchise changes its tri-code. A franchise that keeps its tri-code but gets
  a new API id (Utah Hockey Club → Utah Mammoth) is merged automatically, since
  Elo is keyed by code.

## SM-liiga

- **Endpoint:** `https://liiga.fi/api/v2/games?tournament=runkosarja&season=<id>`
  (regular season only; playoffs are not fetched).
- **Season id:** the year the season **ends** in: `2027` = 2026-27. Computed in
  `liigaSeasonFor()`.
- **Played-game filter:** `ended === true`. `finishedType`
  `ENDED_DURING_EXTENDED_GAME_TIME` and `ENDED_DURING_WINNING_SHOT_COMPETITION`
  mark OT / shootout.
- **Current roster:** derived from the newest season's schedule, so promoted
  or new clubs (Jokerit in 2026-27) appear without code changes, as long as
  they are in `LIIGA_TEAMS`. An unknown `teamName` is logged as a warning and
  given a code derived from its `teamId` slug; add it to `LIIGA_TEAMS` to get
  a proper name.

## Premier League

- **Endpoint:** `https://fixturedownload.com/feed/json/epl-<start year>`,
  e.g. `epl-2026` = 2026-27. No API key. Computed in `eplSeasonFor()`.
- **Played-game filter:** `HomeTeamScore` and `AwayTeamScore` not null.
- **Current roster:** derived from the newest season's fixtures. Promoted
  clubs with no history in the fetched seasons start at the 1500 average and
  converge as they play.
- **Upkeep:** if a promoted club is missing from `EPL_TEAMS` the server logs
  `epl: unknown team "<name>"` and uses the first three letters. Add the club
  with the exact `HomeTeam` string from the feed as `apiName`.
- **Fallbacks considered:** football-data.co.uk CSVs and the clubelo API
  were both unavailable when this was built (September 2026); the
  openfootball GitHub JSON lags a round or two behind fixturedownload.

## Champions League

Clubs come from ~15 domestic leagues and play only 8 league-phase games, so
an Elo computed from Champions League games alone cannot calibrate leagues
against each other. Instead:

1. **Seed** `data/ucl/ratings.json` with cross-league ratings from
   clubelo.com, keyed by the codes in `UCL_TEAMS`.
2. At runtime, **apply Elo updates** for every played Champions League game
   from `https://fixturedownload.com/feed/json/champions-league-<start year>`
   on top of the seed (`src/data/uclFetcher.ts`, using
   `computeElosFromGames` with `initialElos`).

`GET /api/ucl/teams` shows `seedElo`, current `elo` and `played` per club, and
the seed date, so you can see how far ratings have drifted from the seed.

### Refreshing the Champions League seed (once per season)

Do this after the draw, before the league phase starts, so no game is
counted twice (once in the seed, once as a live update).

1. Get the participant list. The fixture feed is the reference:
   `https://fixturedownload.com/feed/json/champions-league-<year>`; every
   distinct `HomeTeam` / `AwayTeam` string must map to a code.
2. Update `UCL_TEAMS` in `src/utils/leagues.ts`: add new clubs (with the
   feed's exact string as `apiName`), remove clubs that dropped out, keep the
   English clubs' EPL codes.
3. Get clubelo ratings. The JSON API `http://api.clubelo.com/<YYYY-MM-DD>`
   returns a CSV (`Rank,Club,Country,Level,Elo,From,To`) when it is up. If
   it is down (it was in September 2026), the website still works: the
   homepage lists the top 50 and `https://clubelo.com/<CC>` (e.g. `/GER`)
   lists each country. Ratings are embedded in the page as a JavaScript
   `eloData` array containing the club slug, name and Elo.
4. Write `data/ucl/ratings.json` with `_refreshed` set to the date of the
   ratings and every code from `UCL_TEAMS` present. Restart the server.

Mid-season the seed should **not** be refreshed: doing so would double count
games already applied as live updates. Refresh only if the seed was wrong.

### Knockout rounds

The feed also contains the knockout phase. Each leg is treated as a normal
home game with home advantage; the neutral-venue and no-draw toggles on the
Champions League page exist for the final.

## World Cup

- **File:** `data/soccer/ratings.json`, keyed by FIFA code, seeded from
  https://www.eloratings.net. Names for the codes live in
  `src/utils/soccerTeams.ts`.
- **No automatic updates.** National teams play too rarely for a history
  model, and the seed is not updated with results.
- **Refresh:** before the tournament and ideally after each match day, since
  eloratings.net updates after every match. Copy the new values, bump the
  date in `_comment`, restart the server (`loadSoccerRatings` caches the file
  for the process lifetime).
- **Adding a team:** add the code to both the ratings file and
  `COUNTRY_NAMES`.

## Model constants worth knowing

| Constant             | Where                        | Value | Meaning                                                      |
| -------------------- | ---------------------------- | ----- | ------------------------------------------------------------ |
| `HOME_ADV`           | `src/elo/calculator.ts`      | 60    | Elo points added to the home side when computing ratings     |
| `SOCCER_DRAW_FACTOR` | `src/elo/probabilities.ts`   | 0.6   | Davidson draw parameter, ~23 % draws at parity               |
| `SOCCER_BASE_TOTAL`  | `src/score/soccerGoals.ts`   | 2.6   | Expected total goals used for seeded soccer correct scores   |
| `REFRESH_MS`         | `src/data/*`                 | 6 h   | Runtime cache lifetime for fetched results                   |
