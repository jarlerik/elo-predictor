import React, { useSyncExternalStore } from "react";
import { kellyStake } from "../utils/kelly";
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

const BOOKMAKER_KEY = "bookmaker";

// One value shared by every form on the page (1X2 card and score list are
// separate components), remembered in this browser between visits.
let bookmakerValue: string = (() => {
  try {
    return localStorage.getItem(BOOKMAKER_KEY) ?? "";
  } catch {
    return "";
  }
})();
const bookmakerListeners = new Set<() => void>();
const subscribeBookmaker = (listener: () => void) => {
  bookmakerListeners.add(listener);
  return () => {
    bookmakerListeners.delete(listener);
  };
};
const getBookmaker = () => bookmakerValue;
const setBookmakerValue = (v: string) => {
  bookmakerValue = v;
  try {
    localStorage.setItem(BOOKMAKER_KEY, v);
  } catch {
    // storage unavailable: keep the value for this page only
  }
  bookmakerListeners.forEach((l) => l());
};

/** Bookmaker name, shared by all bet forms and remembered between visits. */
export function useBookmaker(): [string, (v: string) => void] {
  const bookmaker = useSyncExternalStore(subscribeBookmaker, getBookmaker);
  return [bookmaker, setBookmakerValue];
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

/**
 * One outcome's bookmaker odds. Shows the model edge next to the input as
 * soon as a valid price is typed, so the decision is visible before the
 * bet button is pressed.
 */
export const OddsInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  probability: number;
  label?: string;
  /** With a bankroll, the fractional-Kelly stake is shown under the edge. */
  kelly?: KellySettings | null;
  /** Clicking the Kelly stake puts it in the form's stake input. */
  onUseStake?: (stake: number) => void;
}> = ({ value, onChange, probability, label = "Book odds", kelly, onUseStake }) => {
  const odds = parseOdds(value);
  const positive = odds !== null && probability * odds - 1 >= 0;
  const stake =
    kelly && odds !== null && positive
      ? Math.round(kellyStake(kelly.bankroll, probability, odds, kelly.divider) * 100) / 100
      : null;
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
        className="book-odds-input"
      />
      <span
        className={`book-odds-edge ${
          odds === null ? "" : positive ? "positive" : "negative"
        }`}
      >
        {odds === null ? "" : edgePercent(probability, odds)}
      </span>
      {stake !== null && kelly && (
        <button
          type="button"
          className="kelly-hint"
          title={`${kellyLabel(kelly.divider)} of ${kelly.bankroll.toFixed(2)}€ at these odds. Click to use as the stake.`}
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
