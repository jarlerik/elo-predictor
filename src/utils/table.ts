/** Plain-text tables for the CLI: columns padded to the widest cell, numbers right-aligned. */
export function table(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cells = rows.map((r) => r.map((c) => (c == null ? "–" : String(c))));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? "").length)));
  const numeric = headers.map((_, i) => cells.length > 0 && cells.every((r) => /^[-+–]?[\d.,]*\s?%?$/.test(r[i] ?? "")));
  const line = (r: string[]) =>
    r.map((c, i) => (numeric[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ").trimEnd();
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...cells.map(line)].join("\n");
}

export const pct = (x: number | null | undefined, d = 1) =>
  x == null || !Number.isFinite(x) ? "–" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)} %`;
export const upct = (x: number | null | undefined, d = 1) =>
  x == null || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(d)} %`;
export const money = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(2));

/** Local Helsinki date and time of an ISO instant. */
export const TZ = "Europe/Helsinki";
export const localDateTime = (iso: string | null | undefined) =>
  !iso
    ? "–"
    : new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        .format(new Date(iso))
        .replace(",", "");
export const localDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** Simple argv access shared by the scripts: `flag("--x")` is the value after it, `has("--x")` its presence. */
export function argv(args = process.argv.slice(2)) {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (name: string) => args.includes(name);
  /** Arguments that are neither flags nor flag values. */
  const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !isSwitch(args[i - 1])));
  return { args, flag, has, positional };
}

/** Flags that take no value. */
const SWITCHES = new Set(["--dry-run", "--json", "--ot", "--offline", "--force", "--neutral"]);
const isSwitch = (f: string) => SWITCHES.has(f);
