/**
 * SoSoValue Trading Signals
 *
 * Turns SoSoValue data — that was previously fetched only for narrative text —
 * into concrete inputs to the trading loop:
 *
 *   1. SSI Index Confirmation — corroborates the contrarian regime score with
 *      on-chain SSI basket price action (ssiMAG7 / ssiLayer1 / ssiAI down 7d
 *      = real fear, independent of FGI sentiment).
 *
 *   2. Macro Event Pause — when a high-impact macroeconomic event (CPI, FOMC,
 *      Employment) is within the look-ahead window, halve trade size or skip
 *      new entries entirely to avoid trading into known volatility. Impact
 *      level is keyword-inferred from the event name since the SoSoValue
 *      response doesn't carry it.
 *
 *   3. News Sentiment — aggregates SoSoValue news per symbol and produces a
 *      ±10pp adjustment to per-token conviction. Featured news carries a
 *      structured `matchedCurrencies` tag; hot news carries only free text,
 *      so we keyword-extract symbols from the title for it. Sentiment is
 *      inferred from a small wordlist applied to the title.
 *
 * Each function degrades gracefully — if SoSoValue is offline, the trading
 * loop continues with the prior behaviour (no SSI boost, no pause, no news
 * adjustment).
 */

import { sosovalueClient } from "./data-providers.js";

// =============================================================================
// 1. SSI Index Regime Confirmation
// =============================================================================

/**
 * SSI baskets we read each cycle as the contrarian regime confirmation.
 * Picked from the live SoSoValue /indices catalog as the broadest cross-section:
 *   - ssiMAG7    — top-7 market cap (mostly BTC/ETH-adjacent)
 *   - ssiLayer1  — base-layer chains
 *   - ssiAI      — AI narrative basket
 *   - ssiMeme    — meme/risk-on basket
 *
 * The agent silently skips any ticker SoSoValue doesn't recognise.
 */
const SSI_REGIME_TICKERS = ["ssiMAG7", "ssiLayer1", "ssiAI", "ssiMeme"] as const;

export interface SsiRegimeSignal {
  /** −1 (strong fear confirmation) … +1 (strong fear contradiction). */
  confirmation: number;
  /** Average 7d return % across the SSI baskets we could read. 0 if none. */
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
 *
 * SoSoValue returns ROI as a decimal (e.g. -0.0374 = -3.74%) on the field
 * `roi_7d`. We normalise to a percentage so downstream callers don't have to
 * remember the unit.
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
    const snap = snapshots[i] as Record<string, unknown> | null;
    const ticker = SSI_REGIME_TICKERS[i];
    if (!snap) continue;
    // Real SoSoValue field is `roi_7d` (decimal). Older response shape used
    // `percent_change_7d` (already a percent). Accept either, then normalise.
    const roi7d = snap.roi_7d;
    const pct7d = snap.percent_change_7d;
    let percentChange7d: number | null = null;
    if (typeof roi7d === "number" && Number.isFinite(roi7d)) {
      percentChange7d = roi7d * 100;
    } else if (typeof pct7d === "number" && Number.isFinite(pct7d)) {
      percentChange7d = pct7d;
    }
    if (percentChange7d !== null) {
      perIndex.push({ ticker, percentChange7d });
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

export interface MacroPauseEvent {
  /** Event display name from the SoSoValue calendar. */
  name: string;
  /** ISO date the event falls on (no time component in the source feed). */
  date: string;
  /** Inferred impact tier from the event name keywords. */
  impact: "high" | "medium" | "low";
}

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
  triggeringEvent: MacroPauseEvent | null;
  /** Human-readable reason for logging/Telegram. */
  reason: string;
}

const DEFAULT_LOOKAHEAD_HOURS = 24;
const SKIP_ENTRIES_HOURS = 4; // skip new entries when event is this close
const HALVE_SIZE_HOURS = 12; // halve size when event is this close

/**
 * Keyword-based impact inference. The SoSoValue macro feed returns only the
 * event NAME — no impact tier — so we map known high-stakes economic events to
 * "high"/"medium". Anything unrecognised is "low" and treated as background.
 *
 * High = market-moving regularly (CPI prints have moved BTC ±5% same-day).
 * Medium = watched but rarely moves crypto alone.
 *
 * Exported so the narrative composer can apply the same labelling.
 */
export function inferMacroImpact(eventName: string): "high" | "medium" | "low" {
  const n = eventName.toLowerCase();
  // High-impact: FOMC decisions, CPI, NFP, FOMC minutes.
  if (
    /\bfomc\b|\bfederal\s+reserve\b|\binterest\s+rate\s+decision\b/.test(n) ||
    /\bcpi\b|\bconsumer\s+price\s+index\b|\binflation\s+rate\b/.test(n) ||
    /\bnfp\b|\bnonfarm\s+payrolls?\b|\bunemployment\s+rate\b/.test(n)
  ) {
    return "high";
  }
  // Medium-impact: PPI, GDP, retail sales, ISM Manufacturing/Services PMI.
  if (
    /\bppi\b|\bproducer\s+price\b/.test(n) ||
    /\bgdp\b|\bgross\s+domestic\s+product\b/.test(n) ||
    /\bretail\s+sales\b|\bism\s+(manufacturing|non-?manufacturing|services)\s+pmi\b/.test(n) ||
    /\bjobless\s+claims\b|\binitial\s+claims\b/.test(n)
  ) {
    return "medium";
  }
  return "low";
}

/**
 * Look up the next high-impact macroeconomic event from SoSoValue and decide
 * whether the trading loop should pause or de-risk.
 *
 * The /macro/events endpoint returns a list of `{date, events: string[]}`
 * daily groups. We flatten, infer per-event impact from the name, keep only
 * high-impact events within the look-ahead window, and pick the soonest.
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

  // The macro endpoint is date-agnostic — it returns the upcoming calendar
  // in one shot. We pass no date and flatten the daily groups ourselves.
  const raw = await sosovalueClient.fetchMacroEvents().catch(() => [] as unknown[]);
  const flat = flattenMacroEvents(raw);

  const upcoming = flat
    .filter((e) => e.impact === "high")
    .map((e) => {
      const t = parseEventTimestamp(e.date);
      if (t === null) return null;
      const hoursAway = (t - now.getTime()) / 3_600_000;
      return { event: e, hoursAway };
    })
    .filter((x): x is { event: MacroPauseEvent; hoursAway: number } => x !== null)
    .filter((x) => x.hoursAway >= 0 && x.hoursAway <= lookaheadHours)
    .sort((a, b) => a.hoursAway - b.hoursAway);

  if (upcoming.length === 0) return clear;

  const next = upcoming[0];

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
 * Flatten the SoSoValue `/macro/events` response into a list of typed events.
 * Accepts both the live schema (`{date, events: string[]}`) and the legacy
 * mock shape (`{name, date, impact}`). Exported so the narrative composer
 * shares the same labelling logic as the trade-gate.
 */
export function flattenMacroEvents(raw: unknown): MacroPauseEvent[] {
  const flat: MacroPauseEvent[] = [];
  if (!Array.isArray(raw)) return flat;
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== "object") continue;
    const date = typeof entry.date === "string" ? entry.date : null;
    if (!date) continue;

