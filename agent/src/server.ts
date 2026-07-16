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
import { getMantleExplorerTxUrl } from "../lib/config.js";
import type { AnchorResult } from "../lib/anchors/types.js";
import type { SwapResult, TwakPortfolio } from "../lib/twak-executor.js";
import type { CmcMarketData } from "../lib/data-providers.js";
import type {
  ConvictionSignal,
  HeldPosition,
  MarketRegime,
  PositionVerdict,
} from "../lib/conviction-signal.js";
import type { MarketNarrative } from "../lib/market-narrative.js";
import type { MacroPauseSignal } from "../lib/sosovalue-signals.js";
import type { TradeStats, ReputationMetrics } from "../lib/agent-state.js";
import type { LedgerEntry } from "conviction-core";
import { handleMcpRequest } from "./mcp/server.js";
import { x402Middleware } from "./mcp/x402.js";
import { PRICING as MCP_PRICING } from "./mcp/pricing.js";
import { paymentStats, serializeByTool } from "./payment-stats.js";
import { CAP_PRICING } from "./cap/pricing.js";
import { getCapStatus } from "./cap/client.js";
import { getBotUsername, getSubscriberCount } from "../lib/telegram-subscribers.js";
import { aleoSignHmacMiddleware, handleSignVoucher } from "./aleo/sign-service.js";
import { queryBalance, buildAnchorTransaction, submitSignedTransaction } from "../lib/anchors/casper.js";

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
  totalGasSpentUsd: number;
  realizedPnlUsd: number;
  tradeStats: TradeStats;
  errors: string[];
  marketData: CmcMarketData | null;
  executedTrades: SwapResult[];
  lastAnchoredHash: string | null;
  anchoring: {
    hash: string;
    mode: "on-chain" | "reverted" | "off-chain" | "simulator" | "cached";
    blockNumber?: number;
    gasUsed?: string;
  } | null;
  /** Per-adapter anchor results (Mantle, Casper, …) for the most recent cycle.
   *  Surfaces dual-chain anchoring on the frontend without breaking the legacy
   *  single-anchor `anchoring` field above. */
  anchorResults: AnchorResult[];
  // Conviction-native fields — the soul of the agent, surfaced on the dashboard.
  marketRegime: MarketRegime | null;
  convictionSignals: ConvictionSignal[];
  /** Market narrative generated this cycle from SoSoValue feeds + conviction data. */
  narrative: MarketNarrative | null;
  /** Macro event pause state — drives entry sizing this cycle. */
  macroPause: MacroPauseSignal | null;
  heldPositions: HeldPosition[];
  positionVerdicts: PositionVerdict[];
  /**
   * The loop's last portfolio snapshot, already augmented with the on-chain
   * value of held BEP-20s. Endpoints prefer this over re-fetching the raw
   * TWAK portfolio (which only sees native BNB + USDC and would understate
   * value, faking a drawdown against the augmented peak).
   */
  portfolio: TwakPortfolio | null;
  /** Behavioral conviction score the agent assigned itself this cycle. */
  behavioralMetrics: ReputationMetrics | null;
  /** Canonical ledger of agent entries/exits used for self-analysis. */
  ledger: LedgerEntry[];
}

