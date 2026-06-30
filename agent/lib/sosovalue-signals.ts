/**
 * SoSoValue Trading Signals
 *
 * Turns SoSoValue data — that was previously fetched only for narrative text —
 * into concrete inputs to the trading loop:
 *
 *   1. SSI Index Confirmation — corroborates the contrarian regime score with
 *      on-chain SSI index price action (BTCSSI / ETHSSI down 7d = real fear,
 *      independent of FGI sentiment).
 *
 *   2. Macro Event Pause — when a high-impact macroeconomic event (CPI, FOMC,
 *      Employment) is within the look-ahead window, halve trade size or skip
 *      new entries entirely to avoid trading into known volatility.
 *
 *   3. News Sentiment — aggregates SoSoValue news per symbol and produces a
 *      ±10pp adjustment to per-token conviction. Negative news on a candidate
 *      reduces conviction; positive news on a held position lets winners run.
 *
 * Each function degrades gracefully — if SoSoValue is offline, the trading
 * loop continues with the prior behaviour (no SSI boost, no pause, no news
 * adjustment).
 */

import { sosovalueClient } from "./data-providers.js";
import type {
  SosovalueFeedItem,
  SosovalueMacroEvent,
} from "./data-providers.js";

// =============================================================================
// 1. SSI Index Regime Confirmation
// =============================================================================

/**
 * Tickers we treat as the macro SSI baskets. The agent reads whichever
 * snapshot SoSoValue returns; missing tickers are silently skipped.
 */
const SSI_REGIME_TICKERS = ["BTCSSI", "ETHSSI", "ALTSSI"] as const;

export interface SsiRegimeSignal {
  /** −1 (strong fear confirmation) … +1 (strong fear contradiction). */
  confirmation: number;
  /** Average 7d return across the SSI baskets we could read. 0 if none. */
  avgPercentChange7d: number;
  /** Number of indices that contributed to the average. */
  indicesRead: number;
  /** Per-ticker breakdown for the dashboard. */
  perIndex: Array<{ ticker: string; percentChange7d: number }>;
}

/**
 * Fetch SSI index snapshots and produce a single contrarian confirmation
 * score in [−1, +1]. Used as an additional weight inside scoreMarketRegime.
 *
 *   indices down 7d   → confirms fear → contrarian-bullish (positive number)
 *   indices flat      → neutral
 *   indices up 7d     → contradicts fear → contrarian-bearish (negative)
 *
 * The mapping is intentionally compressed (sign matters more than magnitude),
 * because SSI baskets move less dramatically than individual tokens.
 */
export async function fetchSsiRegimeSignal(): Promise<SsiRegimeSignal> {
  const empty: SsiRegimeSignal = {
    confirmation: 0,
    avgPercentChange7d: 0,
    indicesRead: 0,
    perIndex: [],
  };

  const snapshots = await Promise.all(
    SSI_REGIME_TICKERS.map((ticker) =>
      sosovalueClient.fetchIndexSnapshot(ticker).catch(() => null),
    ),
  );

  const perIndex: Array<{ ticker: string; percentChange7d: number }> = [];
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const ticker = SSI_REGIME_TICKERS[i];
    if (snap && typeof snap.percent_change_7d === "number") {
      perIndex.push({ ticker, percentChange7d: snap.percent_change_7d });
    }
  }

  if (perIndex.length === 0) return empty;

  const avg7d =
    perIndex.reduce((sum, x) => sum + x.percentChange7d, 0) / perIndex.length;

  // Map ±15% 7d move → ±1 confirmation, clamped.
  const confirmation = Math.max(-1, Math.min(1, -avg7d / 15));

  return {
    confirmation,
    avgPercentChange7d: avg7d,
    indicesRead: perIndex.length,
    perIndex,
  };
}

// =============================================================================
// 2. Macro Event Pause
// =============================================================================

export interface MacroPauseSignal {
  /** True if no high-impact events are within the window. */
  clear: boolean;
  /** True if we should completely skip new entries this cycle. */
  skipEntries: boolean;
  /** Multiplier for per-trade size when not skipping (1.0 = full, 0.5 = halve). */
  sizeMultiplier: number;
  /** Hours until the next high-impact event (null if none in window). */
  hoursUntilNext: number | null;
  /** The event that triggered the pause (if any). */
  triggeringEvent: SosovalueMacroEvent | null;
  /** Human-readable reason for logging/Telegram. */
  reason: string;
}

const DEFAULT_LOOKAHEAD_HOURS = 24;
const SKIP_ENTRIES_HOURS = 4; // skip new entries when event is this close
const HALVE_SIZE_HOURS = 12; // halve size when event is this close

/**
 * Look up the next high-impact macroeconomic event from SoSoValue and decide
 * whether the trading loop should pause or de-risk.
 *
 * Returns a CLEAR signal if no high-impact event is within `lookaheadHours`,
 * a HALVE signal if within `HALVE_SIZE_HOURS`, and a SKIP signal if within
 * `SKIP_ENTRIES_HOURS`. Position exits are never paused — only new entries.
 */
