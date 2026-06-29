/**
 * SoSoValue API Client
 *
 * Fetches market data from the SoSoValue OpenAPI.
 * Uses the x-soso-api-key header for authentication.
 *
 * Base URL: https://openapi.sosovalue.com/openapi/v1
 *
 * Implements the MarketDataProvider interface so it can be used alongside
 * the existing CmcClient — SoSoValue token prices preferred, CMC fills
 * regime data gaps (Fear & Greed, funding rates) that SoSoValue doesn't offer.
 *
 * SoSoValue-specific capabilities (beyond MarketDataProvider):
 *   - SSI Index data (constituents, market snapshots) → regime + quality signals
 *   - News feeds (hot, featured) → AI market narrative (Phase 3)
 *   - Macroeconomic events → regime context (Phase 3)
 *   - Klines → real RSI(14) instead of the current synthesized estimate
 *
 * Auth: x-soso-api-key header in every request.
 */

import type { MarketDataProvider } from "./types.js";
import type {
  CmcMarketData,
  TokenQuote,
} from "./cmc-client.js";

// =============================================================================
// SoSoValue Response Types
// =============================================================================

/** A currency from the /currencies listing. */
export interface SosovalueCurrency {
  id: string;
  symbol: string;
  name: string;
  /** Optional numeric rank. */
  market_cap_rank?: number;
  /** Optional pair count for liquidity signal. */
  pair_count?: number;
}

/** Market snapshot for a single currency. */
export interface SosovalueMarketSnapshot {
  id: string;
  symbol: string;
  name: string;
  /** ISO timestamp of this snapshot. */
  last_updated?: string;
  price_usd?: number;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  /** Percentage changes. */
  percent_change_1h?: number;
  percent_change_24h?: number;
  percent_change_7d?: number;
  /** Token economics (optional). */
  circulating_supply?: number;
  total_supply?: number;
  /** Trading pair count on SoDEX / tracked exchanges. */
  pair_count?: number;
}

