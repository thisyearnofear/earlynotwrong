/**
 * Casper MCP Client — consumes the Casper ecosystem MCP servers.
 *
 * The agent doesn't just EXPOSE an MCP server — it CONSUMES the Casper
 * ecosystem's MCP servers as part of its trading cycle. This demonstrates
 * active participation in the Casper agent economy, not just using Casper
 * as a notary.
 *
 * Two data sources:
 *
 * 1. CSPR.trade MCP (https://mcp.cspr.trade/mcp) — Casper's native DEX.
 *    Provides token prices, pair liquidity, swap quotes, and trade analysis.
 *    Uses the MCP Streamable HTTP transport with session management:
 *    initialize → notifications/initialized → tools/call.
 *    The agent uses this to:
 *    - Fetch Casper DEX token prices for cross-chain comparison
 *    - Check CSPR/USDC pair liquidity as a Casper ecosystem health signal
 *
 * 2. Casper Blockchain RPC (https://node.testnet.cspr.cloud/rpc) — network
 *    status via direct JSON-RPC. The cspr-ai.xyz MCP server was unavailable
 *    at build time, so we fall back to the same RPC endpoint the agent uses
 *    for anchoring. Returns era, validator count, total stake, block height.
 *
 * All calls degrade gracefully — if either source is unreachable, the cycle
 * continues with empty Casper context.
 */

import { AGENT_CONFIG } from "./config.js";

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

/** Casper network status from the blockchain RPC. */
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
  /** Whether the Casper blockchain RPC was reachable. */
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
// MCP Protocol Client — Session-aware (CSPR.trade)
// =============================================================================

const CSPR_TRADE_MCP_URL = process.env.CSPR_TRADE_MCP_URL || "https://mcp.cspr.trade/mcp";

/** Request timeout for MCP calls — generous since these are remote servers. */
const MCP_TIMEOUT_MS = 15000;

/**
 * MCP session — initialized once, reused for all tool calls within a cycle.
 * The CSPR.trade MCP server uses stateful Streamable HTTP transport: it
 * requires an initialize handshake and returns a session ID that must be
 * included in all subsequent requests.
 */
interface McpSession {
  sessionId: string;
  serverUrl: string;
}

/**
 * Initialize an MCP session with the server.
 * Sends the initialize handshake and the notifications/initialized notification.
 * Returns the session ID to use for subsequent tool calls.
 */
async function initMcpSession(serverUrl: string): Promise<McpSession> {
  // Step 1: Send initialize request
  const initResponse = await fetch(serverUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "early-not-wrong-agent", version: "0.1.0" },
      },
    }),
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
  });

  if (!initResponse.ok) {
    throw new Error(`MCP initialize failed: ${initResponse.status}`);
  }

  // Extract session ID from response headers
  const sessionId = initResponse.headers.get("mcp-session-id");
  if (!sessionId) {
    throw new Error("MCP server did not return a session ID");
  }

  // Consume the init response body (SSE or JSON)
  await initResponse.text();

  // Step 2: Send notifications/initialized (required by MCP protocol)
  await fetch(serverUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
  });

  return { sessionId, serverUrl };
}

/**
 * Call a tool on an MCP server using an established session.
 * The session ID is sent in the Mcp-Session-Id header.
 */
