/**
 * Bookmaker prices, normalised across providers.
 *
 * Historical rows (football-data.co.uk CSVs, later The Odds API snapshots)
 * feed the market backtest; live rows (OddsPapi) prefill the bet forms and
 * the ledger's sharp closing prices. Every provider maps its own team names
 * to the app's abbreviations (src/odds/aliases.ts) and reports, rather than
 * guesses, the names it cannot place.
 */
import { LeagueId } from "../utils/leagues";

export type OddsMarket = "fullTime" | "regulation" | "moneyline";

/** Decimal odds for one market. `draw` is absent on two-way markets. */
export interface PriceTrio {
  home: number;
  draw?: number;
  away: number;
}

export type OddsSource = "football-data" | "oddspapi" | "the-odds-api";
export type SharpBook = "pinnacle" | "betfair-exchange" | "avg";

export interface OddsRecord {
  league: LeagueId;
  /** Season label in the league's own convention, e.g. "20242025". */
  season: string;
  /** ISO kickoff; UTC midnight of the match day when the source has no time. */
  date: string;
  /** App abbreviations (EPL_TEAMS / LIIGA_TEAMS / NHL codes). */
  home: string;
  away: string;
  market: OddsMarket;
  /**
   * Sharp reference close: Pinnacle's last price before kickoff when the
   * source has it, otherwise the Betfair Exchange close, otherwise the
   * market average close. `sharpBook` says which.
   */
  sharp: PriceTrio;
  sharpBook: SharpBook;
  /** Sharp pre-match (football-data: Pinnacle as of Friday/the day before). */
  sharpOpen?: PriceTrio;
  /** Market-wide average and best closing prices (football-data, 2019-20+). */
  avg?: PriceTrio;
  max?: PriceTrio;
  avgOpen?: PriceTrio;
  maxOpen?: PriceTrio;
  /** Per-bookmaker prices, keyed by the provider's bookmaker code. */
  book?: Record<string, PriceTrio>;
  /** Final score when the source carries results (football-data). */
  result?: { homeGoals: number; awayGoals: number };
  source: OddsSource;
}

/** A provider of whole seasons of historical prices. */
export interface OddsProvider {
  id: OddsSource;
  supports(league: LeagueId): boolean;
  /**
   * Prices for one season, by the season's start year. Providers cache on
   * disk and only hit the network for seasons not yet stored or still in
   * progress, unless `force`.
   */
  fetchSeason(
    league: LeagueId,
    startYear: number,
    opts?: { force?: boolean }
  ): Promise<{ records: OddsRecord[]; unmatched: UnmatchedName[] }>;
}

/** A team name the provider's alias table could not place. */
export interface UnmatchedName {
  row: number;
  home: string;
  away: string;
}

/** Live prices for one upcoming or just-played game (OddsPapi). */
export interface LiveSharpPrices {
  /** The league's main market: 1X2 for soccer, regulation 1X2 for hockey. */
  sharpOdds: PriceTrio;
  /** Hockey only: two-way price including OT/SO. */
  moneyline?: { home: number; away: number };
  sharpSource: string;
  fetchedAt: string;
}
