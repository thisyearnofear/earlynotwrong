/**
 * CMC Agent Hub Client
 *
 * Wraps the CoinMarketCap AI Agent Hub MCP server as a typed client.
 * Uses JSON-RPC 2.0 over HTTP (Streamable HTTP transport).
 * Supports both API key auth and x402 (keyless, pay-per-request).
 *
 * CMC MCP endpoint: https://mcp.coinmarketcap.com/mcp
 * Auth: X-CMC-MCP-API-KEY header or x402 (no key)
 *
 * NOTE: CMC provides market-level data (prices, sentiment, derivatives),
 * not wallet-level data. For wallet-level data (which wallets to copy),
 * we'll need a separate integration (BscScan API, Helius on BSC, etc.).
 * This is noted in the risk register.
 */

import { AGENT_CONFIG } from "./config.js";
import type { MarketDataProvider, WalletConviction } from "./types.js";

// =============================================================================
// Types
// =============================================================================

export interface CmcIdMap {
  /** Token symbol → CMC ID lookup, populated by search_cryptos */
  [symbol: string]: number;
}

export interface GlobalMetrics {
  totalMarketCapUsd: number;
  btcDominance: number;
  ethDominance: number;
  fearGreedIndex: number;
  totalVolumeUsd: number;
  lastUpdated: number;
}

export interface DerivativesMetrics {
  totalOpenInterestUsd: number;
  totalVolume24hUsd: number;
  btcFundingRate: number;
  ethFundingRate: number;
  liquidationData: {
    longLiquidations24h: number;
    shortLiquidations24h: number;
  } | null;
  lastUpdated: number;
}

export interface TokenQuote {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  price: number;
  volume24h: number;
  marketCap: number;
  percentChange1h: number;
  percentChange24h: number;
  percentChange7d: number;
  lastUpdated: string;
}

export interface TokenMetrics {
  id: number;
  symbol: string;
  holderCount: number;
  whaleHolderCount: number;
  whalePercentOfSupply: number;
  averageHolderBalance: number;
}

export interface TrendingNarrative {
  name: string;
  description: string;
  volume24h: number;
  percentChange24h: number;
  topCoins: Array<{ id: number; symbol: string; name: string }>;
}

export interface CmcMarketData {
  globalMetrics: GlobalMetrics | null;
  derivatives: DerivativesMetrics | null;
  tokenPrices: TokenQuote[];
  tokenHolders: TokenMetrics[];
  trendingNarratives: TrendingNarrative[];
}

// =============================================================================
// Lightweight MCP Client (no SDK dependency)
// =============================================================================

type JsonRpcResponse = {
  jsonrpc: string;
  id: number;
  result?: { content?: Array<{ type: string; text: string }> };
  error?: { code: number; message: string };
};

/**
 * Makes a JSON-RPC call to the CMC MCP endpoint.
 * Uses the Streamable HTTP transport with X-CMC-MCP-API-KEY authentication.
 * If no API key is set, tries x402 (keyless) mode.
 */
async function callMcpTool(
  toolName: string,
  args: Record<string, unknown> = {},
  options: { apiKey?: string; useX402?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  const { apiKey, useX402 } = options;
  const endpoint = AGENT_CONFIG.cmc.mcpEndpoint;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (apiKey) {
    headers["X-CMC-MCP-API-KEY"] = apiKey;
  }

  // x402 mode requires a wallet to sign a payment (TWAK + @pinata/api).
  // This is not yet implemented — wire to TWAK signing in Sprint 3.
  // TODO: Replace with TWAK x402 signing via @pinata/api skill.
  if (useX402) {
    throw new Error(
      `x402 not yet implemented — wire to TWAK signing in Sprint 3. ` +
      `Call with an API key or set CMC_API_KEY env var to use MCP auth.`
    );
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
    id: 1,
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      // MCP uses streaming for some responses; accept both streaming and JSON
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`CMC MCP error ${response.status} for tool ${toolName}: ${response.statusText}`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      // SSE response — read the stream
      const reader = response.body?.getReader();
      if (!reader) return null;
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      return parseSseResponse(text);
    }

    // JSON response
    const data: JsonRpcResponse = await response.json();

    if (data.error) {
      console.warn(`CMC MCP tool ${toolName} error: ${data.error.message}`);
      return null;
    }

    return extractContent(data);
  } catch (error) {
    console.warn(`CMC MCP request failed for ${toolName}:`, error);
    return null;
  }
}

