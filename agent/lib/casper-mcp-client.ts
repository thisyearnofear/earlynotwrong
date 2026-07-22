/**
 * Casper MCP Client — consumes the Casper ecosystem MCP servers.
 *
 * The agent doesn't just EXPOSE an MCP server — it CONSUMES the Casper
 * ecosystem's MCP servers as part of its trading cycle. This demonstrates
 * active participation in the Casper agent economy, not just using Casper
 * as a notary.
 *
 * Two MCP servers are consumed:
 *
 * 1. CSPR.trade MCP (https://mcp.cspr.trade/mcp) — Casper's native DEX.
 *    Provides token prices, pair liquidity, swap quotes, and trade analysis.
 *    The agent uses this to:
 *    - Fetch Casper DEX token prices for cross-chain comparison
 *    - Check CSPR/USDC pair liquidity as a Casper ecosystem health signal
 *    - Get OHLCV price history for Casper-native tokens
 *
 * 2. Casper Blockchain MCP (https://mcp.cspr-ai.xyz/mcp) — network status.
 *    Provides era info, validator count, total stake, supply data.
 *    The agent uses this to:
 *    - Monitor Casper network health (era progress, validator participation)
 *    - Track CSPR circulating supply as a macro signal
 *
 * All calls use standard MCP JSON-RPC protocol over HTTP. The module
 * degrades gracefully — if either MCP server is unreachable, the cycle
 * continues with empty Casper context.
 */

// =============================================================================
// Types
// =============================================================================

/** A token listed on CSPR.trade DEX. */
export interface CasperDexToken {
  symbol: string;
  address: string;
  decimals: number;
  priceUsd?: number;
  priceCspr?: number;
}

/** A trading pair on CSPR.trade DEX. */
export interface CasperDexPair {
  pairAddress: string;
  token0: { symbol: string; address: string };
  token1: { symbol: string; address: string };
  reserve0: string;
  reserve1: string;
  reserveUsd?: number;
}

/** A swap quote from CSPR.trade. */
export interface CasperDexQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  route: string[];
}

/** Casper network status from the blockchain MCP. */
export interface CasperNetworkStatus {
  eraId: number;
  activeValidators: number;
  totalStakeCspr: number;
  circulatingSupplyCspr: number;
  blockHeight: number;
}

/** Aggregated Casper ecosystem context for the cycle. */
export interface CasperEcosystemContext {
  /** Whether the CSPR.trade MCP was reachable this cycle. */
  dexMcpReachable: boolean;
  /** Whether the Casper blockchain MCP was reachable. */
  chainMcpReachable: boolean;
  /** CSPR token price in USD (from DEX). */
  csprPriceUsd: number | null;
  /** CSPR/USDC pair liquidity in USD. */
  csprUsdcLiquidityUsd: number | null;
  /** Top Casper DEX tokens by liquidity. */
  topDexTokens: CasperDexToken[];
  /** Casper network status. */
  networkStatus: CasperNetworkStatus | null;
  /** ISO timestamp of fetch. */
  fetchedAt: string;
}

// =============================================================================
// MCP Protocol Client
// =============================================================================

const CSPR_TRADE_MCP_URL = process.env.CSPR_TRADE_MCP_URL || "https://mcp.cspr.trade/mcp";
const CASPER_CHAIN_MCP_URL = process.env.CASPER_CHAIN_MCP_URL || "https://mcp.cspr-ai.xyz/mcp";

/** Request timeout for MCP calls — generous since these are remote servers. */
const MCP_TIMEOUT_MS = 15000;

/**
 * Call a tool on an MCP server via JSON-RPC over HTTP.
 *
 * Uses the Streamable HTTP transport: a single POST with the JSON-RPC
 * request, accepting application/json or text/event-stream.
 */
