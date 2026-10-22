/**
 * Minimal .env loader for the scripts (the server is started with the
 * variables already exported). Fills process.env from ./.env for keys that
 * are not set yet; never overrides an exported value.
 */
import fs from "fs";
import path from "path";

let loaded = false;

export function loadDotEnv(file = path.join(process.cwd(), ".env")): void {
  if (loaded) return;
  loaded = true;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