export async function fetchMacroPauseSignal(
  lookaheadHours: number = DEFAULT_LOOKAHEAD_HOURS,
  now: Date = new Date(),
): Promise<MacroPauseSignal> {
  const clear: MacroPauseSignal = {
    clear: true,
    skipEntries: false,
    sizeMultiplier: 1,
    hoursUntilNext: null,
    triggeringEvent: null,
    reason: "No high-impact macro events in window",
  };

  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  const [todayEvents, tomorrowEvents] = await Promise.all([
    sosovalueClient.fetchMacroEvents(today).catch(() => [] as SosovalueMacroEvent[]),
    sosovalueClient.fetchMacroEvents(tomorrow).catch(() => [] as SosovalueMacroEvent[]),
  ]);

  const all = [...todayEvents, ...tomorrowEvents].filter(
    (e) => e.impact === "high" && e.date,
  );
  if (all.length === 0) return clear;

  // Score each event by hours-from-now (skip past events, keep window).
  const scored = all
    .map((e) => {
      const t = parseEventTimestamp(e);
      if (t === null) return null;
      const hoursAway = (t - now.getTime()) / 3_600_000;
      return { event: e, hoursAway };
    })
    .filter((x): x is { event: SosovalueMacroEvent; hoursAway: number } => x !== null)
    .filter((x) => x.hoursAway >= 0 && x.hoursAway <= lookaheadHours)
    .sort((a, b) => a.hoursAway - b.hoursAway);

  if (scored.length === 0) return clear;

  const next = scored[0];

  if (next.hoursAway <= SKIP_ENTRIES_HOURS) {
    return {
      clear: false,
      skipEntries: true,
      sizeMultiplier: 0,
      hoursUntilNext: next.hoursAway,
      triggeringEvent: next.event,
      reason: `Skipping new entries — ${next.event.name} in ${next.hoursAway.toFixed(1)}h (high impact)`,
    };
  }

  if (next.hoursAway <= HALVE_SIZE_HOURS) {
    return {
      clear: false,
      skipEntries: false,
      sizeMultiplier: 0.5,
      hoursUntilNext: next.hoursAway,
      triggeringEvent: next.event,
      reason: `Halving trade size — ${next.event.name} in ${next.hoursAway.toFixed(1)}h (high impact)`,
    };
  }

  return {
    clear: false,
    skipEntries: false,
    sizeMultiplier: 1,
    hoursUntilNext: next.hoursAway,
    triggeringEvent: next.event,
    reason: `Watching ${next.event.name} (${next.hoursAway.toFixed(1)}h out)`,
  };
}

/**
 * Resolve a macro event's date (and optional time field) to a Unix ms timestamp.
 * Returns null for malformed events. Treats date-only events as 12:00 UTC.
 */
function parseEventTimestamp(event: SosovalueMacroEvent): number | null {
  if (!event.date) return null;
  // If the date includes a "T" assume it's a full ISO timestamp.
  if (event.date.includes("T")) {
    const t = Date.parse(event.date);
    return Number.isFinite(t) ? t : null;
  }
  // Date-only — anchor to 12:00 UTC so a same-day event scores in the window.
  const t = Date.parse(`${event.date}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

// =============================================================================
// 3. News Sentiment (per-symbol)
// =============================================================================

export interface NewsSentimentSignal {
  /** Per-symbol net sentiment score (−1 … +1, clamped). */
  perSymbol: Map<string, number>;
  /** Total number of news items aggregated. */
  totalItems: number;
}

/** Sentiment weights — explicit > inferred. */
const SENTIMENT_WEIGHT: Record<string, number> = {
  positive: 1,
  neutral: 0,
  negative: -1,
};

/**
 * Aggregate SoSoValue news into a per-symbol sentiment map.
 *
 * For each news item, every related currency gets the item's sentiment
 * contribution (default 0 if missing). The aggregate is divided by the number
 * of items mentioning that symbol so a heavily covered token isn't
 * mechanically dominant.
 */
export function computeNewsSentiment(
  news: readonly SosovalueFeedItem[],
): NewsSentimentSignal {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const item of news) {
    const related = item.related_currencies ?? [];
    if (related.length === 0) continue;
    const weight = SENTIMENT_WEIGHT[item.sentiment ?? "neutral"] ?? 0;
    for (const sym of related) {
      const key = sym.toUpperCase();
      const prev = totals.get(key) ?? { sum: 0, count: 0 };
      totals.set(key, { sum: prev.sum + weight, count: prev.count + 1 });
    }
  }

  const perSymbol = new Map<string, number>();
  for (const [sym, { sum, count }] of totals) {
    if (count === 0) continue;
    const avg = sum / count;
    perSymbol.set(sym, Math.max(-1, Math.min(1, avg)));
  }

  return { perSymbol, totalItems: news.length };
}

/**
 * Fetch hot + featured news in parallel and aggregate sentiment per symbol.
 * Returns an empty signal if SoSoValue is unreachable.
 */
export async function fetchNewsSentimentSignal(): Promise<NewsSentimentSignal> {
  const [hot, featured] = await Promise.all([
    sosovalueClient.fetchHotNews(10).catch(() => [] as SosovalueFeedItem[]),
    sosovalueClient.fetchFeaturedNews(10).catch(() => [] as SosovalueFeedItem[]),
  ]);
  const seen = new Set<string>();
  const merged: SosovalueFeedItem[] = [];
  for (const item of [...hot, ...featured]) {
    const key = item.id || item.title;
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return computeNewsSentiment(merged);
}
