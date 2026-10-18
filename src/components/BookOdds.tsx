import React, { useSyncExternalStore } from "react";
import { kellyStake } from "../utils/kelly";
import { MIN_SHARP_EDGE, devig, overround } from "../utils/sharp";
import { KellySettings, kellyLabel } from "./bankroll";

/**
 * Bookmaker price inputs shared by the bet forms. The odds typed here are
 * what the ledger stores as `oddsTaken`; the model's min odd is only the
 * break-even price.
 */

/** Decimal odds from an input string, or null when empty / not a price. */
export function parseOdds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n > 1 ? Math.round(n * 100) / 100 : null;
}

/** Model edge at these odds: p × odds − 1, as a percentage string. */
export function edgePercent(probability: number, odds: number): string {
  const edge = (probability * odds - 1) * 100;
  return `${edge >= 0 ? "+" : ""}${edge.toFixed(1)}%`;
}

// One value shared by every form on the page (1X2 card and score list are
// separate components), remembered in this browser between visits.
function sharedValue(storageKey: string) {
  let value: string = (() => {
    try {
      return localStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  })();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const get = () => value;
  const set = (v: string) => {
    value = v;
    try {
      localStorage.setItem(storageKey, v);
    } catch {
      // storage unavailable: keep the value for this page only
    }
    listeners.forEach((l) => l());
  };
  return { subscribe, get, set };
}

const bookmakerStore = sharedValue("bookmaker");
const sharpSourceStore = sharedValue("sharpSource");

/** Bookmaker name, shared by all bet forms and remembered between visits. */
export function useBookmaker(): [string, (v: string) => void] {
  const bookmaker = useSyncExternalStore(bookmakerStore.subscribe, bookmakerStore.get);
  return [bookmaker, bookmakerStore.set];
}

/** Name of the sharp reference (e.g. Pinnacle), remembered between visits. */
export function useSharpSource(): [string, (v: string) => void] {
  const source = useSyncExternalStore(sharpSourceStore.subscribe, sharpSourceStore.get);
  return [source, sharpSourceStore.set];
}

export const BookmakerField: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => (
  <label className="stake-field">
    <span>Bookmaker</span>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="e.g. Veikkaus"
      className="stake-input book-name-input"
    />
  </label>
);

/** True when a soft-book price clears the sharp fair price by the margin. */
export function isSharpValue(sharpProbability: number, odds: number): boolean {
  return sharpProbability * odds - 1 >= MIN_SHARP_EDGE;
}

/**
 * One outcome's bookmaker odds. Shows the model edge next to the input as
 * soon as a valid price is typed, so the decision is visible before the
 * bet button is pressed. With a sharp probability (from the sharp price row)
 * the edge against the market is shown too, and the Kelly stake is sized on
 * that probability instead of the model's.
 */
export const OddsInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  probability: number;
  /** De-vigged sharp probability of this outcome, when the sharp row is filled. */
  sharpProbability?: number | null;
  label?: string;
  /** With a bankroll, the fractional-Kelly stake is shown under the edge. */
  kelly?: KellySettings | null;
  /** Clicking the Kelly stake puts it in the form's stake input. */
  onUseStake?: (stake: number) => void;
}> = ({
  value,
  onChange,
  probability,
  sharpProbability = null,
  label = "Book odds",
  kelly,
  onUseStake,
}) => {
  const odds = parseOdds(value);
  const positive = odds !== null && probability * odds - 1 >= 0;
  // Kelly on the sharp probability when there is one: that is the strategy's
  // estimate, the model's is the fallback.
  const sizingProb = sharpProbability ?? probability;
  const sizingPositive = odds !== null && sizingProb * odds - 1 >= 0;
  const stake =
    kelly && odds !== null && sizingPositive
      ? Math.round(kellyStake(kelly.bankroll, sizingProb, odds, kelly.divider) * 100) / 100
      : null;
  const value_ =
    odds !== null && sharpProbability !== null && isSharpValue(sharpProbability, odds);
  return (
    <label className="book-odds-field" onClick={(e) => e.stopPropagation()}>
      <span className="book-odds-label">{label}</span>
      <input
        type="number"
        min="1.01"
        step="0.01"
        inputMode="decimal"
        placeholder="—"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`book-odds-input ${value_ ? "sharp-value" : ""}`}
      />
      <span
        className={`book-odds-edge ${
          odds === null ? "" : positive ? "positive" : "negative"
        }`}
        title="Edge against the model's probability"
      >
        {odds === null ? "" : edgePercent(probability, odds)}
      </span>
      {odds !== null && sharpProbability !== null && (
        <span
          className={`book-odds-edge sharp ${
            sharpProbability * odds - 1 >= 0 ? "positive" : "negative"
          }`}
          title="Edge against the de-vigged sharp price"
        >
          vs sharp {edgePercent(sharpProbability, odds)}
        </span>
      )}
      {stake !== null && kelly && (
        <button
          type="button"
          className="kelly-hint"
          title={`${kellyLabel(kelly.divider)} of ${kelly.bankroll.toFixed(2)}€ at these odds on the ${
            sharpProbability !== null ? "sharp" : "model"
          } probability. Click to use as the stake.`}
          onClick={(e) => {
            e.preventDefault();
            onUseStake?.(stake);
          }}
        >
          {kellyLabel(kelly.divider)} {stake.toFixed(2)}€
        </button>
      )}
    </label>
  );
};

