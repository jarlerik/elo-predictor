// League registry shared by the server (data fetching, routes) and the client
// (navigation, labels). Team tables map the app's short codes to the full
// display name and the exact team name used by the upstream data source.

export type LeagueId = "nhl" | "liiga" | "epl";
export type Sport = "hockey" | "soccer";

export interface LeagueInfo {
  id: LeagueId;
  name: string;
  shortName: string;
  sport: Sport;
  icon: string;
  homeLabel: string;
  awayLabel: string;
  /**
   * Elo points added to the home team. Fitted per league on the backtest
   * with `npm run fit:homeadv` (lowest 1X2 log loss, predicted home-win
   * rate equal to the observed one). NHL: 35 (September 2026, 3,038
   * games on a 5-point grid; 60 over-predicted home wins by two points).
   * Liiga: 60 is the optimum (983 games). EPL: 45 (790 games; log loss is
   * flat from 35 to 60 and 45 matches the observed home-win rate). All
   * fitted with the draw factor fitted from the same history.
   */
  homeAdv: number;
}

export const LEAGUES: Record<LeagueId, LeagueInfo> = {
  nhl: {
    id: "nhl",
    name: "NHL",
    shortName: "NHL",
    sport: "hockey",
    icon: "🏒",
    homeLabel: "Home Team",
    awayLabel: "Away Team",
    homeAdv: 35,
  },
  liiga: {
    id: "liiga",
    name: "SM-liiga",
    shortName: "Liiga",
    sport: "hockey",
    icon: "🇫🇮",
    homeLabel: "Home Team",
    awayLabel: "Away Team",
    homeAdv: 60,
  },
  epl: {
    id: "epl",
    name: "Premier League",
    shortName: "EPL",
    sport: "soccer",
    icon: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    homeLabel: "Home Team",
    awayLabel: "Away Team",
    homeAdv: 45,
  },
};

export const LEAGUE_IDS = Object.keys(LEAGUES) as LeagueId[];

export function isLeagueId(value: unknown): value is LeagueId {
  return typeof value === "string" && value in LEAGUES;
}

export interface LeagueTeam {
  name: string; // display name
  apiName: string; // name as returned by the upstream data source
}

// Liiga (Finnish top hockey league). apiName = `homeTeam.teamName` from
// https://liiga.fi/api/v2/games. Includes teams from recent seasons so
// historical games resolve; the current roster is derived from the schedule.
export const LIIGA_TEAMS: Record<string, LeagueTeam> = {
  HIFK: { name: "HIFK Helsinki", apiName: "HIFK" },
  HPK: { name: "HPK Hämeenlinna", apiName: "HPK" },
  ILV: { name: "Ilves Tampere", apiName: "Ilves" },
  JYP: { name: "JYP Jyväskylä", apiName: "JYP" },
  JOK: { name: "Jokerit Helsinki", apiName: "Jokerit" },
  JUK: { name: "Jukurit Mikkeli", apiName: "Jukurit" },
  KES: { name: "Kiekko-Espoo", apiName: "K-Espoo" },
  KAL: { name: "KalPa Kuopio", apiName: "KalPa" },
  KOO: { name: "KooKoo Kouvola", apiName: "KooKoo" },
  KAR: { name: "Kärpät Oulu", apiName: "Kärpät" },
  LUK: { name: "Lukko Rauma", apiName: "Lukko" },
  PEL: { name: "Pelicans Lahti", apiName: "Pelicans" },
  SAI: { name: "SaiPa Lappeenranta", apiName: "SaiPa" },
  SPO: { name: "Sport Vaasa", apiName: "Sport" },
  TPS: { name: "TPS Turku", apiName: "TPS" },
  TAP: { name: "Tappara Tampere", apiName: "Tappara" },
  ASS: { name: "Ässät Pori", apiName: "Ässät" },
};

// English Premier League. apiName = `HomeTeam` from
// https://fixturedownload.com/feed/json/epl-<season start year>.
// Includes recently relegated / promoted clubs so all fetched seasons resolve.
export const EPL_TEAMS: Record<string, LeagueTeam> = {
  ARS: { name: "Arsenal", apiName: "Arsenal" },
  AVL: { name: "Aston Villa", apiName: "Aston Villa" },
  BOU: { name: "Bournemouth", apiName: "Bournemouth" },
  BRE: { name: "Brentford", apiName: "Brentford" },
  BHA: { name: "Brighton & Hove Albion", apiName: "Brighton" },
  BUR: { name: "Burnley", apiName: "Burnley" },
  CHE: { name: "Chelsea", apiName: "Chelsea" },
  COV: { name: "Coventry City", apiName: "Coventry" },
  CRY: { name: "Crystal Palace", apiName: "Crystal Palace" },
  EVE: { name: "Everton", apiName: "Everton" },
  FUL: { name: "Fulham", apiName: "Fulham" },
  HUL: { name: "Hull City", apiName: "Hull" },
  IPS: { name: "Ipswich Town", apiName: "Ipswich" },
  LEE: { name: "Leeds United", apiName: "Leeds" },
  LEI: { name: "Leicester City", apiName: "Leicester" },
  LIV: { name: "Liverpool", apiName: "Liverpool" },
  LUT: { name: "Luton Town", apiName: "Luton" },
  MCI: { name: "Manchester City", apiName: "Man City" },
  MUN: { name: "Manchester United", apiName: "Man Utd" },
  NEW: { name: "Newcastle United", apiName: "Newcastle" },
  NFO: { name: "Nottingham Forest", apiName: "Nott'm Forest" },
  SHU: { name: "Sheffield United", apiName: "Sheffield Utd" },
  SOU: { name: "Southampton", apiName: "Southampton" },
  SUN: { name: "Sunderland", apiName: "Sunderland" },
  TOT: { name: "Tottenham Hotspur", apiName: "Spurs" },
  WHU: { name: "West Ham United", apiName: "West Ham" },
  WOL: { name: "Wolverhampton Wanderers", apiName: "Wolves" },
};

