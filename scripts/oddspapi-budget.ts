/**
 * Month-to-date OddsPapi request usage: the local counter the client keeps
 * (data/odds/oddspapi/budget.json) and, when a key is set, the account's
 * own count from the unmetered /v4/account endpoint.
 *
 *   npm run odds:budget
 */
import { accountUsage, budget, isConfigured } from "../src/odds/oddspapi";
import { loadDotEnv } from "../src/utils/env";

loadDotEnv();

const b = budget();
console.log(`oddspapi ${b.month}: ${b.used} of ${b.limit} requests used locally (soft limit ${b.softLimit})`);
if (!isConfigured()) {
  console.log("ODDSPAPI_API_KEY not set; account usage not checked");
} else {
  const a = await accountUsage();
  if (a) console.log(`account: ${a.count} of ${a.limit} used this period`);
  else console.log("account usage unavailable");
}
