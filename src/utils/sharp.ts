/**
 * Sharp reference prices: the market consensus (Pinnacle, an exchange, or
 * the median of the low-margin books) used as the "right" probability when
 * a soft bookmaker is checked for an overpriced outcome. Shared by the bet
 * forms (edge and Kelly stake against the sharp price) and the server
 * (expectation at the sharp price, closing line value against the sharp
 * close).
 */

/** Outcomes of each 1X2 / two-way market, in the order the forms show them. */
export const MARKET_SIDES: Record<string, string[]> = {
  regulation: ["home", "draw", "away"],
  fullTime: ["home", "draw", "away"],
  moneyline: ["home", "away"],
};

/**
 * Minimum edge against the de-vigged sharp price before a soft-book price
 * counts as value: p_sharp × odds − 1 at or above this. The sharp price
 * carries its own margin and moves a little between books, so a bet at
 * exactly fair is noise; a couple of percent clears that.
 */
export const MIN_SHARP_EDGE = 0.02;

/**
 * Probabilities with the overround removed by normalising 1/odds to sum to
 * one. Null unless every side of the market has a price above 1. The
 * proportional method slightly overstates longshots (favourite-longshot
 * bias); fine for prices under about 4, which is where the 1X2 sides sit.
 */
export function devig(
  odds: Record<string, number> | null | undefined,
  sides: string[]
): Record<string, number> | null {
  if (!odds) return null;
  let total = 0;
  for (const s of sides) {
    const o = odds[s];
    if (!(typeof o === "number" && o > 1)) return null;
    total += 1 / o;
  }
  const out: Record<string, number> = {};
  for (const s of sides) out[s] = 1 / odds[s] / total;
  return out;
}

/** De-vigged probability of one side, or null without a full price list. */
export function fairProbability(
  odds: Record<string, number> | null | undefined,
  side: string,
  sides: string[]
): number | null {
  const p = devig(odds, sides);
  return p ? p[side] ?? null : null;
}

/** Edge of a price against a probability: p × odds − 1. */
export function edgeAt(probability: number, odds: number): number {
  return probability * odds - 1;
}

/** Sum of 1/odds over the market, e.g. 1.05 for a 95 % payout. */
export function overround(
  odds: Record<string, number> | null | undefined,
  sides: string[]
): number | null {
  if (!odds) return null;
  let total = 0;
  for (const s of sides) {
    const o = odds[s];
    if (!(typeof o === "number" && o > 1)) return null;
    total += 1 / o;
  }
  return total;
}