async function callMcpToolWithSession(
  session: McpSession,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const response = await fetch(session.serverUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Mcp-Session-Id": session.sessionId,
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
 * Fetch the list of tradable tokens from CSPR.trade via MCP.
 * Initializes a session, calls get_tokens, and returns parsed tokens.
 * CSPR.trade returns tokens with: id, symbol, name, decimals, packageHash, fiatPrice.
 */
export async function fetchCasperDexTokens(): Promise<CasperDexToken[]> {
  try {
    const session = await initMcpSession(CSPR_TRADE_MCP_URL);
    const result = await callMcpToolWithSession(session, "get_tokens", {});

    // CSPR.trade wraps the token list in { data: [...] }
    const tokens = Array.isArray(result) ? result : (result as any)?.data;
    if (!Array.isArray(tokens)) return [];

    return tokens.map((t: any) => ({
      symbol: t.symbol ?? "",
      address: t.packageHash ?? t.id ?? "",
      decimals: t.decimals ?? 9,
      priceUsd: typeof t.fiatPrice === "number" ? t.fiatPrice : undefined,
      priceCspr: typeof t.priceCspr === "number" ? t.priceCspr : undefined,
    })).filter((t: CasperDexToken) => t.symbol && t.address);
  } catch {
    return [];
  }
}

/**
 * Fetch trading pairs from CSPR.trade via MCP.
 * Used to gauge Casper DEX ecosystem health.
 * CSPR.trade wraps the pair list in { data: [...] }.
 */
export async function fetchCasperDexPairs(limit = 10): Promise<CasperDexPair[]> {
  try {
    const session = await initMcpSession(CSPR_TRADE_MCP_URL);
    const result = await callMcpToolWithSession(session, "get_pairs", {});

    // CSPR.trade wraps the pair list in { data: [...] }
    const pairs = Array.isArray(result) ? result : (result as any)?.data;
    if (!Array.isArray(pairs)) return [];

    return pairs.map((p: any) => ({
      pairAddress: p.contractPackageHash ?? "",
      token0: {
        symbol: p.token0?.symbol ?? "",
        address: p.token0?.packageHash ?? "",
      },
      token1: {
        symbol: p.token1?.symbol ?? "",
        address: p.token1?.packageHash ?? "",
      },
      reserve0: p.reserve0 ?? "0",
      reserve1: p.reserve1 ?? "0",
      reserveUsd: typeof p.reserveUsd === "number" ? p.reserveUsd : undefined,
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

    // Look for any pair containing CSPR or WCSPR
    const csprPair = pairs.find(
      (p) =>
        (p.token0.symbol.toUpperCase().includes("CSPR") && p.token1.symbol.toUpperCase().includes("USDC")) ||
        (p.token1.symbol.toUpperCase().includes("CSPR") && p.token0.symbol.toUpperCase().includes("USDC")),
    );

    if (csprPair) {
      const isCsprToken0 = csprPair.token0.symbol.toUpperCase().includes("CSPR");
      const csprReserve = isCsprToken0 ? csprPair.reserve0 : csprPair.reserve1;
      const usdcReserve = isCsprToken0 ? csprPair.reserve1 : csprPair.reserve0;
      const csprAmount = parseFloat(csprReserve) / 1e9; // CSPR has 9 decimals
      const usdcAmount = parseFloat(usdcReserve) / 1e6; // USDC has 6 decimals
      if (csprAmount > 0 && usdcAmount > 0) {
        return {
          priceUsd: usdcAmount / csprAmount,
          liquidityUsd: csprPair.reserveUsd ?? usdcAmount * 2,
        };
      }
    }

    // Fallback: try get_tokens for CSPR price
    const tokens = await fetchCasperDexTokens();
    const cspr = tokens.find((t) => t.symbol.toUpperCase() === "CSPR");
    if (cspr?.priceUsd) {
      return { priceUsd: cspr.priceUsd, liquidityUsd: 0 };
    }

    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Casper Blockchain RPC — Network Status (direct JSON-RPC fallback)
// =============================================================================

// RPC fallback chain — same as the anchoring adapter. Tries the public node
// (no auth, no quota) first, then cspr.cloud (with token, rate-limited).
const CASPER_RPC_URLS: readonly string[] =
  process.env.CASPER_RPC_URL
    ? [process.env.CASPER_RPC_URL]
    : AGENT_CONFIG.casper.testnet.rpcUrls ?? [AGENT_CONFIG.casper.testnet.rpcUrl];

/**
 * Call a Casper JSON-RPC method with fallback chain.
 * Tries each endpoint in order; cspr.cloud gets the CSPR_CLOUD_TOKEN auth
 * header, the public node doesn't need one. Skips 429s to the next endpoint.
 */
async function casperRpc(method: string, params: unknown = null): Promise<any> {
  const token = process.env.CSPR_CLOUD_TOKEN || "";
  let lastErr: Error | null = null;
  for (const url of CASPER_RPC_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(url.includes("cspr.cloud") && token ? { Authorization: token } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
      });

      if (response.status === 429) {
        lastErr = new Error(`429 from ${url}`);
        continue;
      }
      if (!response.ok) {
        lastErr = new Error(`Casper RPC ${response.status} from ${url}`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await response.json();
      if (json.error) {
        throw new Error(`Casper RPC error: ${json.error.message}`);
      }
      return json.result;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      continue;
    }
  }
  throw lastErr ?? new Error("all Casper RPC endpoints failed");
}

/**
 * Fetch Casper network status via direct JSON-RPC.
 * Gets the latest block for era/height, and era info for validator count/stake.
 *
 * This is a fallback for the cspr-ai.xyz MCP server which was unavailable
 * at build time. It uses the same RPC endpoint and auth token the agent
 * already uses for anchoring.
 */
export async function fetchCasperNetworkStatus(): Promise<CasperNetworkStatus | null> {
  try {
    // Get latest block for era_id and height
    const blockResult = await casperRpc("chain_get_block", null);
    const block = blockResult?.block?.Version2 ?? blockResult?.block ?? blockResult?.block_with_signatures?.block?.Version2;
    const header = block?.header;
    if (!header) return null;

    const eraId = header.era_id ?? 0;
    const blockHeight = header.height ?? 0;

    // Get era info for validator count and total stake
    let activeValidators = 0;
    let totalStakeMotes = 0;

    try {
      const eraResult = await casperRpc("chain_get_era_info_by_switch_block", null);
      const eraInfo = eraResult?.era_summary?.stored_value?.EraInfo;
      const allocs = eraInfo?.seigniorage_allocations ?? [];
      const validatorAllocs = allocs.filter((a: any) => "Validator" in a);
      activeValidators = validatorAllocs.length;
      totalStakeMotes = validatorAllocs.reduce(
        (sum: number, a: any) => sum + parseInt(a.Validator?.amount ?? "0", 10),
        0,
      );
    } catch {
      // Era info is best-effort — block data alone is still useful
    }

    return {
      eraId,
      activeValidators,
      totalStakeCspr: Math.round(totalStakeMotes / 1e9), // motes → CSPR
      circulatingSupplyCspr: 0, // Not available via RPC without a separate query
      blockHeight,
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
 * Calls CSPR.trade MCP (DEX data) and Casper RPC (network status) in
 * parallel and aggregates the results into a single CasperEcosystemContext.
 * Degrades gracefully — if either source is unreachable, the corresponding
 * fields are null/empty and the reachable flag is set to false.
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
  if (ctx.csprUsdcLiquidityUsd !== null && ctx.csprUsdcLiquidityUsd > 0) {
    lines.push(`CSPR/USDC liquidity: $${(ctx.csprUsdcLiquidityUsd / 1000).toFixed(1)}K`);
  }
  if (ctx.networkStatus) {
    const ns = ctx.networkStatus;
    lines.push(`Casper network: era ${ns.eraId}, ${ns.activeValidators} validators, ${ns.totalStakeCspr.toLocaleString()} CSPR staked, block ${ns.blockHeight}`);
  }
  if (ctx.topDexTokens.length > 0) {
    const tokenList = ctx.topDexTokens
      .slice(0, 5)
      .map((t) => `${t.symbol}${t.priceUsd ? ` ($${t.priceUsd.toFixed(4)})` : ""}`)
      .join(", ");
    lines.push(`Casper DEX tokens: ${tokenList}`);
  }

  if (lines.length === 0) {
    return "Casper ecosystem data sources unreachable — no cross-chain context available.";
  }

  return `Cross-chain context (Casper ecosystem): ${lines.join(" · ")}`;
}