/**
 * Sharp reference prices for every outcome of a market, typed from
 * Pinnacle, an exchange or the consensus of the low-margin books. De-vigged
 * they are the market's probabilities; the bet forms show each soft-book
 * price's edge against them and size the Kelly stake on them. Nothing here
 * is saved until a bet is: the prices then travel with the ledger row.
 */
export const SharpOddsFields: React.FC<{
  sides: { key: string; label: string }[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  source: string;
  onSourceChange: (v: string) => void;
  title?: string;
  /** Muted caption, e.g. where an auto-filled price came from. */
  note?: string;
}> = ({ sides, values, onChange, source, onSourceChange, title = "Sharp odds", note }) => {
  const keys = sides.map((s) => s.key);
  const odds: Record<string, number> = {};
  for (const k of keys) {
    const n = parseOdds(values[k]);
    if (n !== null) odds[k] = n;
  }
  const fair = devig(odds, keys);
  const margin = overround(odds, keys);
  return (
    <div className="sharp-odds-row" onClick={(e) => e.stopPropagation()}>
      <span className="sharp-odds-title" title="The reference market: Pinnacle, an exchange, or the consensus of the low-margin books">
        {title}
      </span>
      {sides.map((s) => (
        <label key={s.key} className="sharp-odds-field">
          <span>{s.label}</span>
          <input
            type="number"
            min="1.01"
            step="0.01"
            inputMode="decimal"
            placeholder="—"
            value={values[s.key] ?? ""}
            onChange={(e) => onChange(s.key, e.target.value)}
            className="book-odds-input"
          />
          {fair && (
            <span className="sharp-odds-fair" title="De-vigged fair odds">
              {(1 / fair[s.key]).toFixed(2)}
            </span>
          )}
        </label>
      ))}
      <label className="sharp-odds-field">
        <span>Source</span>
        <input
          type="text"
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
          placeholder="e.g. Pinnacle"
          className="stake-input book-name-input"
        />
      </label>
      {margin !== null && (
        <span className="sharp-odds-margin" title="Sum of 1/odds; the fair odds above have this removed">
          payout {((1 / margin) * 100).toFixed(1)}%
        </span>
      )}
      {note && <span className="sharp-odds-margin">{note}</span>}
    </div>
  );
};

/** "auto-filled from Pinnacle 12:03" for a /api/odds/sharp response. */
export function sharpFillNote(source: string, fetchedAt: string): string {
  const t = new Date(fetchedAt);
  const hhmm = Number.isFinite(t.getTime())
    ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  return `auto-filled from ${source.replace(/\s*\(OddsPapi\)/, "")} ${hhmm}`.trim();
}

/** Response of GET /api/odds/sharp. */
export interface SharpOddsResponse {
  sharpOdds: { home: number; draw?: number; away: number };
  moneyline?: { home: number; away: number };
  sharpSource: string;
  fetchedAt: string;
}

/** The prefill, or null on 204 / error / no body. Never throws. */
export async function fetchSharpPrefill(params: {
  league: string;
  home: string;
  away: string;
}): Promise<SharpOddsResponse | null> {
  try {
    const qs = new URLSearchParams(params);
    const res = await fetch(`/api/odds/sharp?${qs.toString()}`);
    if (res.status !== 200) return null;
    const body = await res.json();
    if (!body || typeof body !== "object" || !body.sharpOdds) return null;
    return body as SharpOddsResponse;
  } catch {
    return null;
  }
}

/** De-vigged probabilities from the sharp inputs, or null until complete. */
export function sharpProbabilities(
  values: Record<string, string>,
  keys: string[]
): Record<string, number> | null {
  const odds: Record<string, number> = {};
  for (const k of keys) {
    const n = parseOdds(values[k]);
    if (n !== null) odds[k] = n;
  }
  return devig(odds, keys);
}

/** Parsed sharp prices for the request body, or undefined until complete. */
export function sharpOddsBody(
  values: Record<string, string>,
  keys: string[]
): Record<string, number> | undefined {
  const odds: Record<string, number> = {};
  for (const k of keys) {
    const n = parseOdds(values[k]);
    if (n === null) return undefined;
    odds[k] = n;
  }
  return odds;
}
