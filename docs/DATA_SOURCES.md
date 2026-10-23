# Data sources and refresh procedures

This app mixes two kinds of data:

- **Live game history** (NHL, SM-liiga, Premier League, NBA): pulled from public
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
| NBA              | `fixturedownload.com/feed/json/nba-*`   | 2 previous + current  | every 6 h         | `NBA_TEAMS` when a franchise moves or is renamed                    |
| Champions League | `data/ucl/ratings.json` + `fixturedownload.com/feed/json/champions-league-*` | current | games every 6 h | seed + `UCL_TEAMS` once per season                        |
| World Cup        | `data/soccer/ratings.json`              | —                     | none              | seed before and during the tournament                               |
| EPL odds history | `football-data.co.uk/mmz4281/<yy><yy>/E0.csv` → `data/odds/epl/` | 2012-13 onwards | `npm run odds:fetch` (current season refetched after a day) | extend `src/odds/aliases.ts` when a club name is reported unmatched |
| EPL game history | `data/games/epl/` from fixturedownload (2016-17+) or the odds files (older) | 2012-13 onwards | `npm run games:fetch` | none |
| NHL / Liiga / NBA odds history | The Odds API daily snapshots → `data/odds/<league>/` | NHL 2020-21+, Liiga March 2025+, NBA not fetched yet | `npm run odds:fetch -- nhl\|liiga\|nba` (needs `THE_ODDS_API_KEY`) | none |
| NHL / Liiga game history | `data/games/<league>/` from the league APIs | 2019-20 onwards | `npm run games:fetch -- nhl\|liiga` | none |
| NBA game history | `data/games/nba/` from fixturedownload | 2018-19 onwards | `npm run games:fetch -- nba` | none |

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
- **Spelling drift:** the feed wrote "Nottingham Forest" in 2022-23 and
  2023-24 and "Nott'm Forest" otherwise; `eplFetcher.ts` carries that alias.
- **Older seasons:** the feed starts at 2016-17 (404 before). The backtest
  derives 2012-13 to 2015-16 from the football-data odds files, which carry
  the results; `npm run games:fetch -- epl 2012 2026 --verify` cross-checks
  every score on the seasons both sources cover.

## NBA

- **Endpoint:** `https://fixturedownload.com/feed/json/nba-<season start year>`
  (`nba-2026` = 2026-27), the same free feed as the EPL. Regular season
  only: 1,230 games plus the NBA Cup final; the playoffs are not in the
  feed. Seasons 2018-19 onwards are served (checked 2026-10-23; 2017-18
  is not). Provider: `src/data/nbaFetcher.ts`.
- **Season id:** `YYYY(YYYY+1)` as for the NHL; `nbaSeasonFor()` puts July
  onwards in the season starting that year.
- **Played-game filter:** null scores are the schedule. NBA Cup knockout
  games are listed as "To be announced" v "To be announced" until the
  teams are known and are skipped until then. A basketball game cannot
  end level, so `decidedInOTorSO` is always false, the draw factor is
  zero and the only market is the winner including overtime
  (`moneyline`); `npm run bet` refuses any other market for the NBA.