/** Kline / OHLCV data point. */
export interface SosovalueKline {
  /** Unix timestamp in seconds (or ISO). */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** SSI (SoSoValue Index) listing. */
export interface SosovalueIndex {
  ticker: string;
  name: string;
  description?: string;
  /** Number of constituent tokens. */
  constituent_count?: number;
  /** Methodology description. */
  methodology?: string;
}

/** SSI Index market snapshot. */
export interface SosovalueIndexSnapshot {
  ticker: string;
  name: string;
  price?: number;
  percent_change_24h?: number;
  percent_change_7d?: number;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  last_updated?: string;
}

/** SSI Index constituent token. */
export interface SosovalueIndexConstituent {
  /** Currency ID in the SoSoValue system. */
  currency_id: string;
  symbol: string;
  name: string;
  /** Weight in the index (0–1 or percentage). */
  weight: number;
  /** Current price of the constituent. */
  price_usd?: number;
}

/** News feed item. */
export interface SosovalueFeedItem {
  id: string;
  title: string;
  /** ISO timestamp. */
  published_at: string;
  /** Short summary or snippet. */
  summary?: string;
  /** Source (e.g., "CoinDesk", "Twitter/X"). */
  source?: string;
  /** URL to the full article. */
  url?: string;
  /** Related currency symbols. */
  related_currencies?: string[];
  /** Sentiment classification if available. */
  sentiment?: "positive" | "negative" | "neutral";
}

/** Macroeconomic event. */
export interface SosovalueMacroEvent {
  id: string;
  name: string;
  /** ISO date of the event. */
  date: string;
  /** Description of the event. */
  description?: string;
  /** Category (e.g., "CPI", "FOMC", "Employment"). */
  category?: string;
  /** Previous value for comparison. */
  previous?: string;
  /** Consensus forecast. */
  forecast?: string;
  /** Actual released value (null before release). */
  actual?: string;
  /** Market impact classification. */
  impact?: "high" | "medium" | "low";
}

// =============================================================================
// Market Snapshot → TokenQuote mapping
// =============================================================================

/** Minimum snapshot fields needed for a valid TokenQuote. */
interface MinimumSnapshot {
  id: string | number;
  symbol: string;
  price_usd: number;
  percent_change_24h: number;
  percent_change_7d: number;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  percent_change_1h?: number;
  last_updated?: string;
}

/**
 * Map a SoSoValue market snapshot to a CMC-compatible TokenQuote.
 * Returns null if the snapshot lacks required fields (id, symbol, price).
 */
function snapshotToTokenQuote(snapshot: MinimumSnapshot): TokenQuote {
  return {
    id: typeof snapshot.id === "string" ? hashStringToNumber(snapshot.id) : snapshot.id,
    name: snapshot.symbol,
    symbol: snapshot.symbol.toUpperCase(),
    slug: snapshot.symbol.toLowerCase(),
    price: snapshot.price_usd,
    volume24h: snapshot.volume_24h_usd ?? 0,
    marketCap: snapshot.market_cap_usd ?? 0,
    percentChange1h: snapshot.percent_change_1h ?? 0,
    percentChange24h: snapshot.percent_change_24h,
    percentChange7d: snapshot.percent_change_7d,
    lastUpdated: snapshot.last_updated ?? "",
  };
}

/**
 * Deterministic numeric hash from a string ID.
 * CMC uses numeric IDs internally; SoSoValue uses string IDs.
 * This maps string IDs to a stable numeric range for TokenQuote.id.
 */
function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// =============================================================================
// REST Client
// =============================================================================

const DEFAULT_BASE_URL = "https://openapi.sosovalue.com/openapi/v1";

/**
 * Make a GET request to the SoSoValue REST API.
 * Returns null on any non-200 or network error (never throws).
 */
async function restGet<T = Record<string, unknown>>(
  path: string,
  apiKey: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<T | null> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        "x-soso-api-key": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[SoSoValue] HTTP ${response.status} for ${path}: ${response.statusText}`);
      return null;
    }

    const json = (await response.json()) as Record<string, unknown>;

    // SoSoValue likely wraps data in a `data` field (common API pattern)
    if (json && typeof json === "object" && "data" in json) {
      return json.data as T;
    }

    return json as unknown as T;
  } catch (error) {
    console.warn(`[SoSoValue] Request failed for ${path}:`, error);
    return null;
  }
}

/**
 * Extract a paginated list, handling both `data.items` and `data` arrays.
 */
function extractList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const items = (raw as Record<string, unknown>).items;
    if (Array.isArray(items)) return items as T[];
    const list = (raw as Record<string, unknown>).list;
    if (Array.isArray(list)) return list as T[];
    const records = (raw as Record<string, unknown>).records;
    if (Array.isArray(records)) return records as T[];
  }
  return [];
}

// =============================================================================
// SoSoValue Client
// =============================================================================

export class SosovalueClient implements MarketDataProvider {
  readonly name = "sosovalue" as const;
  private apiKey: string;
  private baseUrl: string;

  /**
   * Symbol → currency ID cache (populated by fetchCurrencies).
   * Currency IDs are the SoSoValue internal identifiers used in
   * /currencies/{id}/market-snapshot and similar paths.
   */
  private currencyIdCache = new Map<string, { id: string; symbol: string; name: string }>();

  /** TTL for the currency cache (5 minutes — currency list rarely changes). */
  private currencyCacheLastFetched = 0;
  private static readonly CURRENCY_CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.SOSOVALUE_API_KEY || "";
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  }

  // ===========================================================================
  // MarketDataProvider Interface
  // ===========================================================================

  /**
   * Fetch current price for a token by symbol.
   * Resolves the symbol to a currency ID, then fetches the market snapshot.
   */
  async fetchTokenPrice(symbol: string): Promise<number> {
    if (!symbol) return 0;
    const snapshot = await this.getQuote(symbol);
    return snapshot?.price ?? 0;
  }

  /**
   * SoSoValue does not provide a Fear & Greed index.
   * Returns 50 (neutral) so callers fall back to CMC.
   */
  async fetchFearGreedIndex(): Promise<number> {
    return 50;
  }

  /**
   * SoSoValue does not provide derivatives funding rates.
   * Returns empty so callers fall back to CMC.
   */
  async fetchFundingRates(): Promise<Record<string, number>> {
    return {};
  }

  // ===========================================================================
  // High-Level Data Fetching
  // ===========================================================================

  /**
   * Fetch market data from SoSoValue.
   *
   * SoSoValue can provide token prices (via market snapshots) and potentially
   * index-based regime signals, but does NOT provide Fear & Greed index or
   * derivatives funding rates — those fields will be null so the composite
   * provider in index.ts can fill them from CMC.
   */
  async fetchMarketData(): Promise<CmcMarketData> {
    const tokenPrices = await this.getEligibleTokenQuotes();

    return {
      globalMetrics: null,     // CMC provides this
      derivatives: null,        // CMC provides this
      tokenPrices,
      tokenHolders: [],         // Not available via SoSoValue
      trendingNarratives: [],   // Not available via SoSoValue
    };
  }

  // ===========================================================================
  // Currency Resolution
  // ===========================================================================

  /**
   * Fetch the full currency list from /currencies and cache it.
   * Returns a Map<symbol, {id, symbol, name}> for ID resolution.
   */
  async fetchCurrencies(): Promise<SosovalueCurrency[]> {
    const now = Date.now();
    if (
      this.currencyIdCache.size > 0 &&
      now - this.currencyCacheLastFetched < SosovalueClient.CURRENCY_CACHE_TTL_MS
    ) {
      return Array.from(this.currencyIdCache.values());
    }

    const raw = await restGet<unknown>("/currencies", this.apiKey, this.baseUrl);
    const currencies = extractList<SosovalueCurrency>(raw);

    if (currencies.length > 0) {
      this.currencyIdCache.clear();
      for (const c of currencies) {
        if (c.id && c.symbol) {
          this.currencyIdCache.set(c.symbol.toUpperCase(), {
            id: c.id,
            symbol: c.symbol,
            name: c.name,
          });
        }
      }
      this.currencyCacheLastFetched = now;
    }

    return currencies;
  }

  /**
   * Resolve a token symbol to its SoSoValue currency ID.
   * Populates the cache on first call.
   */
  private async resolveCurrencyId(symbol: string): Promise<string | null> {
    const upper = symbol.toUpperCase();

    // Check cache first (populated by fetchCurrencies or a previous market snapshot fetch)
    const cached = this.currencyIdCache.get(upper);
    if (cached) return cached.id;

    // Try resolving via the /currencies list
    const currencies = await this.fetchCurrencies();
    const match = currencies.find((c) => c.symbol.toUpperCase() === upper);
    if (match?.id) return match.id;

    // Not found in the SoSoValue currency list — this token may not be covered
    return null;
  }

  // ===========================================================================
  // Market Data Methods
  // ===========================================================================

  /**
   * Get the market snapshot for a single currency by its SoSoValue ID.
   * /currencies/{currency_id}/market-snapshot
   */
  async fetchMarketSnapshot(currencyId: string): Promise<SosovalueMarketSnapshot | null> {
    const raw = await restGet<Record<string, unknown>>(
      `/currencies/${encodeURIComponent(currencyId)}/market-snapshot`,
      this.apiKey,
      this.baseUrl,
    );
    if (!raw) return null;

    return this.parseSnapshot(raw);
  }

  /**
   * Get a quote for a token by symbol.
   * Returns a TokenQuote compatible with the conviction engine.
   */
  async getQuote(symbol: string): Promise<TokenQuote | null> {
    if (!symbol) return null;

    const currencyId = await this.resolveCurrencyId(symbol);
    if (!currencyId) return null;

    const snapshot = await this.fetchMarketSnapshot(currencyId);
    if (!snapshot) return null;

    return snapshotToTokenQuote({
      id: currencyId,
      symbol: snapshot.symbol || symbol,
      price_usd: snapshot.price_usd ?? 0,
      percent_change_24h: snapshot.percent_change_24h ?? 0,
      percent_change_7d: snapshot.percent_change_7d ?? 0,
      market_cap_usd: snapshot.market_cap_usd,
      volume_24h_usd: snapshot.volume_24h_usd,
      percent_change_1h: snapshot.percent_change_1h,
      last_updated: snapshot.last_updated,
    });
  }

  /**
   * Get price quotes for all eligible tokens by symbol batch.
   * Batches by resolving currency IDs first, then fetching snapshots.
   */
  /**
   * Get price quotes for all eligible tokens by symbol batch.
   * Batches by resolving currency IDs first, then fetching snapshots.
   */
  async getEligibleTokenQuotes(): Promise<TokenQuote[]> {
    const { AGENT_CONFIG } = await import("./config.js");
    const symbols = AGENT_CONFIG.competition.eligibleTokens;
    return this.batchFetchQuotes(symbols);
  }

  /**
   * Shared batch-fetch implementation. Resolves currency IDs, fetches market
   * snapshots, and returns TokenQuote[] for all SoSoValue-covered tokens.
   */
  private async batchFetchQuotes(symbols: string[]): Promise<TokenQuote[]> {
    // Populate the currency cache if not already done
    await this.fetchCurrencies();

    const quotes: TokenQuote[] = [];

    for (const symbol of symbols) {
      const currencyId = this.currencyIdCache.get(symbol.toUpperCase())?.id;
      if (!currencyId) continue; // Token not found in SoSoValue — will be filled by CMC fallback

      const snapshot = await this.fetchMarketSnapshot(currencyId);
      if (snapshot && typeof snapshot.price_usd === "number" && snapshot.price_usd > 0) {
        quotes.push(
          snapshotToTokenQuote({
            id: currencyId,
            symbol: snapshot.symbol || symbol,
            price_usd: snapshot.price_usd,
            percent_change_24h: snapshot.percent_change_24h ?? 0,
            percent_change_7d: snapshot.percent_change_7d ?? 0,
            market_cap_usd: snapshot.market_cap_usd,
            volume_24h_usd: snapshot.volume_24h_usd,
            percent_change_1h: snapshot.percent_change_1h,
            last_updated: snapshot.last_updated,
          }),
        );
      }
    }

    if (quotes.length > 0) {
      console.log(`[SoSoValue] Fetched ${quotes.length}/${symbols.length} token quotes`);
    }

    return quotes;
  }

  // ===========================================================================
  // Klines (for real RSI calculation, Phase 3)
  // ===========================================================================

  /**
   * Fetch historical klines for a currency.
   * /currencies/{currency_id}/klines
   *
   * Used to compute a real RSI(14) instead of the current synthesized estimate.
   *
   * @param currencyId - SoSoValue currency ID
   * @param interval - Kline interval (e.g., "1d", "4h", "1h"). Default "1d".
   * @param limit - Number of klines to fetch. Default 30 (30 days of daily data).
   */
  async fetchKlines(
    currencyId: string,
    interval: string = "1d",
    limit: number = 30,
  ): Promise<SosovalueKline[]> {
    const raw = await restGet<unknown>(
      `/currencies/${encodeURIComponent(currencyId)}/klines?interval=${encodeURIComponent(interval)}&limit=${limit}`,
      this.apiKey,
      this.baseUrl,
    );
    const items = extractList<SosovalueKline>(raw);
    return items;
  }

  // ===========================================================================
  // SSI Index Methods (for regime/quality signals, Phase 3)
  // ===========================================================================

  /**
   * Get the list of all SoSoValue Indices.
   * /indices
   */
  async fetchIndices(): Promise<SosovalueIndex[]> {
    const raw = await restGet<unknown>("/indices", this.apiKey, this.baseUrl);
    return extractList<SosovalueIndex>(raw);
  }

  /**
   * Get the market snapshot for a specific index.
   * /indices/{index_ticker}/market-snapshot
   */
  async fetchIndexSnapshot(indexTicker: string): Promise<SosovalueIndexSnapshot | null> {
    const raw = await restGet<Record<string, unknown>>(
      `/indices/${encodeURIComponent(indexTicker)}/market-snapshot`,
      this.apiKey,
      this.baseUrl,
    );
    if (!raw) return null;

    return {
      ticker: String(raw.ticker ?? raw.symbol ?? indexTicker),
      name: String(raw.name ?? ""),
      price: safeNumber(raw.price ?? raw.price_usd),
      percent_change_24h: safeNumber(raw.percent_change_24h),
      percent_change_7d: safeNumber(raw.percent_change_7d),
      market_cap_usd: safeNumber(raw.market_cap_usd),
      volume_24h_usd: safeNumber(raw.volume_24h_usd),
      last_updated: String(raw.last_updated ?? ""),
    };
  }

  /**
   * Get the constituent tokens and their weights for an index.
   * /indices/{index_ticker}/constituents
   */
  async fetchIndexConstituents(indexTicker: string): Promise<SosovalueIndexConstituent[]> {
    const raw = await restGet<unknown>(
      `/indices/${encodeURIComponent(indexTicker)}/constituents`,
      this.apiKey,
      this.baseUrl,
    );
    return extractList<SosovalueIndexConstituent>(raw);
  }

  // ===========================================================================
  // News / Feeds Methods (for AI market narrative, Phase 3)
  // ===========================================================================

  /**
   * Fetch the latest news feed.
   * /news
   */
  async fetchFeeds(limit: number = 20): Promise<SosovalueFeedItem[]> {
    const raw = await restGet<unknown>(
      `/news?limit=${limit}`,
      this.apiKey,
      this.baseUrl,
    );
    return extractList<SosovalueFeedItem>(raw);
  }

  /**
   * Fetch hot/trending news.
   * /news/hot
   */
  async fetchHotNews(limit: number = 10): Promise<SosovalueFeedItem[]> {
    const raw = await restGet<unknown>(
      `/news/hot?limit=${limit}`,
      this.apiKey,
      this.baseUrl,
    );
    return extractList<SosovalueFeedItem>(raw);
  }

  /**
   * Fetch featured news.
   * /news/featured
   */
  async fetchFeaturedNews(limit: number = 10): Promise<SosovalueFeedItem[]> {
    const raw = await restGet<unknown>(
      `/news/featured?limit=${limit}`,
      this.apiKey,
      this.baseUrl,
    );
    return extractList<SosovalueFeedItem>(raw);
  }

  // ===========================================================================
  // Macroeconomic Events (for regime context, Phase 3)
  // ===========================================================================

  /**
   * Fetch macroeconomic events for a given date.
   * /macro/events
   *
   * @param date - Optional ISO date string (e.g., "2024-01-15"). Defaults to today.
   */
  async fetchMacroEvents(date?: string): Promise<SosovalueMacroEvent[]> {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const raw = await restGet<unknown>(
      `/macro/events${query}`,
      this.apiKey,
      this.baseUrl,
    );
    return extractList<SosovalueMacroEvent>(raw);
  }

  // ===========================================================================
  // Health Check
  // ===========================================================================

  /**
   * Quick health check — verifies the API key works by fetching the
   * currency list.
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Use /currencies with a small limit for a lightweight check
      const currencies = await this.fetchCurrencies();
      if (currencies.length > 0) {
        console.log(`[SoSoValue] Connected — ${currencies.length} currencies available`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Parse a raw API response object into a typed SosovalueMarketSnapshot.
   * Handles flexible field naming (snake_case, camelCase, nested).
   */
  private parseSnapshot(raw: Record<string, unknown>): SosovalueMarketSnapshot | null {
    if (!raw) return null;

    // Extract the symbol/id from multiple possible locations
    const symbol = String(raw.symbol ?? raw.ticker ?? raw.name ?? "");
    const id = String(raw.id ?? raw.currency_id ?? "");

    // Extract price data from the top level or a nested market_data object
    const md = (raw.market_data as Record<string, unknown> | undefined) ?? raw;

    return {
      id: id || symbol,
      symbol,
      name: String(raw.name ?? symbol ?? ""),
      last_updated: String(raw.last_updated ?? md.last_updated ?? ""),
      price_usd: pickNumber(md, ["price_usd", "price", "current_price"]),
      market_cap_usd: pickNumber(md, ["market_cap_usd", "market_cap", "marketCap"]),
      volume_24h_usd: pickNumber(md, ["volume_24h_usd", "volume_24h", "total_volume", "volume24h"]),
      percent_change_1h: pickNumber(md, [
        "percent_change_1h", "price_change_percentage_1h_in_currency",
        "percentChange1h",
      ]),
      percent_change_24h: pickNumber(md, [
        "percent_change_24h", "price_change_percentage_24h",
        "percentChange24h",
      ]),
      percent_change_7d: pickNumber(md, [
        "percent_change_7d", "price_change_percentage_7d_in_currency",
        "percentChange7d",
      ]),
      circulating_supply: pickNumber(md, ["circulating_supply", "circulatingSupply"]),
      total_supply: pickNumber(md, ["total_supply", "totalSupply"]),
      pair_count: pickNumber(raw, ["pair_count", "pairCount", "pair_count_24h"]),
    };
  }
}

// =============================================================================
// Standalone Helpers
// =============================================================================

/**
 * Safe number extraction — accepts number, string, or undefined.
 */
function safeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

/**
 * Try multiple field names from an object and return the first valid number.
 */
function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && !Number.isNaN(val)) return val;
  }
  return undefined;
}

// =============================================================================
// Singleton
// =============================================================================

/** Default SoSoValue client instance. Reads SOSOVALUE_API_KEY from env. */
export const sosovalueClient = new SosovalueClient();
