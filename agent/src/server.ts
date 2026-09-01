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
import { HARNESS_CONFIG } from "../lib/harness-config.js";
import { getMarketHours } from "../lib/adapters/alpaca-data.js";
import { twakExecutor } from "../lib/twak-executor.js";
import { guardrails } from "../lib/risk-guardrails.js";
import { getMantleExplorerTxUrl } from "../lib/config.js";
import { optionsState } from "../lib/options-state.js";
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
import type { JuryDeliberation } from "../lib/llm-jury.js";
import type { CasperEcosystemContext } from "../lib/casper-mcp-client.js";
import type { TradeStats, ReputationMetrics, CycleSummary, CycleObservabilitySnapshot } from "../lib/agent-state.js";
import type { LedgerEntry } from "conviction-core";
import { handleMcpRequest } from "./mcp/server.js";
import { x402Middleware } from "./mcp/x402.js";
import { PRICING as MCP_PRICING } from "./mcp/pricing.js";
import { paymentStats, serializeByTool } from "./payment-stats.js";
import { CAP_PRICING } from "./cap/pricing.js";
import { getCapStatus } from "./cap/client.js";
import { getBotUsername, getSubscriberCount } from "../lib/telegram-subscribers.js";
import { runEdgeReport, type BacktestConfig } from "../lib/backtest.js";
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
  /** Last thesis hash that was (or would have been) anchored. Persists across
   *  restarts so the dedup in `anchorToMantle` survives pm2 bounces — without
   *  this, the first cycle after every restart re-anchors an unchanged thesis
   *  and burns Casper gas for nothing. */
  lastAnchoredThesisHash: string | null;
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
  /** LLM conviction jury deliberation for the current cycle (7th factor). */
  llmDeliberation: JuryDeliberation | null;
  /** Casper ecosystem context fetched via MCP (CSPR.trade + blockchain MCP). */
  casperEcosystemContext: CasperEcosystemContext | null;
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
  /** Rolling history of recent anchor results (most recent first, capped at 50). */
  anchorHistory: AnchorHistoryEntry[];
  /** Ring buffer of recent cycle summaries for the dashboard timeline (last 10). */
  cycleHistory: CycleSummary[];
  /** OpenTelemetry snapshot from the last completed cycle. */
  lastCycleObservability: CycleObservabilitySnapshot | null;
}

/** Compact history entry for the /casper/anchors endpoint. */
export interface AnchorHistoryEntry {
  adapter: string;
  status: "success" | "skipped" | "failed";
  txHash?: string;
  explorerUrl?: string;
  timestamp: number;
  cycle: number;
  /** The conviction record that was anchored (if available). */
  subjectHash?: string;
  convictionScore?: number;
  archetype?: string;
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
  lastAnchoredThesisHash: null,
  anchoring: null,
  anchorResults: [],
  marketRegime: null,
  convictionSignals: [],
  narrative: null,
  llmDeliberation: null,
  casperEcosystemContext: null,
  macroPause: null,
  heldPositions: [],
  positionVerdicts: [],
  portfolio: null,
  behavioralMetrics: null,
  ledger: [],
  anchorHistory: [],
  cycleHistory: [],
  lastCycleObservability: null,
};

/**
 * Resolve the portfolio to report: prefer the loop's augmented snapshot, and
 * only fall back to a raw TWAK fetch before the first cycle has populated it.
 *
 * In the options domain the shared snapshot carries the mapped Alpaca
 * portfolio (set by syncOptionsServerState); never fall back to TWAK there —
 * TWAK is the crypto executor and would leak the wrong domain's data.
 */
async function resolvePortfolio(): Promise<TwakPortfolio> {
  if (HARNESS_CONFIG.domain === "options") {
    return agentState.portfolio ?? {
      totalValueUsd: 0,
      positions: [],
      chains: [],
      lastUpdated: Date.now(),
    };
  }
  return agentState.portfolio ?? (await twakExecutor.getPortfolio());
}

/**
 * Update the shared state (called from index.ts after each cycle).
 * When new anchorResults are provided, they're prepended to anchorHistory.
 */