- **Elo:** K scales with the points margin in FiveThirtyEight's form,
  (margin + 3)^0.8 / (7.5 + 0.006 × winner's rating edge)
  (`marginMode: "points"` in `src/elo/calculator.ts`). On the stored
  games, scored from 2020-21 after two burn-in seasons with no age
  weighting (7,248 games), K 20 and home advantage 40 give log loss 0.626
  against 0.633 for the goal-margin form and 0.632 with no margin term;
  40 Elo points match the observed 55 % home-win rate, well under
  FiveThirtyEight's 100 from the years when home court was worth more.
  Values in `LEAGUES.nba`; no market backtest yet, since no prices are
  stored.
- **Upkeep:** `NBA_TEAMS` when a franchise moves or is renamed. Eight
  codes are NHL tri-codes too (BOS, CHI, DAL, DET, MIN, PHI, TOR, UTA),
  so a bet always names its league and `inferLeague` returns null for a
  pair that fits both.

## Premier League odds history (football-data.co.uk)

- **Endpoint:** `https://football-data.co.uk/mmz4281/<yy><yy+1>/E0.csv`,
  e.g. `mmz4281/2425/E0.csv` = 2024-25. No key. The `www.` host redirects to
  the bare one; the server rate-limits (HTTP 429 seen), so completed seasons
  are fetched once into `data/odds/epl/<season>.json` and committed. Parser
  and provider: `src/odds/footballData.ts`; store and join: `src/odds/store.ts`.
- **Columns used:** `Date` (dd/mm/yy up to 2014-15 and in 2016-17, dd/mm/yyyy
  otherwise), `Time` (UK, from 2019-20), `FTHG/FTAG`, Pinnacle pre-match
  `PSH/PSD/PSA` and close `PSCH/PSCD/PSCA`, Betfair Exchange close
  `BFECH/BFECD/BFECA`, market average and best close `AvgC*`/`MaxC*`
  (from 2019-20; older files only have Betbrain pre-match `BbAv*`/`BbMx*`),
  plus Bet365, bwin, William Hill and 1xBet pre-match and close.
- **Sharp reference:** Pinnacle close where present. football-data stopped
  carrying Pinnacle in mid-January 2026, so later rows use the Betfair
  Exchange close and, failing that, the market average close; each row's
  `sharpBook` says which, and the reports show the mix.
- **Team names:** exact match against `EPL_TEAMS.apiName` plus the
  football-data spellings in `src/odds/aliases.ts` ("Man United",
  "Tottenham", "Sheffield United"). Unknown names are printed by
  `npm run odds:fetch`, never guessed.
- **Commands:** `npm run odds:fetch -- epl 2012 2026`, `--refresh` to refetch,
  `--file E0.csv --season 2024` to import a hand-downloaded file.

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

`ensureUcl()` in `src/data/uclFetcher.ts` returns `seedElo`, current `elo`
and `played` per club and the seed date, so drift from the seed can be checked.

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

## Hockey and NBA odds history (The Odds API)

- **Endpoint:** `GET https://api.the-odds-api.com/v4/historical/sports/<sport>/odds?regions=eu&markets=h2h&date=<ISO>`
  with `icehockey_nhl`, `icehockey_liiga` or `basketball_nba`, one call
  per game day at ten minutes before the day's first tip-off. Returns every event not yet
  started at that snapshot with each bookmaker's head-to-head prices.
  Provider: `src/odds/theOddsApi.ts`.
- **Cost:** 10 credits per call (per market and region). A season is about
  1,500 (Liiga) to 1,800 (NHL) credits; the paid 20K plan ($30 a month)
  covers several seasons. The provider stops at 300 credits left. Raw
  snapshots are kept under `data/odds/raw/the-odds-api/` (ignored) so a
  rerun or a reparse costs nothing; the parsed season files are committed.
- **Markets:** Pinnacle prices only the two-way winner incl. OT/SO here, so
  it anchors the `moneyline` field. The 60-minute 1X2 (the record's own
  market, `regulation`) has no Pinnacle price: its sharp reference is the
  median of the de-vigged probabilities of the European books that carry a
  Draw (`sharpBook: "consensus"`, 6–13 books on an NHL day, about 10 on a
  Liiga day), with their average and best closing prices alongside. The
  `h2h_3_way` market key exists only on the per-event endpoint at the same
  cost per game and was not worth it.
- **Coverage (checked 2026-10-18):** NHL from the 2020 restart, Liiga from
  March 2025. Days before `ARCHIVE_START` in the provider are skipped.
- **NBA:** no draw line, so the record's own market is the two-way
  `moneyline` with Pinnacle as the sharp price (the books' mean
  probability when Pinnacle is absent) and no `regulation` trio. The live
  board was checked on 2026-10-23 (28 books on a game, full club names,
  "LA Clippers"); the archive has not been fetched, so its start
  (`ARCHIVE_START` June 2020, the provider's own) is unverified. A season
  is about 165 game days, so about 1,700 credits.
- **Team names:** NHL names folded (accents and dots dropped) against
  `NHL_TEAM_NAMES` plus "St Louis Blues", "Montréal Canadiens", "Arizona
  Coyotes", "Utah Hockey Club"; Liiga uses the short club names that match
  `LIIGA_TEAMS.apiName`, with the OddsPapi alias table as fallback.
- **Game history:** `npm run games:fetch -- nhl 2020 2026` stores regular
  season and playoffs (preseason, All-Star, 4 Nations and Olympic games are
  dropped by game type; the live NHL fetcher drops them too since this
  change). Liiga stores the regular season only. Liiga game ids repeat
  across seasons, so joins key on season and id together.
- **Key:** `THE_ODDS_API_KEY` in `.env`. Subscribe for a month, pull, cancel.

## OddsPapi (live sharp prices)

Pinnacle's prices for upcoming games, attached to bets by `npm run bet`
when no `--sharp` list is given, and its last price before kickoff, written
into the ledger as the sharp close. This
is the live side of the odds layer; the market backtest uses the
football-data.co.uk files instead.

- **Key:** `ODDSPAPI_API_KEY` in `.env` (gitignored; the scripts read it).
  Optional `ODDSPAPI_BASE_URL`. Without a key every call is a no-op and a
  bet gets a sharp price only from the scan or `--sharp`.
- **Client:** `src/odds/oddspapi.ts`; team-name tables in
  `src/odds/oddspapiAliases.ts` (exact match; unknown names are reported,
  never guessed).
- **Endpoints used** (base `https://api.oddspapi.io`, `apiKey` query param;
  https://oddspapi.io/en/docs):
  `/v4/tournaments?sportId=` (once per sport, cached in
  `data/odds/oddspapi/tournaments-<sportId>.json`), `/v4/fixtures?tournamentId=&from=&to=`
  (kickoff ±1 day), `/v4/odds?fixtureId=&bookmakers=pinnacle` (live),
  `/v4/historical-odds?fixtureId=&bookmakers=pinnacle` (price history, free),
  `/v4/account` (usage, unmetered).
- **Ids:** soccer sport 10, ice hockey 15, basketball 11; EPL tournament
  17, NHL 234, NBA 132; Pinnacle slug `pinnacle`; soccer "Full Time
  Result" market 101 (outcomes 101/102/103); hockey "Regular Time Result"
  153 (153/154/155) and "Winner (incl. overtime and penalties)" 151
  (151/152); basketball full-game moneyline 111 (111 home, 112 away,
  checked with a live call on 2026-10-23, three requests). Liiga and
  Champions League tournament ids are looked up by slug at first use.
- **Budget:** the free tier is 250 requests a month; every billable call
  increments `data/odds/oddspapi/budget.json` (`{month, used}`). Above 200
  the client refuses unless forced, so a loop cannot burn the month.
  `/v4/historical-odds` is free and not counted. `npm run odds:budget`
  prints both the local counter and the account's own count.
- **Cache:** live prices 15 minutes in memory; per game
  `data/odds/oddspapi/<league>/<YYYY-MM-DD>_<HOME>_<AWAY>.json` keeps the
  fixture id and the closing prices for good (gitignored).
- **Scripts:** `npm run bet` calls `fetchSharpOdds` (one billable fixture
  lookup plus one odds call) for a bet logged without `--sharp` and outside
  the scan. `npm run odds:close [-- --dry-run] [-- --max N]` fills
  `sharpClosingOdds` on played ledger lines (one billable fixture lookup
  per game) and the matching prediction-log row.
- **Unverified** (no example in the public docs): the Liiga and Champions
  League tournament ids and slugs, OddsPapi's Liiga club spellings, the
  hockey market ids (taken from the OddsPapi NHL blog post, not the
  reference), and the exact leaf shape of `/v4/odds` (the parser accepts
  `price` directly or under `players["0"]`). The first real call for each
  league confirms them; unmatched names are printed by `odds:close`.

## Model constants worth knowing

| Constant             | Where                        | Value | Meaning                                                      |
| -------------------- | ---------------------------- | ----- | ------------------------------------------------------------ |
| `HOME_ADV`           | `src/elo/calculator.ts`      | 60    | Elo points added to the home side when computing ratings     |
| `SOCCER_DRAW_FACTOR` | `src/elo/probabilities.ts`   | 0.6   | Davidson draw parameter, ~23 % draws at parity               |
| `SOCCER_BASE_TOTAL`  | `src/score/soccerGoals.ts`   | 2.6   | Expected total goals used for seeded soccer correct scores   |
| `REFRESH_MS`         | `src/data/*`                 | 6 h   | Runtime cache lifetime for fetched results                   |
