import { LeagueId } from "../utils/leagues";
import { OddsProvider } from "./types";
import { footballDataProvider } from "./footballData";
import { theOddsApiProvider } from "./theOddsApi";

/** Historical providers in order of preference. */
export const ODDS_PROVIDERS: OddsProvider[] = [footballDataProvider, theOddsApiProvider];

export function historicalProviderFor(league: LeagueId): OddsProvider | null {
  return ODDS_PROVIDERS.find((p) => p.supports(league)) ?? null;
}

export * from "./types";
export { readAllOdds, readOddsSeason, joinOdds, listOddsSeasons } from "./store";