export function setAgentState(state: Partial<AgentServerState>): void {
  // If new anchor results came in, append them to the rolling history.
  if (state.anchorResults && state.anchorResults.length > 0) {
    const newEntries: AnchorHistoryEntry[] = state.anchorResults.map((r) => ({
      adapter: r.adapter,
      status: r.status,
      txHash: r.txHash,
      explorerUrl: r.explorerUrl,
      timestamp: Date.now(),
      cycle: agentState.cycle,
    }));
    agentState = {
      ...agentState,
      ...state,
      anchorHistory: [...newEntries, ...agentState.anchorHistory].slice(0, 50),
    };
  } else {
    agentState = { ...agentState, ...state };
  }
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
// GET /signals/teaser — public guidance preview (no full paid payload)
// GET /signals/preview — alias for teaser (backward compat for dashboard proxy)
// ===========================================================================
//
// Paid buyers receive the full signals-live/v1.2 envelope via CROO CAP or MCP
// x402. The web app only gets guidance + top symbol here.

app.get("/signals/teaser", async (c) => {
  const { getLiveSignalsTeaser } = await import("./mcp/tools.js");
  return c.json(await getLiveSignalsTeaser());
});

app.get("/signals/preview", async (c) => {
  const { getLiveSignalsTeaser } = await import("./mcp/tools.js");
  return c.json(await getLiveSignalsTeaser());
});

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
//   4. GET  /casper/anchors                    → recent anchor history

app.get("/casper/anchors", (c) => {
  return c.json({ anchors: agentState.anchorHistory });
});

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

  // Options domain: surface the market-hours gate so the dashboard shows
  // when the agent can actually trade (orders are deferred off-hours).
  let market = null;
  if (HARNESS_CONFIG.domain === "options") {
    try {
      const hours = await getMarketHours();
      market = {
        is_open: hours.isOpen,
        next_open: hours.nextOpen,
        next_close: hours.nextClose,
      };
    } catch {
      // Non-fatal — market gate is informational on the dashboard.
    }
  }

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
    // Options domain market-hours state (null for the crypto domain).
    market,
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
    // Recent cycle history for the dashboard timeline (ring buffer, last 10)
    cycleHistory: agentState.cycleHistory,
    // LLM jury deliberation summary — provider, model, and top verdict.
    llmJury: agentState.llmDeliberation
      ? {
          provider: agentState.llmDeliberation.provider,
          model: agentState.llmDeliberation.model,
          tokensEvaluated: agentState.llmDeliberation.tokensEvaluated,
          marketAssessment: agentState.llmDeliberation.marketAssessment,
          topVerdict: agentState.llmDeliberation.verdicts[0] ?? null,
        }
      : null,
    observability: agentState.lastCycleObservability,
  };

  return c.json(body);
});

// ===========================================================================
// GET /options/status — options-domain observability
// ===========================================================================
//
// The options agent runs as a separate process/port (31778) with its own
// state container (optionsState). This route surfaces that state — portfolio,
// market-hours gate, cycle/P&L, top scored contracts, and open positions —
// so the web app's Proof view can render an options card exactly like the
// Delphi arena card. Returns a domain-friendly payload with honest empty
// state before the first cycle.

app.get("/options/status", async (c) => {
  if (HARNESS_CONFIG.domain !== "options") {
    // Not the options process — the crypto agent serves a different surface.
    return c.json({ hasData: false, domain: HARNESS_CONFIG.domain });
  }

  let market = null;
  try {
    const hours = await getMarketHours();
    market = {
      is_open: hours.isOpen,
      next_open: hours.nextOpen,
      next_close: hours.nextClose,
    };
  } catch {
    // Non-fatal.
  }

  // Only surface contracts with usable IV — a degenerate (near-zero IV)
  // quote isn't a real market, and showing it as a top pick on the dashboard
  // would advertise the same fake edge the proposal gate now rejects.
  const topSignals = [...optionsState.convictionSignals]
    .filter((s) => ((s.signal.metadata?.impliedVolatility as number) ?? 0) >= 0.05)
    .sort((a, b) => b.conviction.score - a.conviction.score)
    .slice(0, 12)
    .map((s) => ({
      symbol: s.signal.symbol,
      contractType: (s.signal.metadata?.contractType as string) ?? "call",
      strike: (s.signal.metadata?.strike as number) ?? 0,
      expiry: (s.signal.metadata?.expiry as string) ?? "",
      underlyingSymbol: (s.signal.metadata?.underlyingSymbol as string) ?? "",
      iv: (s.signal.metadata?.impliedVolatility as number) ?? 0,
      ivToRealized: (s.signal.metadata?.ivToRealized as number) ?? 0,
      score: s.conviction.score,
      rationale: s.conviction.rationale,
    }));

  const positions = optionsState.heldPositions.map((p) => ({
    symbol: p.symbol,
    underlyingSymbol: p.underlyingSymbol,
    contractType: p.contractType,
    strike: p.strike,
    expiry: p.expiry,
    quantity: p.quantity,
    avgEntryPrice: p.avgEntryPrice,
    entryConviction: p.entryConviction,
    unrealizedPnlUsd: p.unrealizedPnlUsd,
    unrealizedPnlPercent: p.unrealizedPnlPercent,
  }));

  return c.json({
    hasData: optionsState.cycle > 0,
    domain: "options",
    cycle: optionsState.cycle,
    status: optionsState.status,
    lastRunAt: optionsState.lastRunAt,
    nextRunAt: optionsState.nextRunAt,
    totalTrades: optionsState.totalTrades,
    totalVolumeUsd: optionsState.totalVolumeUsd,
    realizedPnlUsd: optionsState.realizedPnlUsd,
    unrealizedPnlUsd: positions.reduce((sum, p) => sum + (p.unrealizedPnlUsd || 0), 0),
    equityPnlUsd: optionsState.portfolio
      ? optionsState.portfolio.totalValueUsd - 100_000
      : 0,
    errors: optionsState.errors.length,
    market,
    portfolio: optionsState.portfolio
      ? {
          totalValueUsd: optionsState.portfolio.totalValueUsd,
          cashUsd: optionsState.portfolio.cashUsd,
          positions: optionsState.portfolio.positions.length,
        }
      : null,
    topSignals,
    positions,
    verdicts: optionsState.positionVerdicts.slice(0, 12),
  });
});

