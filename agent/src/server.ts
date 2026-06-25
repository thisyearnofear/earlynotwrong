/**
 * Agent HTTP Server
 *
 * Serves the three routes declared in manifest.json on port 3000.
 * Pinata's gateway strips the path prefix before forwarding, so this
 * server just serves /status, /trades, and /conviction at the root.
 *
 * Routes:
 *   GET /status      — Agent status, latest cycle summary, guardrail state
 *   GET /trades      — Trade history from the current session
 *   GET /conviction  — Current conviction scores and market regime
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AGENT_CONFIG } from "../lib/config.js";
import { twakExecutor } from "../lib/twak-executor.js";
import { guardrails } from "../lib/risk-guardrails.js";
import { getMantleExplorerTxUrl } from "../lib/mantle.js";
import type { SwapResult, TwakPortfolio } from "../lib/twak-executor.js";
import type { CmcMarketData } from "../lib/cmc-client.js";
import type {
  ConvictionSignal,
  HeldPosition,
  MarketRegime,
  PositionVerdict,
} from "../lib/conviction-signal.js";

// =============================================================================
// Shared agent state — populated by index.ts before starting the server
// =============================================================================

export interface AgentServerState {
  cycle: number;
  status: string;
  lastRunAt: number | null;
  nextRunAt: number | null;
  totalTrades: number;
  totalVolumeUsd: number;
  errors: string[];
  marketData: CmcMarketData | null;
  executedTrades: SwapResult[];
  lastAnchoredHash: string | null;
  anchoring: {
    hash: string;
    mode: "on-chain" | "reverted" | "off-chain" | "simulator";
    blockNumber?: number;
    gasUsed?: string;
  } | null;
  // Conviction-native fields — the soul of the agent, surfaced on the dashboard.
  marketRegime: MarketRegime | null;
  convictionSignals: ConvictionSignal[];
  heldPositions: HeldPosition[];
  positionVerdicts: PositionVerdict[];
  /**
   * The loop's last portfolio snapshot, already augmented with the on-chain
   * value of held BEP-20s. Endpoints prefer this over re-fetching the raw
   * TWAK portfolio (which only sees native BNB + USDC and would understate
   * value, faking a drawdown against the augmented peak).
   */
  portfolio: TwakPortfolio | null;
}

let agentState: AgentServerState = {
  cycle: 0,
  status: "starting",
  lastRunAt: null,
  nextRunAt: null,
  totalTrades: 0,
  totalVolumeUsd: 0,
  errors: [],
  marketData: null,
  executedTrades: [],
  lastAnchoredHash: null,
  anchoring: null,
  marketRegime: null,
  convictionSignals: [],
  heldPositions: [],
  positionVerdicts: [],
  portfolio: null,
};

/**
 * Resolve the portfolio to report: prefer the loop's augmented snapshot, and
 * only fall back to a raw TWAK fetch before the first cycle has populated it.
 */
async function resolvePortfolio(): Promise<TwakPortfolio> {
  return agentState.portfolio ?? (await twakExecutor.getPortfolio());
}

/**
 * Update the shared state (called from index.ts after each cycle).
 */
export function setAgentState(state: Partial<AgentServerState>): void {
  agentState = { ...agentState, ...state };
}

// =============================================================================
// App
// =============================================================================

const app = new Hono();

// CORS for dashboard access
app.use("*", cors());

// ===========================================================================
// GET /status
// ===========================================================================

app.get("/status", async (c) => {
  const portfolio = await resolvePortfolio();
  const guardrailStatus = guardrails.getStatus(portfolio.totalValueUsd);

  const body = {
    agent: "Early, Not Wrong",
    version: "0.1.0",
    hackathon: "BNB Hack: AI Trading Agent Edition",
    status: agentState.status,
    cycle: agentState.cycle,
    lastRunAt: agentState.lastRunAt,
    nextRunAt: agentState.nextRunAt,
    totalTrades: agentState.totalTrades,
    totalVolumeUsd: agentState.totalVolumeUsd,
    errors: agentState.errors.length,
    portfolio: {
      totalValueUsd: portfolio.totalValueUsd,
      positions: portfolio.positions.length,
      chains: portfolio.chains,
    },
    guardrails: {
      drawdownPercent: Math.round(guardrailStatus.drawdownPercent * 10) / 10,
      peakValueUsd: guardrailStatus.peakValueUsd,
      tradesToday: guardrailStatus.tradesToday,
      dailyLimit: AGENT_CONFIG.trading.maxDailyTrades,
      drawdownExceeded: guardrailStatus.drawdownExceeded,
      allOk: guardrailStatus.allOk,
    },
  };

  return c.json(body);
});

// ===========================================================================
// GET /trades
// ===========================================================================

app.get("/trades", async (c) => {
  const limit = Math.min(
    Number(c.req.query("limit") || "20"),
    100
  );

  // Recent trades from current session + TWAK history
  const recentTrades = agentState.executedTrades.slice(-limit);

  const body = {
    totalSessionTrades: agentState.totalTrades,
    totalVolumeUsd: agentState.totalVolumeUsd,
    recentTrades: recentTrades.map((t) => ({
      timestamp: t.timestamp,
      tokenIn: t.tokenIn,
      tokenOut: t.tokenOut,
      amountIn: t.amountIn,
      amountOut: t.amountOut,
      success: t.success,
      txHash: t.txHash,
      explorerUrl: t.explorerUrl,
      error: t.error,
    })),
  };

  return c.json(body);
});

// ===========================================================================
// GET /conviction
// ===========================================================================

