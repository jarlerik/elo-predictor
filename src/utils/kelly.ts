/**
 * Kelly criterion for decimal odds, shared by the server (staking metrics)
 * and the client (Kelly stake next to the stake input, Kelly page).
 *
 *   f* = (p × odds − 1) / (odds − 1)
 *
 * is the fraction of the bankroll that maximises long-run growth when p is
 * right. Negative edge gives 0: no bet.
 */
export function kellyFraction(probability: number, odds: number): number {
  if (!(odds > 1) || !(probability > 0) || !(probability < 1)) return 0;
  return Math.max(0, (probability * odds - 1) / (odds - 1));
}

/** Stake in currency for a fractional Kelly (bankroll × f* / divider). */
export function kellyStake(
  bankroll: number,
  probability: number,
  odds: number,
  divider = 1
): number {
  if (!(bankroll > 0) || !(divider > 0)) return 0;
  return (bankroll * kellyFraction(probability, odds)) / divider;
}