// ===========================================================================
// GET /edge-report
// ===========================================================================
// On-demand edge report: conviction strategy vs naive baseline, with factor
// attribution. Answers the buyer-agent question "does the signal have
// demonstrable edge?" in real time. Runs against live SoSoValue klines when
// available (stale-cache or synthetic fallback otherwise — honestly flagged
// in the response dataSource).

/** Cache the report for 30 min — a backtest is expensive (20 symbols ×
 *  kline fetches through the 3s/symbol throttle) and the 90-day window
 *  barely moves between calls. Repeated hits shouldn't burn API quota. */
let edgeReportCache: { report: unknown; computedAt: number } | null = null;
const EDGE_REPORT_CACHE_TTL_MS = 30 * 60 * 1000;

app.get("/edge-report", async (c) => {
  const fresh = c.req.query("fresh") === "1" || c.req.query("fresh") === "true";
  if (!fresh && edgeReportCache && Date.now() - edgeReportCache.computedAt < EDGE_REPORT_CACHE_TTL_MS) {
    return c.json({ ...(edgeReportCache.report as object), cached: true, cachedAt: edgeReportCache.computedAt });
  }

  const today = new Date();
  const start = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const cfg: BacktestConfig = {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
    initialBnbUsd: 9,
    initialCashUsd: 70,
    symbols: AGENT_CONFIG.competition.eligibleTokens.slice(0, 20),
    adaptiveWeights: true,
    honeypotGate: false,
    slippageBps: 100,
    gasUsd: 1.5,
    maxOpenPositions: AGENT_CONFIG.trading.maxOpenPositions,
    minConvictionScore: 60,
    maxTradeFractionOfBnb: AGENT_CONFIG.trading.bankroll.maxTradeFractionOfBnb,
    minBnbReserveUsd: AGENT_CONFIG.trading.bankroll.minBnbReserveUsd,
    stopLossPercent: AGENT_CONFIG.trading.stopLossPercent,
    partialProfitGainPercent: AGENT_CONFIG.trading.partialProfitGainPercent,
    trailingActivationGainPercent: AGENT_CONFIG.trading.trailingActivationGainPercent,
    trailingStopPercent: AGENT_CONFIG.trading.trailingStopPercent,
  };
  try {
    const report = await runEdgeReport(cfg);
    edgeReportCache = { report, computedAt: Date.now() };
    return c.json({ ...report, cached: false });
  } catch (err) {
    return c.json({ error: "edge report failed", message: String(err) }, 500);
  }
});

// ===========================================================================
// GET /delphi/status — prediction-market runner observability
// ===========================================================================
//
// The Delphi loop runs in a separate pm2 process and persists its state under
// AGENT_DATA_DIR/delphi/. This route reads that state off disk (no shared
// memory) and returns the snapshot, open forecasts, the last on-chain anchor,
// and the calibration report (Brier / reliability over resolved forecasts).
// Honest empty state when the runner has never produced data.

import { readDelphiStatus } from "../lib/delphi/status.js";

app.get("/delphi/status", (c) => {
  const status = readDelphiStatus({
    windowOpens: AGENT_CONFIG.delphi.tradingWindowOpens,
    windowCloses: AGENT_CONFIG.delphi.tradingWindowCloses,
    network: AGENT_CONFIG.delphi.network,
    enabled: process.env.DELPHI_ENABLED === "1",
  });
  return c.json(status);
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

    // ── LLM conviction jury deliberation (7th factor) ──────────────────
    // The AI's per-token reasoning, adjustments, and risk assessments.
    // This is the "meaningful AI integration" — adjustments actually move
    // the conviction score, and the digest is anchored on-chain.
    llmDeliberation: agentState.llmDeliberation,

    // ── Casper ecosystem context (via MCP) ─────────────────────────────
    // The agent consumes CSPR.trade + Casper blockchain MCP servers
    // as cross-chain market context for the LLM jury.
    casperEcosystemContext: agentState.casperEcosystemContext,

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
      console.log(`  GET /edge-report — Conviction vs naive baseline edge + factor attribution`);
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
