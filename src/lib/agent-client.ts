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
async function tryFetch(path: string, timeoutMs: number = 3000): Promise<Response | null> {
  // Match the agent's actual fallback ports from agent/src/server.ts
  const ports = [AGENT_PORT, 3100, 3001];
  let lastError: unknown;

  for (const port of ports) {
    try {
      const url = `${AGENT_HOST}:${port}${path}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
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
  /** "live" = fresh SoSoValue klines; "live-stale" = real klines served from
   *  the disk cache past their TTL (API rate-limited); "synthetic" = the
   *  deterministic generator (mechanics only, not real edge). */
  dataSource: "live" | "live-stale" | "synthetic";
  staleSymbols: string[];
  /** Per-regime edge breakdown. The signal is designed for fear regimes;
   *  this segments the backtest so the verdict can say "edge in fear, not in
   *  greed" rather than a flat "no edge". */
  regimeBreakdown: Array<{
    regime: "fear" | "non-fear";
    days: number;
    conviction: { sharpeRatio: number; totalReturnPercent: number };
    naive: { sharpeRatio: number; totalReturnPercent: number };
    sharpeEdge: number;
    returnEdge: number;
    hasEdge: boolean;
  }>;
}

/**
 * Fetch the on-demand edge report (conviction vs naive baseline).
 * The agent caches the result for 30 min, so most calls are instant — but
 * the first cold call (or ?fresh=1) paces 20 symbols through the rolling-
 * window rate limiter (~7 min). 8 min timeout covers the cold fill.
 */
export async function fetchEdgeReport(): Promise<EdgeReport | null> {
  try {
    const response = await tryFetch("/edge-report", 8 * 60 * 1000);
    if (!response) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// ─── Delphi prediction-market status ────────────────────────────────────────
//
// The Delphi runner is a separate pm2 process; the agent's /delphi/status
// route reads its persisted state (snapshot, positions, calibration ledger)
// off disk. hasData=false is the honest empty state before the runner's
// first cycle — the card renders that as "not started yet".

export interface DelphiOpenPosition {
  id: string;
  marketAddress: string;
  outcomeIdx: number;
  question: string;
  forecast: number;
  impliedProbability: number;
  edge: number;
  shares: string;
  tokensIn: string;
  openedAt: number;
  transactionHash?: string;
  /** Provenance — how the forecast was produced (Phase 4c+). Optional for
   *  positions persisted before the alpha stack shipped. */
  model?: string;
  samples?: number;
  webEvidence?: boolean;
  /** Which search rung supplied the briefing (firecrawl/parallel/exa). */
  webSource?: string;
  /** A second search rung deterministically corroborated the briefing. */
  corroborated?: boolean;
  /** The resolution-authority verifier that answered this market. */
  factAuthority?: string;
  /** The adversarial verifier reviewed this entry pre-trade. */
  verified?: boolean;
  /** Which model ran the adversarial verification. */
  verifierModel?: string;
  volAnchor?: number;
}

export interface DelphiAnchorResult {
  adapter: string;
  status: "success" | "skipped" | "failed";
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface DelphiCalibrationBucket {
  bucket: number;
  lower: number;
  upper: number;
  count: number;
  meanForecast: number | null;
  meanOutcome: number | null;
  gap: number | null;
}

export interface DelphiStatus {
  hasData: boolean;
  enabled: boolean;
  network: string;
  competition: {
    windowOpens: string;
    windowCloses: string;
    msRemaining: number;
  };
  snapshot: {
    lastCycleAt: number | null;
    cyclesRun: number;
    tradesPlaced: number;
    marketsSeen: number;
    /** Cumulative alpha-stack activity (web briefings, vol baselines, exits). */
    exitsConvergence: number;
    exitsStopped: number;
    briefingsFetched: number;
    volBaselines: number;
    estimatesCached: number;
    factChecks: number;
    verificationsRun: number;
    verificationBlocks: number;
    lastAnchoredThesisHash: string | null;
  } | null;
  lastAnchor: {
    thesisHash: string;
    anchoredAt: number;
    convictionScore: number;
    results: DelphiAnchorResult[];
  } | null;
  openPositions: DelphiOpenPosition[];
  totalExposureTokens: string;
  calibration: {
    resolved: number;
    unresolved: number;
    brierScore: number | null;
    logLoss: number | null;
    hitRate: number | null;
    buckets: DelphiCalibrationBucket[];
    totalForecasts: number;
  };
  /** Calibration over EVERY estimate (traded or not) — the unbiased
   *  forecaster record, scored at settlement from forecasts-all.jsonl. */
  allForecasts: {
    resolved: number;
    unresolved: number;
    brierScore: number | null;
    logLoss: number | null;
    hitRate: number | null;
    buckets: DelphiCalibrationBucket[];
    totalForecasts: number;
    totalEstimates: number;
    scoredMarkets: number;
    droppedMarkets: number;
  };
}

/**
 * Fetch the Delphi runner status via the Vercel proxy (same path as the
 * other dashboard cards). Returns null when the agent is unreachable.
 */
export async function fetchDelphiStatus(): Promise<DelphiStatus | null> {
  try {
    const response = await fetch("/api/agent/proxy?endpoint=delphi/status", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
