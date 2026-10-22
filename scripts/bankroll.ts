/**
 * Bankroll (data/bankroll.json).
 *
 *   npm run bankroll                                   # show
 *   npm run bankroll -- --set 500 --started 2026-10-01 [--kelly 4] [--limit 0.1]
 *   npm run bankroll -- --deposit 100 [--note "..."]
 *   npm run bankroll -- --withdraw 50
 */
import { argv, table, money } from "../src/utils/table";
import { ensureLedger, round2 } from "../src/data/ledger";
import { bankrollState, DEFAULT_DAILY_EXPOSURE_LIMIT, DEFAULT_KELLY_DIVIDER, readBankroll, writeBankroll } from "../src/data/bankroll";

const { flag } = argv();
const existing = readBankroll();

if (flag("--set")) {
  const start = Number(flag("--set"));
  const startedAt = flag("--started") ?? existing?.startedAt ?? new Date().toISOString().slice(0, 10);
  if (!(start >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(startedAt)) {
    console.error("--set needs an amount ≥ 0 and --started YYYY-MM-DD");
    process.exit(1);
  }
  writeBankroll({
    start: round2(start),
    startedAt,
    kellyDivider: Number(flag("--kelly") ?? existing?.kellyDivider ?? DEFAULT_KELLY_DIVIDER),
    dailyExposureLimit: Number(flag("--limit") ?? existing?.dailyExposureLimit ?? DEFAULT_DAILY_EXPOSURE_LIMIT),
    movements: existing?.movements ?? [],
  });
} else if (flag("--deposit") || flag("--withdraw")) {
  if (!existing) {
    console.error("set the bankroll first: npm run bankroll -- --set <amount>");
    process.exit(1);
  }
  const amount = flag("--deposit") ? Number(flag("--deposit")) : -Number(flag("--withdraw"));
  if (!Number.isFinite(amount) || amount === 0) {
    console.error("amount must be a non-zero number");
    process.exit(1);
  }
  existing.movements.push({ at: new Date().toISOString(), amount: round2(amount), note: flag("--note") ?? null });
  writeBankroll(existing);
}

const b = bankrollState(readBankroll(), ensureLedger());
if (!b.tracked) {
  console.log("bankroll not tracked; npm run bankroll -- --set <amount> --started YYYY-MM-DD");
} else {
  console.log(
    table(
      ["Figure", "Value"],
      [
        ["Start", `${money(b.start)} on ${b.startedAt}`],
        ["Deposits / withdrawals", `${money(b.deposits)} / ${money(b.withdrawals)}`],
        ["Settled profit", `${money(b.settledProfit)} over ${b.settledBets} bets`],
        ["Current", money(b.current)],
        ["Open stake", money(b.openStake)],
        ["Kelly divider / daily exposure limit", `${b.kellyDivider} / ${b.dailyExposureLimit}`],
      ]
    )
  );
  if (b.movements.length) {
    console.log("\nMovements");
    console.log(table(["At", "Amount", "Note"], b.movements.map((m) => [m.at.slice(0, 16).replace("T", " "), money(m.amount), m.note ?? ""])));
  }
}