let agentState: AgentServerState = {
  cycle: 0,
  status: "starting",
  lastRunAt: null,
  nextRunAt: null,
  totalTrades: 0,
  totalVolumeUsd: 0,
  totalGasSpentUsd: 0,
  realizedPnlUsd: 0,
  tradeStats: {
    entriesCount: 0,
    exitsCount: 0,
    winningExitsCount: 0,
    losingExitsCount: 0,
    totalWinsUsd: 0,
    totalLossesUsd: 0,
    largestWinUsd: 0,
    largestLossUsd: 0,
  },
  errors: [],
  marketData: null,
  executedTrades: [],
  lastAnchoredHash: null,
  anchoring: null,
  anchorResults: [],
  marketRegime: null,
  convictionSignals: [],
  narrative: null,
  macroPause: null,
  heldPositions: [],
  positionVerdicts: [],
  portfolio: null,
  behavioralMetrics: null,
  ledger: [],
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
// MCP server — POST /mcp (Streamable HTTP transport)
// ===========================================================================
//
// Exposes the agent's cross-chain reputation registry to any MCP-compatible
// client. Mounted on the same Hono process so the agent isn't running two
// HTTP servers — one boot, shared state. See src/mcp/server.ts.

// x402 paywall gates paid tools; free tools and protocol messages
// (initialize, tools/list) pass through. Stats are exposed at /reputation/stats.
// Imported at module top so the middleware is registered BEFORE the first
// request — a dynamic import was racing the test client.
app.use("/mcp", x402Middleware());

app.post("/mcp", (c) => handleMcpRequest(c.req.raw));

// ===========================================================================
// POST /aleo/sign-voucher — Aleo treasury voucher signing
// ===========================================================================
//
// The Aleo rebate flow needs ALEO_PRIVATE_KEY to sign vouchers. We host that
// here (one process, one key, file-level perms) rather than on Vercel (where
// the key would land in process memory of every serverless invocation + any
// post-install npm dependency in our bundle).
//
// The Vercel rebate route is now a thin HMAC-authed proxy: it builds the
// payload, signs `${timestamp}.${body}` with the shared secret, sends here.
// We verify, sign with the Aleo key, return { nonce, signature }.

app.use("/aleo/sign-voucher", aleoSignHmacMiddleware());
app.post("/aleo/sign-voucher", handleSignVoucher);

// ===========================================================================
// GET /cap/status — CROO CAP connection and advertised services
// ===========================================================================

app.get("/cap/status", (c) =>
  c.json({
    connected: getCapStatus().connected,
    services: Object.fromEntries(
      Object.values(CAP_PRICING).map((entry) => [entry.serviceId, entry.description]),
    ),
  }),
);

// ===========================================================================
// GET /reputation/stats — live A2A payment counters for the dashboard
// ===========================================================================
//
// Top-level fields remain the x402 view for backward compatibility with the
// existing dashboard. The `providers` breakdown surfaces CAP stats as well,
// so future UI can aggregate both settlement rails without a breaking change.

app.get("/reputation/stats", (c) => {
  const x402 = paymentStats.byProvider.x402;
  const cap = paymentStats.byProvider.cap;
  return c.json({
    queriesServed: x402.queriesServed,
    paidQueries: x402.paidQueries,
    feesCollectedBaseUnits: x402.feesCollectedBaseUnits.toString(),
    pricing: MCP_PRICING,
    byTool: serializeByTool(x402.byTool),
    providers: {
      x402: {
        queriesServed: x402.queriesServed,
        paidQueries: x402.paidQueries,
        feesCollectedBaseUnits: x402.feesCollectedBaseUnits.toString(),
        pricing: MCP_PRICING,
        byTool: serializeByTool(x402.byTool),
      },
      cap: {
        queriesServed: cap.queriesServed,
        paidQueries: cap.paidQueries,
        feesCollectedBaseUnits: cap.feesCollectedBaseUnits.toString(),
        pricing: Object.fromEntries(
          Object.values(CAP_PRICING).map((entry) => [
            entry.serviceId,
            {
              paid: BigInt(entry.amountUsdcBaseUnits) > 0n,
              amountUsdcBaseUnits: entry.amountUsdcBaseUnits,
              description: entry.description,
            },
          ]),
        ),
        byTool: serializeByTool(cap.byTool),
      },
    },
  });
});

// ===========================================================================
// Casper Wallet routes — browser-wallet flows (balance, build-anchor, submit)
// ===========================================================================
//
// These endpoints let a visitor with the Casper Wallet browser extension
// interact with the live ConvictionRegistry contract from the dashboard.
// The server holds CSPR_CLOUD_TOKEN and the contract hash; the browser holds
// the signing key. The flow is:
//   1. GET  /casper/balance?publicKey=…        → CSPR balance in motes
//   2. POST /casper/build-anchor               → unsigned transaction JSON
//   3. POST /casper/submit-anchor              → submit signed transaction

app.get("/casper/balance", async (c) => {
  const publicKey = c.req.query("publicKey");
  if (!publicKey || !/^0[12][0-9a-fA-F]{64}$/.test(publicKey)) {
    return c.json({ error: "Missing or invalid publicKey" }, 400);
  }
  try {
    const balanceMotes = await queryBalance(publicKey);
    return c.json({
      publicKey,
      balanceMotes: balanceMotes.toString(),
      balanceCspr: (Number(balanceMotes) / 1e9).toFixed(4),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Balance query failed" }, 502);
  }
});

app.post("/casper/build-anchor", async (c) => {
  try {
    const body = await c.req.json();
    const { publicKey, record } = body as {
      publicKey: string;
      record: {
        subjectHash: string;
        thesisHash: string;
        convictionScore: number;
        archetype: string;
        timestamp: number;
      };
    };
    if (!publicKey || !/^0[12][0-9a-fA-F]{64}$/.test(publicKey)) {
      return c.json({ error: "Missing or invalid publicKey" }, 400);
    }
    if (!record?.subjectHash || !record?.thesisHash) {
      return c.json({ error: "Missing conviction record fields" }, 400);
    }
    const transactionJson = buildAnchorTransaction(
      {
        subjectHash: record.subjectHash as `0x${string}`,
        thesisHash: record.thesisHash as `0x${string}`,
        convictionScore: record.convictionScore,
        archetype: record.archetype,
        timestamp: record.timestamp,
      },
      publicKey,
    );
    return c.json({ transaction: transactionJson });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Build failed" }, 500);
  }
});

app.post("/casper/submit-anchor", async (c) => {
  try {
    const body = await c.req.json();
    const { transaction, signature, publicKey } = body as {
      transaction: unknown;
      signature: string;
      publicKey: string;
    };
    if (!transaction || !signature || !publicKey) {
      return c.json({ error: "Missing transaction, signature, or publicKey" }, 400);
    }
    const result = await submitSignedTransaction(transaction, signature, publicKey);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Submit failed" }, 500);
  }
});

// ===========================================================================
// GET /status
// ===========================================================================

app.get("/status", async (c) => {
  const portfolio = await resolvePortfolio();
  const guardrailStatus = guardrails.getStatus(portfolio.totalValueUsd);
  const stats = agentState.tradeStats;
  const winRate = stats.exitsCount > 0 ? stats.winningExitsCount / stats.exitsCount : 0;
  const avgWinUsd = stats.winningExitsCount > 0 ? stats.totalWinsUsd / stats.winningExitsCount : 0;
  const avgLossUsd = stats.losingExitsCount > 0 ? stats.totalLossesUsd / stats.losingExitsCount : 0;
  const profitFactor = stats.totalLossesUsd > 0 ? stats.totalWinsUsd / stats.totalLossesUsd : (stats.totalWinsUsd > 0 ? Infinity : 0);
  const netPnlUsd = agentState.realizedPnlUsd - agentState.totalGasSpentUsd;
  const botUsername = getBotUsername();

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
    // "Watch this agent" — public Telegram subscription channel. Null when
    // TELEGRAM_BOT_TOKEN is unset or getMe hasn't resolved yet.
    telegram: botUsername
      ? { botUsername, subscriberCount: getSubscriberCount() }
      : null,
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
    metrics: {
      realizedPnlUsd: agentState.realizedPnlUsd,
      totalGasSpentUsd: agentState.totalGasSpentUsd,
      netPnlUsd,
      winRate,
      totalEntries: stats.entriesCount,
      totalExits: stats.exitsCount,
      winningExits: stats.winningExitsCount,
      losingExits: stats.losingExitsCount,
      totalWinsUsd: stats.totalWinsUsd,
      totalLossesUsd: stats.totalLossesUsd,
      averageWinUsd: avgWinUsd,
      averageLossUsd: avgLossUsd,
      largestWinUsd: stats.largestWinUsd,
      largestLossUsd: stats.largestLossUsd,
      profitFactor,
    },
    behavioralMetrics: agentState.behavioralMetrics,
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
        weights: s.weights,
        holderCount: s.holderCount,
        holderGrowthPercent: s.holderGrowthPercent,
        newsSentiment: s.newsSentiment,
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
      stuck: p.stuck,
      failedExitAttempts: p.failedExitAttempts,
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

    // ── Market narrative (SoSoValue feeds + conviction, Phase 3) ────────
    narrative: agentState.narrative,

    // ── Macro event pause state (SoSoValue macro calendar) ─────────────
    // Surfaces high-impact macro events that are sizing-down or skipping
    // entries this cycle. clear=true means no pause active.
    macroPause: agentState.macroPause
      ? {
          clear: agentState.macroPause.clear,
          skipEntries: agentState.macroPause.skipEntries,
          sizeMultiplier: agentState.macroPause.sizeMultiplier,
          hoursUntilNext: agentState.macroPause.hoursUntilNext,
          reason: agentState.macroPause.reason,
          triggeringEvent: agentState.macroPause.triggeringEvent
            ? {
                name: agentState.macroPause.triggeringEvent.name,
                date: agentState.macroPause.triggeringEvent.date,
                impact: agentState.macroPause.triggeringEvent.impact,
              }
            : null,
        }
      : null,

    // ── On-chain conviction record ─────────────────────────────────────────
    // Legacy single-anchor fields kept for backward-compatible clients.
    anchoredHash: agentState.anchoring?.hash ?? agentState.lastAnchoredHash,
    anchoredUrl: agentState.anchoring
      ? getMantleExplorerTxUrl(agentState.anchoring.hash)
      : agentState.lastAnchoredHash
        ? getMantleExplorerTxUrl(agentState.lastAnchoredHash)
        : null,
    anchoring: agentState.anchoring,
    // Per-adapter results — the frontend renders one row per chain that
    // attempted/succeeded this cycle. Each carries its own explorerUrl.
    anchorResults: agentState.anchorResults,
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
      console.log(`  GET /casper/balance    — CSPR balance for a public key`);
      console.log(`  POST /casper/build-anchor  — Build unsigned anchor transaction`);
      console.log(`  POST /casper/submit-anchor  — Submit signed anchor transaction`);

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