    // Live schema: `{date, events: string[]}` — array of event names.
    const events = entry.events;
    if (Array.isArray(events)) {
      for (const eventName of events) {
        if (typeof eventName !== "string" || !eventName) continue;
        flat.push({ name: eventName, date, impact: inferMacroImpact(eventName) });
      }
      continue;
    }

    // Backwards-compat: older mocks supplied a flat `{name, impact}` per row.
    const name = typeof entry.name === "string" ? entry.name : null;
    if (name) {
      const impact =
        entry.impact === "high" || entry.impact === "medium" || entry.impact === "low"
          ? entry.impact
          : inferMacroImpact(name);
      flat.push({ name, date, impact });
    }
  }
  return flat;
}

/**
 * Resolve a macro event's date (no time component in the source feed) to a
 * Unix ms timestamp. Anchors to 12:00 UTC so a same-day event scores inside
 * the look-ahead window. Returns null for malformed input.
 */
function parseEventTimestamp(date: string): number | null {
  if (!date) return null;
  if (date.includes("T")) {
    const t = Date.parse(date);
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

// =============================================================================
// 3. News Sentiment (per-symbol)
// =============================================================================

/**
 * A SoSoValue news item normalised across the two endpoint variants:
 *   - /news/hot      uses snake_case fields (id, source_link, release_time, title, content)
 *     and has NO currency tags or sentiment label.
 *   - /news/featured uses camelCase + carries `matchedCurrencies: [{name, fullName}]`
 *     so we get tagged symbols for free.
 *
 * Both lack an explicit sentiment field; we keyword-infer from the title.
 * `sentimentWord` is kept for backwards compatibility with mocked test data.
 */
export interface NormalisedNewsItem {
  id: string;
  title: string;
  /** Optional explicit sentiment (used by older mocks; real API never sets it). */
  sentimentWord?: "positive" | "negative" | "neutral";
  /** Symbols structurally tagged by the API (only featured news). */
  matchedSymbols: string[];
}

export interface NewsSentimentSignal {
  /** Per-symbol net sentiment score (−1 … +1, clamped). */
  perSymbol: Map<string, number>;
  /** Total number of news items aggregated. */
  totalItems: number;
}

/** Word-level sentiment cues. Tight whitelist — favour precision over recall. */
const POSITIVE_WORDS = [
  "surge", "soar", "rally", "rallies", "jump", "jumps", "gain", "gains",
  "approve", "approved", "approval", "adopt", "adoption", "partnership",
  "launch", "launches", "milestone", "record-high", "all-time-high",
  "breakthrough", "wins", "victory", "upgrade", "bullish",
];
const NEGATIVE_WORDS = [
  "crash", "plunge", "tumble", "slump", "drop", "drops", "fall", "falls",
  "hack", "hacked", "exploit", "exploited", "stolen", "theft",
  "lawsuit", "sue", "sued", "delist", "delisted", "reject", "rejected",
  "ban", "banned", "outflow", "outflows", "liquidate", "liquidation",
  "bearish", "warning", "fraud", "scam",
];

function inferSentimentFromTitle(title: string): number {
  const t = title.toLowerCase();
  let score = 0;
  for (const w of POSITIVE_WORDS) {
    if (t.includes(w)) score += 1;
  }
  for (const w of NEGATIVE_WORDS) {
    if (t.includes(w)) score -= 1;
  }
  if (score === 0) return 0;
  // Compress to ±1 so a multi-word title doesn't dominate the aggregate.
  return score > 0 ? 1 : -1;
}

/**
 * Extract eligible token symbols mentioned in a news title.
 * Conservative — only matches the literal symbol surrounded by word boundaries,
 * uppercase only. Skips common 3-letter words that would false-match (USD,
 * AND, etc.) by requiring the symbol to be in the supplied universe.
 */
function extractSymbolsFromTitle(title: string, universe: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  // Match standalone uppercase tokens 2–6 chars long (typical ticker length).
  const tokens = title.match(/\b[A-Z][A-Z0-9]{1,5}\b/g) ?? [];
  for (const tok of tokens) {
    if (universe.has(tok)) found.add(tok);
  }
  return [...found];
}

/**
 * Aggregate normalised news items into a per-symbol sentiment map.
 *
 * For each item, every tagged or extracted symbol receives the item's
 * sentiment weight. The aggregate is divided by the count of items mentioning
 * that symbol, so a heavily-covered token doesn't mechanically dominate.
 *
 * Sentiment weight priority:
 *   1. explicit `sentimentWord` (older mocks only)
 *   2. keyword-inferred from title
 */
export function computeNewsSentiment(
  news: readonly NormalisedNewsItem[],
): NewsSentimentSignal {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const item of news) {
    if (item.matchedSymbols.length === 0) continue;
    let weight: number;
    if (item.sentimentWord) {
      weight = item.sentimentWord === "positive" ? 1 : item.sentimentWord === "negative" ? -1 : 0;
    } else {
      weight = inferSentimentFromTitle(item.title);
    }
    for (const sym of item.matchedSymbols) {
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
 * Normalise a single raw news item from either /news/hot or /news/featured
 * into the shape `computeNewsSentiment` expects. `universe` is the set of
 * candidate token symbols (uppercased) we'd accept from a free-text title.
 */
function normaliseNewsItem(
  raw: Record<string, unknown>,
  universe: ReadonlySet<string>,
): NormalisedNewsItem | null {
  const id = typeof raw.id === "string" || typeof raw.id === "number" ? String(raw.id) : "";
  const title = typeof raw.title === "string" ? raw.title : "";
  if (!id && !title) return null;

  const matched = new Set<string>();
  // Featured news carries structured tags via matchedCurrencies.
  const mc = raw.matchedCurrencies;
  if (Array.isArray(mc)) {
    for (const c of mc) {
      if (c && typeof c === "object") {
        const name = (c as Record<string, unknown>).name;
        if (typeof name === "string" && name.length > 0) {
          matched.add(name.toUpperCase());
        }
      }
    }
  }
  // Backwards compat: older mocks supplied `related_currencies: string[]`.
  const rel = raw.related_currencies;
  if (Array.isArray(rel)) {
    for (const sym of rel) {
      if (typeof sym === "string" && sym.length > 0) matched.add(sym.toUpperCase());
    }
  }
  // Hot news has no tags — keyword-extract from title.
  if (matched.size === 0 && title) {
    for (const sym of extractSymbolsFromTitle(title, universe)) {
      matched.add(sym);
    }
  }

  const sentimentRaw = raw.sentiment;
  const sentimentWord =
    sentimentRaw === "positive" || sentimentRaw === "negative" || sentimentRaw === "neutral"
      ? (sentimentRaw as "positive" | "negative" | "neutral")
      : undefined;

  return {
    id,
    title,
    sentimentWord,
    matchedSymbols: [...matched],
  };
}

/**
 * Fetch hot + featured news in parallel and aggregate sentiment per symbol.
 * Returns an empty signal if SoSoValue is unreachable.
 *
 * @param universe — eligible token symbols (UPPERCASE). Required so we can
 *   keyword-extract from /news/hot titles without false-matching common
 *   3-letter words.
 */
export async function fetchNewsSentimentSignal(
  universe: ReadonlySet<string>,
): Promise<NewsSentimentSignal> {
  const [hot, featured] = await Promise.all([
    sosovalueClient.fetchHotNews(10).catch(() => [] as unknown[]),
    sosovalueClient.fetchFeaturedNews(10).catch(() => [] as unknown[]),
  ]);

  const seen = new Set<string>();
  const merged: NormalisedNewsItem[] = [];
  for (const raw of [...hot, ...featured] as Array<Record<string, unknown>>) {
    const item = normaliseNewsItem(raw, universe);
    if (!item) continue;
    const key = item.id || item.title;
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return computeNewsSentiment(merged);
}