// UEFA Champions League 2026-27 participants. apiName = team name in
// https://fixturedownload.com/feed/json/champions-league-<season start year>.
// Codes are unique across NHL / Liiga / EPL (English clubs reuse their EPL
// codes) and avoid FIFA country codes used by the World Cup page.
export const UCL_TEAMS: Record<string, LeagueTeam & { country: string }> = {
  AEK: { name: "AEK Athens", apiName: "AEK Athens", country: "GRE" },
  ARS: { name: "Arsenal", apiName: "Arsenal", country: "ENG" },
  AVL: { name: "Aston Villa", apiName: "Aston Villa", country: "ENG" },
  ATM: { name: "Atlético Madrid", apiName: "Atleti", country: "ESP" },
  BVB: { name: "Borussia Dortmund", apiName: "B. Dortmund", country: "GER" },
  FCB: { name: "Barcelona", apiName: "Barcelona", country: "ESP" },
  BAY: { name: "Bayern München", apiName: "Bayern München", country: "GER" },
  BOD: { name: "Bodø/Glimt", apiName: "Bodø/Glimt", country: "NOR" },
  BRU: { name: "Club Brugge", apiName: "Club Brugge", country: "BEL" },
  COM: { name: "Como", apiName: "Como", country: "ITA" },
  FEN: { name: "Fenerbahçe", apiName: "Fenerbahçe", country: "TUR" },
  FEY: { name: "Feyenoord", apiName: "Feyenoord", country: "NED" },
  GAL: { name: "Galatasaray", apiName: "Galatasaray", country: "TUR" },
  INT: { name: "Inter", apiName: "Inter", country: "ITA" },
  LSK: { name: "LASK", apiName: "LASK", country: "AUT" },
  RBL: { name: "RB Leipzig", apiName: "Leipzig", country: "GER" },
  RCL: { name: "Lens", apiName: "Lens", country: "FRA" },
  LIL: { name: "Lille", apiName: "Lille", country: "FRA" },
  LIV: { name: "Liverpool", apiName: "Liverpool", country: "ENG" },
  MCI: { name: "Manchester City", apiName: "Man City", country: "ENG" },
  MUN: { name: "Manchester United", apiName: "Man Utd", country: "ENG" },
  NAP: { name: "Napoli", apiName: "Napoli", country: "ITA" },
  PSV: { name: "PSV Eindhoven", apiName: "PSV", country: "NED" },
  PSG: { name: "Paris Saint-Germain", apiName: "Paris", country: "FRA" },
  FCP: { name: "FC Porto", apiName: "Porto", country: "POR" },
  BET: { name: "Real Betis", apiName: "Real Betis", country: "ESP" },
  RMA: { name: "Real Madrid", apiName: "Real Madrid", country: "ESP" },
  ROM: { name: "Roma", apiName: "Roma", country: "ITA" },
  SLB: { name: "Slovan Bratislava", apiName: "S. Bratislava", country: "SVK" },
  SAB: { name: "Sabah", apiName: "Sabah", country: "AZE" },
  SHK: { name: "Shakhtar Donetsk", apiName: "Shakhtar", country: "UKR" },
  SLA: { name: "Slavia Praha", apiName: "Slavia Praha", country: "CZE" },
  SCP: { name: "Sporting CP", apiName: "Sporting CP", country: "POR" },
  VFB: { name: "VfB Stuttgart", apiName: "Stuttgart", country: "GER" },
  VIK: { name: "Viking", apiName: "Viking", country: "NOR" },
  VIL: { name: "Villarreal", apiName: "Villarreal", country: "ESP" },
};

function namesOf(teams: Record<string, LeagueTeam>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(teams).map(([abbr, t]) => [abbr, t.name])
  );
}

export const LIIGA_TEAM_NAMES = namesOf(LIIGA_TEAMS);
export const EPL_TEAM_NAMES = namesOf(EPL_TEAMS);
export const UCL_TEAM_NAMES = namesOf(UCL_TEAMS);

/**
 * Build a reverse lookup (upstream name -> app abbreviation) for a fetcher.
 */
export function apiNameToAbbr(
  teams: Record<string, LeagueTeam>
): Map<string, string> {
  const m = new Map<string, string>();
  for (const [abbr, t] of Object.entries(teams)) m.set(t.apiName, abbr);
  return m;
}
