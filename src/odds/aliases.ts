/**
 * Team names as odds providers spell them, mapped to the app's codes.
 *
 * Exact match only. A name that is not in the table is returned as null
 * and reported by the caller; nothing is guessed, because a wrong code
 * silently joins a game to the wrong odds.
 */
import { LeagueId, EPL_TEAMS, LIIGA_TEAMS, NBA_TEAMS } from "../utils/leagues";
import { CURRENT_NHL_TEAMS } from "../utils/teamData";

/** football-data.co.uk spellings that differ from the fixture feed's. */
const FOOTBALL_DATA_EPL: Record<string, string> = {
  "Man United": "MUN",
  Tottenham: "TOT",
  "Sheffield United": "SHU",
};

function reverse(teams: Record<string, { apiName: string }>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [abbr, t] of Object.entries(teams)) m.set(t.apiName, abbr);
  return m;
}

const EPL_ALIASES: Map<string, string> = (() => {
  const m = reverse(EPL_TEAMS);
  for (const [name, abbr] of Object.entries(FOOTBALL_DATA_EPL)) m.set(name, abbr);
  return m;
})();

const LIIGA_ALIASES: Map<string, string> = reverse(LIIGA_TEAMS);
const NBA_ALIASES: Map<string, string> = reverse(NBA_TEAMS);

/**
 * Codes must not collide across leagues, since inferLeague picks the league
 * from them. The one allowed overlap is NBA with NHL (BOS, CHI, DAL, DET,
 * MIN, PHI, TOR, UTA): the two leagues share city tri-codes, and a bet on
 * either always names its league.
 */
for (const code of Object.keys(EPL_TEAMS)) {
  if (CURRENT_NHL_TEAMS.has(code) || code in LIIGA_TEAMS || code in NBA_TEAMS) {
    throw new Error(`team code ${code} is used by more than one league`);
  }
}
for (const code of Object.keys(NBA_TEAMS)) {
  if (code in LIIGA_TEAMS) throw new Error(`team code ${code} is used by more than one league`);
}

/** App code for a provider's team name, or null when unknown. */
export function resolveAbbr(league: LeagueId, name: string): string | null {
  const key = name.trim();
  switch (league) {
    case "epl":
      return EPL_ALIASES.get(key) ?? null;
    case "liiga":
      return LIIGA_ALIASES.get(key) ?? null;
    case "nhl":
      return CURRENT_NHL_TEAMS.has(key) ? key : null;
    case "nba":
      return NBA_ALIASES.get(key) ?? null;
  }
}