async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const response = await fetch(serverUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    }),
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`MCP server returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";

  // MCP servers may respond with JSON or SSE. For JSON, parse directly.
  // For SSE, extract the data line.
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const dataLine = text
      .split("\n")
      .find((l) => l.startsWith("data:"));
    if (!dataLine) throw new Error("MCP SSE response had no data line");
    const json = JSON.parse(dataLine.slice(5).trim());
    return extractMcpResult(json);
  }

  const json = await response.json();
  return extractMcpResult(json);
}

/**
 * Extract the tool result from an MCP JSON-RPC response.
 * MCP wraps results in { result: { content: [{ type: "text", text: "..." }] } }.
 */
function extractMcpResult(json: any): unknown {
  // Standard MCP response: { result: { content: [{ type: "text", text: "..." }] } }
  const content = json?.result?.content;
  if (Array.isArray(content) && content.length > 0) {
    const textContent = content.find((c: any) => c.type === "text");
    if (textContent?.text) {
      try {
        return JSON.parse(textContent.text);
      } catch {
        return textContent.text;
      }
    }
  }
  // Some MCP servers return the result directly
  if (json?.result) return json.result;
  return json;
}

// =============================================================================
// CSPR.trade MCP — DEX Market Data
// =============================================================================

/**
 * Fetch the list of tradable tokens from CSPR.trade.
 * Returns tokens with their addresses, decimals, and optional USD prices.
 */
export async function fetchCasperDexTokens(): Promise<CasperDexToken[]> {
  try {
    const result = await callMcpTool(CSPR_TRADE_MCP_URL, "get_tokens", {
      include_pricing: true,
    });

    if (!Array.isArray(result)) return [];

    return result.map((t: any) => ({
      symbol: t.symbol ?? t.ticker ?? "",
      address: t.address ?? t.contract_hash ?? "",
      decimals: t.decimals ?? 9,
      priceUsd: typeof t.price_usd === "number" ? t.price_usd : undefined,
      priceCspr: typeof t.price_cspr === "number" ? t.price_cspr : undefined,
    })).filter((t: CasperDexToken) => t.symbol && t.address);
  } catch {
    return [];
  }
}

/**
 * Fetch trading pairs from CSPR.trade, sorted by liquidity.
 * Used to gauge Casper DEX ecosystem health.
 */
export async function fetchCasperDexPairs(limit = 10): Promise<CasperDexPair[]> {
  try {
    const result = await callMcpTool(CSPR_TRADE_MCP_URL, "get_pairs", {
      sort: "liquidity",
      limit,
    });

    if (!Array.isArray(result)) return [];

    return result.map((p: any) => ({
      pairAddress: p.pair_address ?? p.address ?? "",
      token0: {
        symbol: p.token0?.symbol ?? p.token0_symbol ?? "",
        address: p.token0?.address ?? p.token0_address ?? "",
      },
      token1: {
        symbol: p.token1?.symbol ?? p.token1_symbol ?? "",
        address: p.token1?.address ?? p.token1_address ?? "",
      },
      reserve0: p.reserve0 ?? "0",
      reserve1: p.reserve1 ?? "0",
      reserveUsd: typeof p.reserve_usd === "number" ? p.reserve_usd : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Get a swap quote from CSPR.trade for CSPR → USDC.
 * This gives us the CSPR price and pair liquidity in one call.
 */
export async function fetchCsprUsdcQuote(): Promise<{ priceUsd: number; liquidityUsd: number } | null> {
  try {
    // First get pairs to find the CSPR/USDC pair
    const pairs = await fetchCasperDexPairs(20);
    const csprUsdc = pairs.find(
      (p) =>
        (p.token0.symbol.toUpperCase() === "CSPR" && p.token1.symbol.toUpperCase() === "USDC") ||
        (p.token1.symbol.toUpperCase() === "CSPR" && p.token0.symbol.toUpperCase() === "USDC"),
    );

    if (csprUsdc?.reserveUsd) {
      // Derive CSPR price from pair reserves
      const isCsprToken0 = csprUsdc.token0.symbol.toUpperCase() === "CSPR";
      const csprReserve = isCsprToken0 ? csprUsdc.reserve0 : csprUsdc.reserve1;
      const usdcReserve = isCsprToken0 ? csprUsdc.reserve1 : csprUsdc.reserve0;
      const csprAmount = parseFloat(csprReserve) / 1e9; // CSPR has 9 decimals
      const usdcAmount = parseFloat(usdcReserve) / 1e6; // USDC has 6 decimals
      if (csprAmount > 0) {
        return {
          priceUsd: usdcAmount / csprAmount,
          liquidityUsd: csprUsdc.reserveUsd,
        };
      }
    }

    // Fallback: try get_tokens for CSPR price
    const tokens = await fetchCasperDexTokens();
    const cspr = tokens.find((t) => t.symbol.toUpperCase() === "CSPR");
    if (cspr?.priceUsd) {
      return { priceUsd: cspr.priceUsd, liquidityUsd: csprUsdc?.reserveUsd ?? 0 };
    }

    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Casper Blockchain MCP — Network Status
// =============================================================================

/**
 * Fetch Casper network status from the blockchain MCP.
 * Returns era, validator count, total stake, and supply data.
 */
export async function fetchCasperNetworkStatus(): Promise<CasperNetworkStatus | null> {
  try {
    const result = await callMcpTool(CASPER_CHAIN_MCP_URL, "casper_get_network_status", {});

    if (!result || typeof result !== "object") return null;
    const r = result as any;

    return {
      eraId: r.era_id ?? r.eraId ?? 0,
      activeValidators: r.active_validators ?? r.activeValidators ?? 0,
      totalStakeCspr: r.total_stake ?? r.totalStake ?? 0,
      circulatingSupplyCspr: r.circulating_supply ?? r.circulatingSupply ?? 0,
      blockHeight: r.block_height ?? r.blockHeight ?? 0,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Aggregated Ecosystem Context
// =============================================================================

/**
 * Fetch the full Casper ecosystem context for the current cycle.
 *
 * Calls both MCP servers in parallel and aggregates the results into a
 * single CasperEcosystemContext. Degrades gracefully — if either server
 * is unreachable, the corresponding fields are null/empty and the
 * reachable flag is set to false.
 *
 * This context is:
 * 1. Stored in agent state for the dashboard
 * 2. Fed to the LLM jury as additional market context
 * 3. Included in the cycle summary logs
 */
export async function fetchCasperEcosystemContext(): Promise<CasperEcosystemContext> {
  const [dexTokens, csprQuote, networkStatus] = await Promise.all([
    fetchCasperDexTokens(),
    fetchCsprUsdcQuote(),
    fetchCasperNetworkStatus(),
  ]);

  const dexReachable = dexTokens.length > 0 || csprQuote !== null;
  const chainReachable = networkStatus !== null;

  // Top tokens by liquidity (CSPR first, then sorted by price presence)
  const topDexTokens = [...dexTokens]
    .sort((a, b) => (b.priceUsd ?? 0) - (a.priceUsd ?? 0))
    .slice(0, 10);

  return {
    dexMcpReachable: dexReachable,
    chainMcpReachable: chainReachable,
    csprPriceUsd: csprQuote?.priceUsd ?? null,
    csprUsdcLiquidityUsd: csprQuote?.liquidityUsd ?? null,
    topDexTokens,
    networkStatus,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Build a compact summary of the Casper ecosystem context for the LLM jury
 * prompt. This gives the jury cross-chain market context — it can see
 * what's happening on Casper's DEX alongside the BSC signals.
 */
export function summarizeCasperContextForJury(ctx: CasperEcosystemContext): string {
  const lines: string[] = [];

  if (ctx.csprPriceUsd !== null) {
    lines.push(`CSPR price: $${ctx.csprPriceUsd.toFixed(4)}`);
  }
  if (ctx.csprUsdcLiquidityUsd !== null) {
    lines.push(`CSPR/USDC liquidity: $${(ctx.csprUsdcLiquidityUsd / 1000).toFixed(1)}K`);
  }
  if (ctx.networkStatus) {
    const ns = ctx.networkStatus;
    lines.push(`Casper network: era ${ns.eraId}, ${ns.activeValidators} validators, ${ns.totalStakeCspr.toLocaleString()} CSPR staked`);
  }
  if (ctx.topDexTokens.length > 0) {
    const tokenList = ctx.topDexTokens
      .slice(0, 5)
      .map((t) => `${t.symbol}${t.priceUsd ? ` ($${t.priceUsd.toFixed(4)})` : ""}`)
      .join(", ");
    lines.push(`Casper DEX tokens: ${tokenList}`);
  }

  if (lines.length === 0) {
    return "Casper ecosystem MCP servers unreachable — no cross-chain context available.";
  }

  return `Cross-chain context (Casper ecosystem via MCP): ${lines.join(" · ")}`;
}