/** Parse a text/event-stream response into a JSON object. */
function parseSseResponse(text: string): Record<string, unknown> | null {
  // SSE format lines: "event: result", "data: { ... }", "\n"
  // We only care about the data lines with valid JSON-RPC payloads.
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        const data: JsonRpcResponse = JSON.parse(line.slice(6));
        return extractContent(data);
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Extract the text content from a JSON-RPC result. */
function extractContent(data: JsonRpcResponse): Record<string, unknown> | null {
  const content = data.result?.content;
  if (!content || content.length === 0) return null;

  // Find the first text content item
  const textItem = content.find((c) => c.type === "text");
  if (!textItem) return null;

  try {
    return JSON.parse(textItem.text);
  } catch {
    // Text content might not be JSON; return as-is wrapped
    return { text: textItem.text };
  }
}

// =============================================================================
// Token ID Resolution (Cache to avoid repeated searches)
// =============================================================================

const TOKEN_ID_CACHE = new Map<string, number>();

/**
 * Resolve a token symbol to its CMC ID using search_cryptos.
 * Results are cached in-memory.
 */
async function resolveTokenId(
  symbol: string,
  apiKey?: string
): Promise<number | null> {
  const upper = symbol.toUpperCase();
  if (TOKEN_ID_CACHE.has(upper)) return TOKEN_ID_CACHE.get(upper)!;

  const result = await callMcpTool("search_cryptos", { query: symbol }, { apiKey });
  if (!result) return null;

  // search_cryptos returns an array of matches; pick the first exact match
  const matches = Array.isArray(result) ? result : (result.matches ?? result.data ?? []);
  const match = Array.isArray(matches)
    ? matches.find(
        (m: Record<string, unknown>) =>
          String(m.symbol).toUpperCase() === upper
      )
    : null;

  if (match && typeof match.id === "number") {
    TOKEN_ID_CACHE.set(upper, match.id);
    return match.id;
  }

  return null;
}

// =============================================================================
// CMC Client
// =============================================================================

export class CmcClient implements MarketDataProvider {
  readonly name = "cmc" as const;
  private apiKey: string | undefined;
  private useX402: boolean;

  /**
   * @param apiKey CMC Pro API key (optional — if not provided, try x402)
   * @param useX402 If true, use keyless x402 pay-per-request instead of API key
   */
  constructor(options: { apiKey?: string; useX402?: boolean } = {}) {
    this.apiKey = options.apiKey || process.env.CMC_API_KEY;
    this.useX402 = options.useX402 ?? !this.apiKey;
  }

  // ===========================================================================
  // MarketDataProvider Interface
  // ===========================================================================

  /**
   * Fetch top conviction wallets.
   *
   * NOTE: CMC MCP does not provide wallet-level data. This method returns
   * an empty array. Wallet-level data requires a separate integration
   * (BscScan API, or the existing ENW data pipeline ported to BSC).
   *
   * For the hackathon, the agent uses market-level signals (Fear & Greed,
   * funding rates, token prices) to inform conviction-weighted trades
   * rather than wallet-level copy trading.
   */
  async fetchTopWallets(): Promise<WalletConviction[]> {
    console.warn(
      "[CMC] Wallet-level data not available via CMC Agent Hub.",
      "Market-level signals will be used instead."
    );
    return [];
  }

  /**
   * Fetch current price for a token.
   *
   * NOTE: CMC uses symbols and CMC IDs, not on-chain addresses.
   * The `address` parameter is treated as a symbol (e.g., "BNB", "ETH").
   *
   * For address-based lookups (0x... format), maintain a token symbol
   * registry mapping BSC token addresses to their CMC symbols.
   *
   * @returns The price in USD, or 0 if the token cannot be resolved.
   */
  async fetchTokenPrice(symbol: string): Promise<number> {
    if (!symbol) return 0;
    const quote = await this.getQuote(symbol);
    return quote?.price ?? 0;
  }

  /** Fetch Fear & Greed Index (0–100, where 0 = extreme fear, 100 = extreme greed). */
  async fetchFearGreedIndex(): Promise<number> {
    const metrics = await this.getGlobalMetrics();
    return metrics?.fearGreedIndex ?? 50;
  }

  /**
   * Fetch funding rates for major tokens.
   * Returns a map of symbol → funding rate (e.g., { "BTC": 0.01, "ETH": 0.005 }).
   */
  async fetchFundingRates(): Promise<Record<string, number>> {
    const derivatives = await this.getDerivativesMetrics();
    if (!derivatives) return {};
    return {
      BTC: derivatives.btcFundingRate,
      ETH: derivatives.ethFundingRate,
    };
  }

  // ===========================================================================
  // High-Level Data Fetching
  // ===========================================================================

  /**
   * Fetch all market data the agent needs in one call.
   * Returns structured data from multiple CMC tools.
   */
  async fetchMarketData(): Promise<CmcMarketData> {
    const [globalMetrics, derivatives, tokenPrices, narratives] =
      await Promise.all([
        this.getGlobalMetrics(),
        this.getDerivativesMetrics(),
        this.getEligibleTokenQuotes(),
        this.getTrendingNarratives(),
      ]);

    const symbolPrices = tokenPrices.reduce<Record<string, TokenQuote>>(
      (acc, q) => {
        acc[q.symbol] = q;
        return acc;
      },
      {}
    );

    return {
      globalMetrics,
      derivatives,
      tokenPrices,
      tokenHolders: [],
      trendingNarratives: narratives,
    };
  }

  // ===========================================================================
  // Individual Tool Wrappers
  // ===========================================================================

  /**
   * Get global market metrics: total market cap, BTC/ETH dominance,
   * Fear & Greed Index, total volume.
   */
  async getGlobalMetrics(): Promise<GlobalMetrics | null> {
    const result = await callMcpTool("get_global_metrics_latest", {}, { apiKey: this.apiKey, useX402: this.useX402 });
    if (!result) return null;

    return {
      totalMarketCapUsd: safeNumber(result.totalMarketCap),
      btcDominance: safeNumber(result.btcDominance),
      ethDominance: safeNumber(result.ethDominance),
      fearGreedIndex: safeNumber(result.fearGreedIndex, 50),
      totalVolumeUsd: safeNumber(result.totalVolume24h),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get derivatives market metrics: open interest, funding rates, liquidations.
   */
  async getDerivativesMetrics(): Promise<DerivativesMetrics | null> {
    const result = await callMcpTool(
      "get_global_crypto_derivatives_metrics",
      {},
      { apiKey: this.apiKey, useX402: this.useX402 }
    );
    if (!result) return null;

    return {
      totalOpenInterestUsd: safeNumber(result.totalOpenInterest),
      totalVolume24hUsd: safeNumber(result.totalVolume24h),
      btcFundingRate: safeNumber(result.btcFundingRate),
      ethFundingRate: safeNumber(result.ethFundingRate),
      liquidationData: result.liquidationData
        ? {
            longLiquidations24h: safeNumber(
              (result.liquidationData as Record<string, unknown>).longLiquidations24h
            ),
            shortLiquidations24h: safeNumber(
              (result.liquidationData as Record<string, unknown>).shortLiquidations24h
            ),
          }
        : null,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get latest price quote for a specific token by symbol.
   * @param symbol Token symbol (e.g., "BTC", "ETH", "BNB"). Required.
   */
  async getQuote(symbol: string): Promise<TokenQuote | null> {
    if (!symbol) return null;

    const id = await resolveTokenId(symbol, this.apiKey);
    if (!id) return null;

    const result = await callMcpTool(
      "get_crypto_quotes_latest",
      { id },
      { apiKey: this.apiKey, useX402: this.useX402 }
    );
    if (!result) return null;

    const data = result.data ?? result;
    return parseTokenQuote(data);
  }

  /**
   * Get price quotes for all eligible tokens.
   */
  async getEligibleTokenQuotes(): Promise<TokenQuote[]> {
    const ids = await this.resolveEligibleTokenIds();
    if (ids.length === 0) return [];

    // Batch in groups of 50 (CMC limit)
    const batches: TokenQuote[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batchIds = ids.slice(i, i + 50);
      const result = await callMcpTool(
        "get_crypto_quotes_latest",
        { id: batchIds.join(",") },
        { apiKey: this.apiKey, useX402: this.useX402 }
      );
      if (result) {
        const data = Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);
        batches.push(...data.map(parseTokenQuote).filter((q): q is TokenQuote => q !== null));
      }
    }

    return batches;
  }

  /**
   * Get holder distribution metrics for a token.
   */
  async getTokenMetrics(symbol: string): Promise<TokenMetrics | null> {
    const id = await resolveTokenId(symbol, this.apiKey);
    if (!id) return null;

    const result = await callMcpTool(
      "get_crypto_metrics",
      { id },
      { apiKey: this.apiKey, useX402: this.useX402 }
    );
    if (!result) return null;

    return {
      id,
      symbol,
      holderCount: safeNumber(result.totalHolderCount),
      whaleHolderCount: safeNumber(result.whaleHolderCount),
      whalePercentOfSupply: safeNumber(result.whalePercentOfSupply),
      averageHolderBalance: safeNumber(result.averageHolderBalance),
    };
  }

  /**
   * Get trending crypto narratives.
   */
  async getTrendingNarratives(): Promise<TrendingNarrative[]> {
    const result = await callMcpTool(
      "trending_crypto_narratives",
      {},
      { apiKey: this.apiKey, useX402: this.useX402 }
    );
    if (!result) return [];

    const data = result.data ?? result.narratives ?? [];
    return Array.isArray(data) ? (data as TrendingNarrative[]) : [];
  }

  /**
   * Resolve all eligible token symbols to their CMC IDs.
   * Uses batch resolution with caching.
   */
  private async resolveEligibleTokenIds(): Promise<number[]> {
    const symbols = AGENT_CONFIG.competition.eligibleTokens;
    const ids: number[] = [];

    // Batch resolve in groups of 10 to avoid rate limits
    for (let i = 0; i < symbols.length; i += 10) {
      const batch = symbols.slice(i, i + 10);
      const results = await Promise.all(
        batch.map((sym) => resolveTokenId(sym, this.apiKey))
      );
      ids.push(...results.filter((id): id is number => id !== null));
    }

    return ids;
  }

  /**
   * Quick health check — can we reach the CMC MCP endpoint?
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.getGlobalMetrics();
      return result !== null;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function safeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function parseTokenQuote(data: unknown): TokenQuote | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!d.id) return null;

  // CMC returns quotes under a .USD key inside .quote
  let quote: Record<string, unknown> | undefined;
  if (d.quote && typeof d.quote === "object") {
    const q = d.quote as Record<string, unknown>;
    quote = (q.USD as Record<string, unknown> | undefined) ?? q;
  }

  return {
    id: Number(d.id),
    name: String(d.name || ""),
    symbol: String(d.symbol || ""),
    slug: String(d.slug || ""),
    price: safeNumber(quote?.price),
    volume24h: safeNumber(quote?.volume24h),
    marketCap: safeNumber(quote?.marketCap),
    percentChange1h: safeNumber(quote?.percentChange1h),
    percentChange24h: safeNumber(quote?.percentChange24h),
    percentChange7d: safeNumber(quote?.percentChange7d),
    lastUpdated: String(quote?.lastUpdated || ""),
  };
}

// =============================================================================
// Singleton
// =============================================================================

export const cmcClient = new CmcClient();
