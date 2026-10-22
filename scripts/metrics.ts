/**
 * Betting performance from the ledger: the figures the dashboard used to
 * show (docs/METRICS_AND_DASHBOARD.md section B and C).
 *
 *   npm run metrics                    # headline, open bets, by league and market
 *   npm run metrics -- --by oddsBand   # one more slice: league, market, pick, oddsBand,
 *                                      #   edgeBand, sharpEdgeBand, eloGap, season, phase
 *   npm run metrics -- --json          # the raw summary and segments
 */
import { argv, table, pct, upct, money, localDateTime } from "../src/utils/table";
import { ensureLedger } from "../src/data/ledger";
import { isSegmentBy, segments, summarize, SegmentBy, MIN_SAMPLE } from "../src/data/metrics";
import { bankrollState, readBankroll } from "../src/data/bankroll";

const { flag, has } = argv();
const rows = ensureLedger();
const bank = bankrollState(readBankroll(), rows);
const s = summarize(rows, bank.current);
const slices: SegmentBy[] = ["leagueMarket"];
const extra = flag("--by");
if (extra) {
  if (!isSegmentBy(extra)) {
    console.error(`unknown slice ${extra}`);
    process.exit(1);
  }
  slices.push(extra);
}

if (has("--json")) {
  console.log(JSON.stringify({ summary: { ...s, series: undefined }, bankroll: bank, segments: slices.map((by) => segments(rows, by)) }, null, 1));
  process.exit(0);
}

const yieldSe = s.counts.settled ? s.sigma / Math.max(1, s.turnover) : null;
console.log("Betting performance");
console.log(
  table(
    ["Figure", "Value", "Note"],
    [
      ["Settled / pending / void", `${s.counts.settled} / ${s.counts.pending} / ${s.counts.voided}`, ""],
      ["Turnover", money(s.turnover), "stake of settled win/loss bets"],
      ["Profit", money(s.profit), `yield ${pct(s.yield)}${yieldSe != null ? ` ± ${upct(yieldSe)}` : ""}`],
      ["Model-expected profit", money(s.expectedProfit), `expected yield ${pct(s.expectedYield)}; z = ${s.zScore == null ? "–" : s.zScore.toFixed(2)}`],
      ["Hit rate", upct(s.hitRate), `model expected ${upct(s.expectedHitRate)}`],
      ["Sharp sample", String(s.sharp.sample), `bets with a sharp price at bet time; expected ${money(s.sharp.expectedProfit)} on ${money(s.sharp.turnover)} (${pct(s.sharp.turnover ? s.sharp.expectedProfit / s.sharp.turnover : null)}), actual ${money(s.sharp.actual)}`],
      ["Sharp CLV", pct(s.sharpClv.mean), `${s.sharpClv.sample} bets with a sharp close; beat the close ${upct(s.sharpClv.beatCloseShare)}`],
      ["Book CLV", pct(s.clv.mean), `${s.clv.sample} bets with a closing price; beat it ${upct(s.clv.beatCloseShare)}`],
      ["Max drawdown", money(s.maxDrawdown.amount), s.maxDrawdown.percentOfBankroll == null ? "" : `${upct(s.maxDrawdown.percentOfBankroll)} of bankroll`],
      ["Open stake", money(s.pending.stake), `model-expected ${money(s.pending.expectedProfit)}`],
      ["Bankroll", bank.tracked ? money(bank.current) : "not tracked", bank.tracked ? `start ${money(bank.start)} on ${bank.startedAt}, Kelly /${bank.kellyDivider}` : "npm run bankroll -- --set <amount>"],
    ]
  )
);
console.log(`\nSamples under ${MIN_SAMPLE} bets are noise; the sharp CLV at fifty bets is the first reading that means anything.`);

const open = rows.filter((r) => !r.settledAt);
if (open.length) {
  console.log("\nOpen bets");
  console.log(
    table(
      ["Kickoff", "League", "Game", "Market", "Pick", "Odds", "Stake", "Book", "Sharp p"],
      open.map((r) => {
        const side = r.pick === "DRAW" ? "draw" : r.pick === r.game.home ? "home" : "away";
        const sharp = r.sharpOdds ? 1 / r.sharpOdds[side] / Object.values(r.sharpOdds).reduce((t, o) => t + 1 / o, 0) : null;
        return [localDateTime(r.game.date), r.league ?? "–", `${r.game.home} v ${r.game.away}`, r.market, r.pick, r.oddsTaken, money(r.stake), r.bookmaker ?? "–", sharp == null ? "–" : upct(sharp)];
      })
    )
  );
}

for (const by of slices) {
  const seg = segments(rows, by);
  console.log(`\nBy ${by}`);
  console.log(
    table(
      ["Segment", "Settled", "Turnover", "Profit", "Yield", "Exp. yield", "Hit", "Sharp CLV (n)"],
      seg.rows.map((r) => [r.label, r.counts.settled, money(r.turnover), money(r.profit), pct(r.yield), pct(r.expectedYield), upct(r.hitRate), `${pct(r.sharpClv.mean)} (${r.sharpClv.sample})`])
    )
  );
}
