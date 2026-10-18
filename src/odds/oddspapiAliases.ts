/**
 * OddsPapi participant names -> app abbreviations.
 *
 * OddsPapi returns full club names ("Liverpool FC", "Manchester United",
 * "Boston Bruins"). The tables below start from the app's own display
 * names and add the spellings the API is known or expected to use. Lookup
 * is an exact match after trimming and case-folding; a name that is not in
 * the table is reported by the caller, never guessed, because a wrong
 * mapping would price the wrong game.
 *
 * To extend: run `npm run odds:close -- --dry-run` (or the sharp route) and
 * add every "unmatched" name printed to the override list for its league.
 */
import { EPL_TEAMS, LIIGA_TEAMS, UCL_TEAMS } from "../utils/leagues";
import { NHL_TEAM_NAMES } from "../utils/teamData";

export type OddsLeague = "nhl" | "liiga" | "epl" | "ucl";

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Hand-maintained spellings per league. Keys are the API's names (any
 * case), values the app's codes. The display names from the team tables
 * are added automatically below, so only differing spellings go here.
 */
const OVERRIDES: Record<OddsLeague, Record<string, string>> = {
  epl: {
    "Liverpool FC": "LIV",
    "Arsenal FC": "ARS",
    "Chelsea FC": "CHE",
    "Everton FC": "EVE",
    "Fulham FC": "FUL",
    "Burnley FC": "BUR",
    "Sunderland AFC": "SUN",
    "AFC Bournemouth": "BOU",
    "Bournemouth": "BOU",
    "Brentford FC": "BRE",
    "Brighton": "BHA",
    "Brighton & Hove Albion FC": "BHA",
    "Brighton and Hove Albion": "BHA",
    "Manchester City FC": "MCI",
    "Manchester United FC": "MUN",
    "Man City": "MCI",
    "Man United": "MUN",
    "Man Utd": "MUN",
    "Newcastle": "NEW",
    "Newcastle United FC": "NEW",
    "Nottingham Forest FC": "NFO",
    "Nottm Forest": "NFO",
    "Nott'm Forest": "NFO",
    "Tottenham": "TOT",
    "Tottenham Hotspur FC": "TOT",
    "Spurs": "TOT",
    "West Ham": "WHU",
    "West Ham United FC": "WHU",
    "Wolves": "WOL",
    "Wolverhampton Wanderers FC": "WOL",
    "Wolverhampton": "WOL",
    "Crystal Palace FC": "CRY",
    "Leeds": "LEE",
    "Leeds United FC": "LEE",
    "Aston Villa FC": "AVL",
    "Leicester": "LEI",
    "Leicester City FC": "LEI",
    "Ipswich": "IPS",
    "Ipswich Town FC": "IPS",
    "Southampton FC": "SOU",
    "Sheffield United FC": "SHU",
    "Sheffield Utd": "SHU",
    "Luton": "LUT",
    "Luton Town FC": "LUT",
    "Coventry": "COV",
    "Coventry City FC": "COV",
    "Hull": "HUL",
    "Hull City AFC": "HUL",
  },
  nhl: {
    "Montréal Canadiens": "MTL",
    "Montreal Canadiens": "MTL",
    "St Louis Blues": "STL",
    "St. Louis Blues": "STL",
    "Utah Hockey Club": "UTA",
    "Utah Mammoth": "UTA",
    "Vegas Golden Knights": "VGK",
    "Los Angeles Kings": "LAK",
    "LA Kings": "LAK",
    "New York Islanders": "NYI",
    "NY Islanders": "NYI",
    "New York Rangers": "NYR",
    "NY Rangers": "NYR",
    "New Jersey Devils": "NJD",
    "Tampa Bay Lightning": "TBL",
    "San Jose Sharks": "SJS",
    "Washington Capitals": "WSH",
    "Columbus Blue Jackets": "CBJ",
    "Winnipeg Jets": "WPG",
  },
  liiga: {
    // UNVERIFIED: OddsPapi's Liiga spellings. Both the bare club name and
    // the "club city" form are listed so either resolves.
    HIFK: "HIFK",
    "HIFK Helsinki": "HIFK",
    "IFK Helsinki": "HIFK",
    HPK: "HPK",
    "HPK Hämeenlinna": "HPK",
    "HPK Hameenlinna": "HPK",
    Ilves: "ILV",
    "Ilves Tampere": "ILV",
    JYP: "JYP",
    "JYP Jyväskylä": "JYP",
    "JYP Jyvaskyla": "JYP",
    Jokerit: "JOK",
    "Jokerit Helsinki": "JOK",
    Jukurit: "JUK",
    "Jukurit Mikkeli": "JUK",
    "Kiekko-Espoo": "KES",
    "K-Espoo": "KES",
    KalPa: "KAL",
    "KalPa Kuopio": "KAL",
    KooKoo: "KOO",
    "KooKoo Kouvola": "KOO",
    Kärpät: "KAR",
    "Kärpät Oulu": "KAR",
    Karpat: "KAR",
    "Karpat Oulu": "KAR",
    Lukko: "LUK",
    "Lukko Rauma": "LUK",
    Pelicans: "PEL",
    "Pelicans Lahti": "PEL",
    "Lahti Pelicans": "PEL",
    SaiPa: "SAI",
    "SaiPa Lappeenranta": "SAI",
    Sport: "SPO",
    "Sport Vaasa": "SPO",
    "Vaasan Sport": "SPO",
    TPS: "TPS",
    "TPS Turku": "TPS",
    Tappara: "TAP",
    "Tappara Tampere": "TAP",
    Ässät: "ASS",
    "Ässät Pori": "ASS",
    Assat: "ASS",
    "Assat Pori": "ASS",
  },
  ucl: {
    // UNVERIFIED spellings; the display names from UCL_TEAMS are added
    // automatically. English clubs reuse their EPL codes.
    "Atletico Madrid": "ATM",
    "Atlético de Madrid": "ATM",
    "Club Atlético de Madrid": "ATM",
    "FC Barcelona": "FCB",
    "Bayern Munich": "BAY",
    "FC Bayern München": "BAY",
    "Bayern München": "BAY",
    "Bodo/Glimt": "BOD",
    "FK Bodø/Glimt": "BOD",
    "Club Brugge KV": "BRU",
    "Como 1907": "COM",
    "Fenerbahce": "FEN",
    "Fenerbahçe SK": "FEN",
    "Feyenoord Rotterdam": "FEY",
    "Galatasaray SK": "GAL",
    "Inter Milan": "INT",
    "FC Internazionale Milano": "INT",
    "Internazionale": "INT",
    "LASK Linz": "LSK",
    "RB Leipzig": "RBL",
    "RasenBallsport Leipzig": "RBL",
    "RC Lens": "RCL",
    "LOSC Lille": "LIL",
    "Lille OSC": "LIL",
    "Liverpool FC": "LIV",
    "Manchester City FC": "MCI",
    "Manchester United FC": "MUN",
    "SSC Napoli": "NAP",
    "PSV": "PSV",
    "PSV Eindhoven": "PSV",
    "Paris Saint-Germain FC": "PSG",
    "Paris SG": "PSG",
    PSG: "PSG",
    Porto: "FCP",
    "FC Porto": "FCP",
    "Real Betis Balompié": "BET",
    "Real Betis": "BET",
    "Real Madrid CF": "RMA",
    "AS Roma": "ROM",
    "ŠK Slovan Bratislava": "SLB",
    "Slovan Bratislava": "SLB",
    "Sabah FK": "SAB",
    "Shakhtar Donetsk": "SHK",
    "FC Shakhtar Donetsk": "SHK",
    "Slavia Praha": "SLA",
    "SK Slavia Praha": "SLA",
    "Slavia Prague": "SLA",
    "Sporting CP": "SCP",
    "Sporting Lisbon": "SCP",
    "VfB Stuttgart": "VFB",
    Stuttgart: "VFB",
    "Viking FK": "VIK",
    "Villarreal CF": "VIL",
    "Borussia Dortmund": "BVB",
    "AEK Athens FC": "AEK",
    "Arsenal FC": "ARS",
    "Aston Villa FC": "AVL",
    "Tottenham Hotspur FC": "TOT",
    "Chelsea FC": "CHE",
    "Newcastle United FC": "NEW",
  },
};

