/**
 * Agent HTTP Client
 *
 * Connects to the TWAK agent's local HTTP server to fetch
 * live status, trades, and conviction data for the dashboard.
 */

const AGENT_HOST = process.env.NEXT_PUBLIC_AGENT_HOST || "http://localhost";
const AGENT_PORT = parseInt(process.env.NEXT_PUBLIC_AGENT_PORT || "3000");

export interface AgentStatus {
  agent: string;
  version: string;
  hackathon: string;
  status: string;
  cycle: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  totalTrades: number;
  totalVolumeUsd: number;
  errors: number;
  portfolio: {
    totalValueUsd: number;
    positions: number;
    chains: string[];
  };
  guardrails: {
    drawdownPercent: number;
    peakValueUsd: number;
    tradesToday: number;
    dailyLimit: number;
    drawdownExceeded: boolean;
    allOk: boolean;
  };
}

export interface AgentTrade {
  timestamp: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  success: boolean;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface AgentTrades {
  totalSessionTrades: number;
  totalVolumeUsd: number;
  recentTrades: AgentTrade[];
}

export interface AgentConviction {
  marketData: {
    fearGreedIndex: number | null;
    fearGreedLabel: string;
    totalMarketCapUsd: number | null;
    btcFundingRate: number | null;
    ethFundingRate: number | null;
    tokensTracked: number;
    trending: Array<{ name: string }>;
  } | null;
  portfolio: {
    totalValueUsd: number;
    drawdownPercent: number;
    positions: Array<{ symbol: string; valueUsd: number }>;
  };
  anchoredHash: string | null;
  anchoredUrl: string | null;
  anchoring: {
    hash: string;
    mode: string;
    blockNumber?: number;
    gasUsed?: string;
  } | null;
}

/**
 * Try to fetch from the agent server, falling back to alternative ports.
 */
async function tryFetch(path: string): Promise<Response | null> {
  // Match the agent's actual fallback ports from agent/src/server.ts
  const ports = [AGENT_PORT, 3100, 3001];
  let lastError: unknown;

  for (const port of ports) {
    try {
      const url = `${AGENT_HOST}:${port}${path}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return response;
    } catch (err) {
      lastError = err;
    }
  }

  // If none worked, throw the last error
  if (lastError instanceof Error) throw lastError;
  return null;
}

/**
 * Fetch the agent's current status.
 */
export async function fetchAgentStatus(): Promise<AgentStatus | null> {
  try {
    const response = await tryFetch("/status");
    if (!response) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Fetch the agent's trade history.
 */
export async function fetchAgentTrades(limit: number = 20): Promise<AgentTrades | null> {
  try {
    const response = await tryFetch(`/trades?limit=${limit}`);
    if (!response) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Fetch the agent's conviction and market data.
 */
export async function fetchAgentConviction(): Promise<AgentConviction | null> {
  try {
    const response = await tryFetch("/conviction");
    if (!response) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// ─── Edge report ────────────────────────────────────────────────────────────
//
// The edge report answers the buyer question: "does the conviction signal
// have demonstrable edge, or would any disciplined exit policy do as well?"
// It runs the conviction strategy alongside a naive random-entry baseline
// on the same price paths and reports head-to-head deltas + factor attribution.

export interface EdgeReportFactorAttribution {
  factor: "contrarian" | "rsi" | "quality" | "regime" | "holders" | "news" | "llmJury";
  winningExits: number;
  realizedPnlUsd: number;
  meanEntryScore: number;
}

export interface EdgeReport {
  conviction: {
    variant: string;
    totalReturnPercent: number;
    maxDrawdownPercent: number;
    winRate: number;
    profitFactor: number;
    trades: number;
    sharpeRatio: number;
  };
  naive: {
    variant: string;
    totalReturnPercent: number;
    maxDrawdownPercent: number;
    winRate: number;
    profitFactor: number;
    trades: number;
    sharpeRatio: number;
  };
  edge: {
    totalReturnPercent: number;
    sharpeRatio: number;
    maxDrawdownPercent: number;
    winRate: number;
    profitFactor: number;
  };
  hasEdge: boolean;
  verdict: string;
  factorAttribution: EdgeReportFactorAttribution[];
  dataSource: "live" | "synthetic";
}

/**
 * Fetch the on-demand edge report (conviction vs naive baseline).
 * This runs a backtest on each call, so it can take a few seconds.
 */
export async function fetchEdgeReport(): Promise<EdgeReport | null> {
  try {
    const response = await tryFetch("/edge-report");
    if (!response) return null;
    return await response.json();
  } catch {
    return null;
  }
}