app.get("/conviction", async (c) => {
  const portfolio = await resolvePortfolio();
  const guardrailStatus = guardrails.getStatus(portfolio.totalValueUsd);

  const body = {
    // ── Market regime (contrarian lens) ────────────────────────────────────
    regime: agentState.marketRegime,
    marketData: agentState.marketData
      ? {
          fearGreedIndex: agentState.marketData.globalMetrics?.fearGreedIndex ?? null,
          fearGreedLabel: getFgiLabel(agentState.marketData.globalMetrics?.fearGreedIndex ?? null),
          totalMarketCapUsd: agentState.marketData.globalMetrics?.totalMarketCapUsd ?? null,
          btcFundingRate: agentState.marketData.derivatives?.btcFundingRate ?? null,
          ethFundingRate: agentState.marketData.derivatives?.ethFundingRate ?? null,
          tokensTracked: agentState.marketData.tokenPrices.length,
          trending: agentState.marketData.trendingNarratives.slice(0, 5),
        }
      : null,

    // ── Per-token entry signals (ranked by conviction) ─────────────────────
    // These are the scores the agent uses to pick entries — contrarian, not
    // momentum. A higher score = better "early, not wrong" opportunity.
    signals: [...agentState.convictionSignals]
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map((s) => ({
        symbol: s.symbol,
        score: s.score,
        breakdown: s.breakdown,
        holderCount: s.holderCount,
        holderGrowthPercent: s.holderGrowthPercent,
        rationale: s.rationale,
      })),

    // ── Held positions (the conviction ledger) ─────────────────────────────
    // What the agent is currently holding through drawdown / letting run.
    // This is the proof it embodies "Early, Not Wrong".
    heldPositions: agentState.heldPositions.map((p) => ({
      symbol: p.symbol,
      entryPriceUsd: p.entryPriceUsd,
      amountUsd: p.amountUsd,
      entryCycle: p.entryCycle,
      cyclesHeld: p.cyclesHeld,
      peakPriceUsd: p.peakPriceUsd,
      maxUnderwaterPercent: Math.round(p.maxUnderwaterPercent * 10) / 10,
    })),

    // ── Latest position verdicts (what the agent decided this cycle) ───────
    positionVerdicts: agentState.positionVerdicts.map((v) => ({
      symbol: v.symbol,
      action: v.action,
      unrealizedPnLPercent: v.unrealizedPnLPercent,
      drawdownFromPeakPercent: v.drawdownFromPeakPercent,
      heldThroughDrawdown: v.heldThroughDrawdown,
      reason: v.reason,
    })),

    portfolio: {
      totalValueUsd: portfolio.totalValueUsd,
      drawdownPercent: Math.round(guardrailStatus.drawdownPercent * 10) / 10,
      positions: portfolio.positions.map((p) => ({
        symbol: p.symbol,
        valueUsd: p.valueUsd,
      })),
    },

    // ── On-chain conviction record ─────────────────────────────────────────
    anchoredHash: agentState.anchoring?.hash ?? agentState.lastAnchoredHash,
    anchoredUrl: agentState.anchoring
      ? getMantleExplorerTxUrl(agentState.anchoring.hash)
      : agentState.lastAnchoredHash
        ? getMantleExplorerTxUrl(agentState.lastAnchoredHash)
        : null,
    anchoring: agentState.anchoring,
  };

  return c.json(body);
});

// ===========================================================================
// Startup
// ===========================================================================

/**
 * Start the HTTP server on the configured port.
 * Falls back to alternative ports if the primary is in use.
 * Returns the server instance so it can be shut down gracefully.
 */
export function startServer(
  port: number = 3000,
  options: { fallbackPorts?: number[] } = {}
): ReturnType<typeof serve> {
  const fallbacks = options.fallbackPorts ?? [31778, 31779, 0];
  const portsToTry = [port, ...fallbacks];

  let lastError: unknown;

  for (const candidatePort of portsToTry) {
    try {
      console.log(`[server] Trying port ${candidatePort}...`);
      const server = serve({
        fetch: app.fetch,
        port: candidatePort,
      });

      const actualPort = candidatePort || (server.address() as any)?.port || candidatePort;
      console.log(`[server] Running on port ${actualPort}`);
      console.log(`[server] Routes:`);
      console.log(`  GET /status     — Agent status and guardrails`);
      console.log(`  GET /trades     — Trade history`);
      console.log(`  GET /conviction — Market data and conviction scores`);

      return server;
    } catch (err) {
      lastError = err;
      console.warn(`[server] Port ${candidatePort} failed:`, (err as Error)?.message || String(err));
      // If this was the user-requested port and it failed, log a warning
      if (candidatePort === port) {
        console.warn(`[server] Primary port ${port} unavailable — trying fallbacks...`);
      }
    }
  }

  // All ports failed — log the error and return a mock server that logs
  console.error(`[server] All ports unavailable. Last error:`, (lastError as Error)?.message || String(lastError));
  console.warn(`[server] HTTP server not available — agent continuing without it.`);

  // Return a mock server object so the caller doesn't crash
  return {
    close: () => {},
    address: () => null,
  } as unknown as ReturnType<typeof serve>;
}

// =============================================================================
// Helpers
// =============================================================================

function getFgiLabel(fgi: number | null): string {
  if (fgi === null) return "unknown";
  if (fgi <= 25) return "Extreme Fear";
  if (fgi <= 45) return "Fear";
  if (fgi <= 55) return "Neutral";
  if (fgi <= 75) return "Greed";
  return "Extreme Greed";
}