function build(league: OddsLeague): Map<string, string> {
  const map = new Map<string, string>();
  const add = (name: string, abbr: string) => map.set(fold(name), abbr);
  switch (league) {
    case "epl":
      for (const [abbr, t] of Object.entries(EPL_TEAMS)) {
        add(t.name, abbr);
        add(t.apiName, abbr);
      }
      break;
    case "ucl":
      for (const [abbr, t] of Object.entries(UCL_TEAMS)) {
        add(t.name, abbr);
        add(t.apiName, abbr);
      }
      break;
    case "liiga":
      for (const [abbr, t] of Object.entries(LIIGA_TEAMS)) {
        add(t.name, abbr);
        add(t.apiName, abbr);
      }
      break;
    case "nhl":
      for (const [abbr, name] of Object.entries(NHL_TEAM_NAMES)) add(name, abbr);
      break;
  }
  for (const [name, abbr] of Object.entries(OVERRIDES[league])) add(name, abbr);
  return map;
}

const TABLES = new Map<OddsLeague, Map<string, string>>();

/** App code for an OddsPapi participant name, or null when unknown. */
export function resolveOddspapiAbbr(
  league: OddsLeague,
  name: string | null | undefined
): string | null {
  if (!name) return null;
  let table = TABLES.get(league);
  if (!table) {
    table = build(league);
    TABLES.set(league, table);
  }
  return table.get(fold(name)) ?? null;
}

export const isOddsLeague = (v: unknown): v is OddsLeague =>
  v === "nhl" || v === "liiga" || v === "epl" || v === "ucl";
