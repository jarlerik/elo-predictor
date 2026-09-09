/**
 * One-off import of data/bets/*.json and data/results.json into
 * data/ledger.jsonl. Safe to re-run: lines already in the ledger are kept
 * as they are, only missing ones are added.
 *
 *   npm run migrate:ledger
 */
import { migrateLegacyBets, readLedger, ledgerPath } from "../src/data/ledger";

const { added, settled } = migrateLegacyBets();
const rows = readLedger();
const pending = rows.filter((r) => !r.settledAt).length;
console.log(`ledger: ${ledgerPath()}`);
console.log(`added ${added} lines (${settled} settled from results.json)`);
console.log(`total ${rows.length} lines, ${pending} pending`);
