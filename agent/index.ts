/**
 * Early, Not Wrong — Conviction-Native Trading Agent
 *
 * Main entry point. Orchestrates the autonomous trading loop:
 *   Portfolio → Market Data → Contrarian Scoring → Position Management
 *   → Entry Proposals → Guardrails → TWAK Execution → Mantle Anchoring
 *
 * The strategy embodies the brand: buy quality assets during fear (contrarian,
 * not momentum), HOLD through ordinary drawdown ("early, not wrong"), and exit
 * only to cap a loss (stop) or lock the asymmetry of a position that has
 * already run far enough (trailing stop). We never take profit early.
 *
 * Runs in simulator mode by default (no credentials required).
 * Set env vars to activate live mode:
 *   CMC_API_KEY        — CMC Pro API key for MCP data
 *   TWAK_ACCESS_ID     — TWAK credentials for live execution
 *   TWAK_HMAC_SECRET   — TWAK credentials for live execution
 *   AGENT_WALLET_KEY   — Agent wallet address
 *
 * See docs/AGENT_DESIGN.md for the agent's full architecture and
 * docs/CASPER_INTEGRATION.md for the cross-chain anchoring layer.
 */

// Load .env into process.env BEFORE any other module evaluates. This side-
// effect import MUST be the first one in this file — ESM hoists all imports
// before any top-level code, so the previous inline loader was actually
// running AFTER singletons (cmcClient, sosovalueClient, twakExecutor, …)
// had already captured process.env. Keys present only in .env (not in pm2's
// parent env) were silently missed. See lib/env-bootstrap.ts for details.
import "./lib/env-bootstrap.js";
import {
  initTelemetry,
  shutdownTelemetry,
  withSpan,
  recordCycleMetrics,
  cycleLog,
  isTelemetryEnabled,
  createPipelineRecorder,
} from "./lib/telemetry/index.js";
import { trace, context } from "@opentelemetry/api";

initTelemetry();

import { state, getBnbUsd, stuckSymbols, tickUnharvestableCooldowns } from "./lib/agent-state.js";
import { finalizeCycleExecution, resetCycleExecution } from "./lib/cycle-execution.js";
import {
  augmentPortfolioOnchain,
  augmentNativeBnbOnchain,
  fetchMarketData,
  analyzeConviction,
  runLLMJury,
  manageOpenPositions,
  harvestForBnb,
  createTradeProposals,
  checkTradeGuardrails,
  executeTrades,
  anchorToMantle,
  generateAndStoreNarrative,
  printCycleSummary,
} from "./lib/cycle-runner.js";
import { AGENT_CONFIG } from "./lib/config.js";
import { cmcClient, sosovalueClient } from "./lib/data-providers.js";
import { twakExecutor, TwakExecutor } from "./lib/twak-executor.js";
import {
  OnchainPortfolio,
} from "./lib/onchain-portfolio.js";
import { guardrails } from "./lib/risk-guardrails.js";
import { analyzeAgentBehavior } from "./lib/self-analysis.js";
import { setAgentState, startServer } from "./src/server.js";
import { startCapClient, stopCapClient, getCapStatus } from "./src/cap/client.js";
import { loadPaymentStats } from "./src/payment-stats.js";
import {
  sendCycleSummary,
  sendStartup,
  sendErrorAlert,
  sendGuidanceBroadcast,
} from "./lib/telegram.js";
import { getLiveSignalsTeaser } from "./src/mcp/tools.js";
import {
  startSubscriberPolling,
  stopSubscriberPolling,
} from "./lib/telegram-subscribers.js";
import { summarizeError, isRecoverable } from "./lib/errors.js";
import { AGENT_MODE } from "./lib/config.js";
import { persistState, loadPersistentState } from "./lib/persistence.js";
import type { MarketNarrative } from "./lib/market-narrative.js";

// =============================================================================
// Startup Health Check
// =============================================================================

async function startupCheck(): Promise<{
  twakMode: string;
  cmcConnected: boolean;
  sosovalueConnected: boolean;
  walletAddress: string | null;
  isTestnet: boolean;
}> {
  console.log("\n── Startup Health Check ──");

  const [twakHealth, cmcHealth, ssvHealth] = await Promise.all([
    twakExecutor.healthCheck(),
    cmcClient.healthCheck(),
    sosovalueClient.healthCheck(),
  ]);

  console.log(`  TWAK:        ${twakHealth.available ? "✓" : "○"} (${twakHealth.mode})`);
  if (twakHealth.diagnostics) {
    for (const d of twakHealth.diagnostics) {
      console.log(`               ${d}`);
    }
  }
  if (twakHealth.help) {
    console.log(`  TWAK help:   ${twakHealth.help}`);
  }
  console.log(`  CMC REST:    ${cmcHealth ? "✓" : "○"} (${cmcHealth ? "connected" : "unavailable — using cached/stub data"})`);
  console.log(`  SoSoValue:   ${ssvHealth ? "✓" : "○"} (${ssvHealth ? "connected" : "offline — CMC fallback only"})`);

  if (twakHealth.agentAddress) {
    console.log(`  Wallet:    ${twakHealth.agentAddress.slice(0, 10)}...${twakHealth.agentAddress.slice(-4)}`);
  }

  const guardrailStatus = guardrails.getStatus(0);
  console.log(`  Guardrails: ${guardrailStatus.allOk ? "✓" : "!"} (${guardrailStatus.tradesToday}/${AGENT_CONFIG.trading.maxDailyTrades} trades today)`);
  console.log(`  Mode:      ${twakHealth.mode === "simulator" ? "SIMULATOR (no real execution)" : "LIVE"}`);
  console.log(`  Market:    ${twakHealth.testnet ? "BSC Testnet" : "BSC Mainnet"}`);

  return {
    twakMode: twakHealth.mode,
    cmcConnected: !!cmcHealth,
    sosovalueConnected: !!ssvHealth,
    walletAddress: twakHealth.agentAddress ?? null,
    isTestnet: twakHealth.testnet,
  };
}

// =============================================================================
// Main Loop
// =============================================================================

async function runCycle(): Promise<void> {
  state.cycle++;
  state.status = "running";
  state.lastRunAt = Date.now();
  const cycleStart = Date.now();
  const cycleNumber = state.cycle;

  resetCycleExecution(state.cycle);

  // Reset cycle-local state (heldPositions persist across cycles — they ARE
  // the conviction ledger).
  state.guardrailResults = [];
  state.executedTrades = [];
  state.positionVerdicts = [];
  state.convictionSignals = [];
  state.marketRegime = null;
  state.regimeScore = null;
  state.sentimentLabel = null;

  sosovalueClient.resetApiCallCounter();
  state.lastAnchoredHash = null;
  state.anchoring = null;
  state.anchorResults = [];
  state.narrative = null;
  state.macroPause = null;

  console.log(`\n═══════════════════════════════════════`);
  console.log(`  CYCLE #${state.cycle} — ${new Date().toISOString()}`);
  console.log(`═══════════════════════════════════════`);

  cycleLog.info("cycle.start", { cycle: cycleNumber });

  try {
    await withSpan(
      "agent.run_cycle",
      async (rootSpan) => {
        rootSpan?.setAttribute("cycle.number", cycleNumber);
        const pipeline = createPipelineRecorder();

        await pipeline.record("portfolio", "Portfolio", () =>
          withSpan("agent.fetch_portfolio", async () => {
            state.portfolio = await twakExecutor.getPortfolio();
            await augmentPortfolioOnchain();
            console.log(
              `\n[1/8] Portfolio: $${state.portfolio.totalValueUsd.toFixed(2)} across ${state.portfolio.positions.length} positions`,
            );
          }, { "cycle.number": cycleNumber }),
        );

        tickUnharvestableCooldowns();

        await pipeline.record("market", "Market", () =>
          withSpan("agent.fetch_market_data", async () => {
            await fetchMarketData();
            await augmentNativeBnbOnchain();
          }, { "cycle.number": cycleNumber }),
        );

        await pipeline.record("score", "Score", () => analyzeConviction());
        await pipeline.record("jury", "Jury", () => runLLMJury());

        await pipeline.record("positions", "Positions", () =>
          withSpan("agent.manage_positions", async () => {
            await manageOpenPositions();
          }, { "cycle.number": cycleNumber }).then(() =>
            withSpan("agent.harvest_bnb", async () => {
              await harvestForBnb();
            }, { "cycle.number": cycleNumber }),
          ),
        );

        await pipeline.record("trade", "Trade", async () => {
          const proposals = await withSpan("agent.create_proposals", async (span) => {
            const p = await createTradeProposals();
            span?.setAttribute("proposals.count", p.length);
            return p;
          }, { "cycle.number": cycleNumber });

          if (proposals.length === 0) {
            console.log("\n  No qualifying entry proposals this cycle.");
          }

          const passed = proposals.length > 0
            ? await withSpan("agent.check_guardrails", async (span) => {
                const result = await checkTradeGuardrails(proposals);
                span?.setAttribute("guardrails.passed", result.passed.length);
                span?.setAttribute("guardrails.rejected", result.rejected.length);
                return result.passed;
              }, { "cycle.number": cycleNumber })
            : [];

          await withSpan("agent.execute_trades", async (span) => {
            if (passed.length > 0) {
              span?.setAttribute("trades.attempted", passed.length);
              await executeTrades(passed);
            } else if (proposals.length > 0) {
              console.log("\n[7/8] No trades passed guardrails. Skipping execution.");
            } else {
              console.log("\n[7/8] No entries to execute.");
            }
          }, { "cycle.number": cycleNumber });
        });

        await pipeline.record("anchor", "Anchor", () =>
          withSpan("agent.anchor_chains", async () => {
            await anchorToMantle();
          }, { "cycle.number": cycleNumber }),
        );

        await pipeline.record("wrap", "Wrap", async () => {
          await withSpan("agent.generate_narrative", async () => {
            await generateAndStoreNarrative();
          }, { "cycle.number": cycleNumber });

          state.status = "idle";
          state.nextRunAt =
            Date.now() + AGENT_CONFIG.trading.loopIntervalMinutes * 60 * 1000;

          try {
            const postCyclePortfolio = await twakExecutor.getPortfolio();
            state.portfolio = postCyclePortfolio;
            await augmentPortfolioOnchain();
            await augmentNativeBnbOnchain();
            guardrails.updatePeakValue(state.portfolio.totalValueUsd);
          } catch (err) {
            console.warn(
              `  [peak-refresh] Post-cycle portfolio refresh failed:`,
              summarizeError(err),
            );
            if (state.portfolio) {
              guardrails.updatePeakValue(state.portfolio.totalValueUsd);
            }
          }

          await withSpan("agent.self_analysis", async () => {
            const selfAnalysis = analyzeAgentBehavior();
            if (selfAnalysis) {
              state.behavioralMetrics = selfAnalysis;
              console.log(
                `\n[8c/8] Agent behavioral conviction: ${selfAnalysis.score} — ${selfAnalysis.archetype}`,
              );
            } else {
              state.behavioralMetrics = null;
              console.log("\n[8c/8] Agent self-analysis: insufficient closed positions");
            }
          }, { "cycle.number": cycleNumber });
        });

        const durationMs = Date.now() - cycleStart;
        rootSpan?.setAttribute("cycle.duration_ms", durationMs);
        rootSpan?.setAttribute(
          "portfolio.usd",
          state.portfolio?.totalValueUsd ?? 0,
        );
        rootSpan?.setAttribute("regime.score", state.regimeScore ?? -1);

        const drawdownPercent = state.portfolio
          ? guardrails.getStatus(state.portfolio.totalValueUsd).drawdownPercent
          : 0;
        const activePositions = state.heldPositions.filter(
          (p) => !p.stuck && !stuckSymbols.has(p.symbol),
        ).length;
        const guardrailsRejected = state.guardrailResults.filter((r) => !r.allowed).length;

        rootSpan?.setAttribute("drawdown.percent", drawdownPercent);
        rootSpan?.setAttribute("positions.active", activePositions);

        recordCycleMetrics({
          cycle: cycleNumber,
          durationMs,
          portfolioUsd: state.portfolio?.totalValueUsd ?? 0,
          drawdownPercent,
          activePositions,
          guardrailsRejected,
          tradesSucceeded: state.executedTrades.filter((t) => t.success).length,
          tradesFailed: state.executedTrades.filter((t) => !t.success).length,
          regimeScore: state.regimeScore,
          anchorOutcomes: state.anchorResults.map((r) => ({
            adapter: r.adapter,
            status: r.status,
          })),
        });

        const spanContext = trace.getSpan(context.active())?.spanContext();

        if (state.executedTrades.some((t) => !t.success)) {
          const tradeStep = pipeline.steps.find((s) => s.id === "trade");
          if (tradeStep) tradeStep.status = "error";
        }
        const anchorFailed = state.anchorResults.some((r) => r.status === "failed");
        if (anchorFailed) {
          const anchorStep = pipeline.steps.find((s) => s.id === "anchor");
          if (anchorStep) anchorStep.status = "error";
        } else if (state.anchorResults.some((r) => r.status === "skipped")) {
          const anchorStep = pipeline.steps.find((s) => s.id === "anchor");
          if (anchorStep && anchorStep.status === "ok") anchorStep.status = "warn";
        }

        state.lastCycleObservability = {
          cycle: cycleNumber,
          completedAt: Date.now(),
          durationMs,
          traceId: spanContext?.traceId ?? null,
          spanId: spanContext?.spanId ?? null,
          otelEnabled: isTelemetryEnabled(),
          portfolioUsd: state.portfolio?.totalValueUsd ?? 0,
          drawdownPercent,
          activePositions,
          regimeScore: state.regimeScore,
          tradesSucceeded: state.executedTrades.filter((t) => t.success).length,
          tradesFailed: state.executedTrades.filter((t) => !t.success).length,
          guardrailsRejected,
          anchorOutcomes: state.anchorResults.map((r) => ({
            adapter: r.adapter,
            status: r.status,
          })),
          pipelineSteps: pipeline.steps,
        };

        cycleLog.info("cycle.complete", {
          cycle: cycleNumber,
          duration_ms: durationMs,
          portfolio_usd: state.portfolio?.totalValueUsd ?? 0,
        });
      },
      { "cycle.number": cycleNumber },
    );

    finalizeCycleExecution();

    printCycleSummary(cycleStart);

    // Send cycle summary to Telegram (non-blocking, skip if not configured)
    const successfulTrades = state.executedTrades.filter(t => t.success).length;
    const failedTrades = state.executedTrades.filter(t => !t.success).length;
    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    sendCycleSummary({
      cycle: state.cycle,
      duration: `${elapsed}s`,
      status: state.status,
      tradesSucceeded: successfulTrades,
      tradesFailed: failedTrades,
      totalVolumeUsd: state.totalVolumeUsd,
      portfolioValueUsd: state.portfolio?.totalValueUsd ?? 0,
      drawdownPercent: state.portfolio
        ? guardrails.getStatus(state.portfolio.totalValueUsd).drawdownPercent
        : 0,
      regimeScore: state.regimeScore,
      sentimentLabel: state.sentimentLabel,
      anchoring: state.anchoring,
      executedTrades: state.executedTrades,
      errors: state.errors,
      positionLedgerUsd: state.heldPositions.reduce((sum, p) => sum + p.amountUsd, 0),
      positionsHeld: state.heldPositions.length,
      gasSpentThisCycle: state.executedTrades
        .filter(t => t.success)
        .reduce((sum, t) => sum + (t.feeUsd ?? 1.5), 0),
      totalGasSpent: state.totalGasSpentUsd,
      realizedPnl: state.realizedPnlUsd,
      topSignals: [...state.convictionSignals]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((s) => ({
          symbol: s.symbol,
          score: s.score,
          rationale: s.rationale,
          holderCount: s.holderCount,
          holderGrowthPercent: s.holderGrowthPercent,
        })),
      narrative: (() => {
        const n: MarketNarrative | null = state.narrative as MarketNarrative | null;
        return n ? {
          headline: n.headline,
          summary: n.summary,
          newsCount: n.newsCount,
          macroEventCount: n.macroEventCount,
        } : null;
      })(),
      usedSodex: state.executedTrades.some(t => t.txHash?.startsWith("0xSODEX_")),
      walletAddress: process.env.AGENT_WALLET_KEY || process.env.AGENT_WALLET_ADDRESS || undefined,
    }).catch(() => {});

    getLiveSignalsTeaser()
      .then((teaser) =>
        sendGuidanceBroadcast({
          cycle: state.cycle,
          guidance: teaser.guidance,
          stale: teaser.freshness.stale,
          signalCount: teaser.signalCount,
        }),
      )
      .catch(() => {});
  } catch (error) {
    state.status = "error";
    const summary = summarizeError(error);
    state.errors.push(summary);
    console.error(`\n✗ Cycle failed: ${summary}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    if (!isRecoverable(error)) {
      console.error(`  Non-recoverable error — agent will not retry this cycle.`);
    }

    sendErrorAlert({
      cycle: state.cycle,
      error: summary,
      stack: error instanceof Error ? error.stack : undefined,
    }).catch(() => {});
  }
}

// =============================================================================
// Startup — Snapshot Restore
// =============================================================================

/**
 * Restore the conviction ledger from the last persisted cycle so the agent
 * doesn't abandon open positions across a restart. Other cycle-local state
 * (regime, signals, verdicts) is rebuilt by the first cycle.
 */
async function restoreSnapshot(): Promise<void> {
  try {
    const persisted = await loadPersistentState();
    const held = persisted?.agent?.heldPositions;
    if (Array.isArray(held) && held.length > 0) {
      state.heldPositions = held.map((p) => ({
        ...p,
        failedExitAttempts: Number(p.failedExitAttempts) || 0,
        stuck: Boolean(p.stuck),
      }));
      // Restore stuck symbols blocklist so we don't re-enter broken tokens.
      for (const p of state.heldPositions) {
        if (p.stuck) stuckSymbols.add(p.symbol);
      }
      console.log(
        `  Snapshot: restored ${held.length} open position(s) from last cycle` +
        (stuckSymbols.size > 0 ? ` (${stuckSymbols.size} stuck)` : "")
      );
    } else {
      console.log(`  Snapshot: no open positions to restore`);
    }

    const gas = (persisted?.agent as { totalGasSpentUsd?: number } | undefined)?.totalGasSpentUsd;
    if (typeof gas === "number" && Number.isFinite(gas) && gas >= 0) {
      state.totalGasSpentUsd = gas;
    }
    const realized = (persisted?.agent as { realizedPnlUsd?: number } | undefined)?.realizedPnlUsd;
    if (typeof realized === "number" && Number.isFinite(realized)) {
      state.realizedPnlUsd = realized;
    }
    const totalTrades = (persisted?.agent as { totalTrades?: number } | undefined)?.totalTrades;
    if (typeof totalTrades === "number" && Number.isFinite(totalTrades) && totalTrades > 0) {
      state.totalTrades = totalTrades;
    }
    // Restore the last anchored thesis hash so the dedup in `anchorToMantle`
    // survives restarts. Without this, the first cycle after every pm2 bounce
    // re-anchors an unchanged thesis and wastes Casper gas.
    const persistedThesisHash = (persisted?.agent as { lastAnchoredThesisHash?: string | null } | undefined)?.lastAnchoredThesisHash;
    if (typeof persistedThesisHash === "string" && persistedThesisHash.length > 0) {
      state.lastAnchoredThesisHash = persistedThesisHash;
      console.log(`  Snapshot: restored last anchored thesis hash (${persistedThesisHash.slice(0, 18)}…)`);
    }
    // totalVolumeUsd was not persisted in agent state historically, but the
    // guardrail totals have tracked it all along. Restore from there.
    const guardrailVolume = persisted?.guardrails?.totalVolumeUsd;
    if (typeof guardrailVolume === "number" && Number.isFinite(guardrailVolume) && guardrailVolume > 0) {
      state.totalVolumeUsd = guardrailVolume;
    }
    // Restore aggregate trade statistics so the dashboard can show win rate,
    // average win/loss, and other metrics across restarts.
    const persistedStats = (persisted?.agent as { tradeStats?: typeof state.tradeStats } | undefined)?.tradeStats;
    if (persistedStats && typeof persistedStats === "object") {
      state.tradeStats = {
        entriesCount: Number(persistedStats.entriesCount) || 0,
        exitsCount: Number(persistedStats.exitsCount) || 0,
        winningExitsCount: Number(persistedStats.winningExitsCount) || 0,
        losingExitsCount: Number(persistedStats.losingExitsCount) || 0,
        totalWinsUsd: Number(persistedStats.totalWinsUsd) || 0,
        totalLossesUsd: Number(persistedStats.totalLossesUsd) || 0,
        largestWinUsd: Number(persistedStats.largestWinUsd) || 0,
        largestLossUsd: Number(persistedStats.largestLossUsd) || 0,
      };
    }

    // Restore the canonical ledger so self-analysis remains continuous across restarts.
    const persistedLedger = (persisted?.agent as { ledger?: typeof state.ledger } | undefined)?.ledger;
    if (Array.isArray(persistedLedger)) {
      state.ledger = persistedLedger;
      console.log(`  Snapshot: restored ${persistedLedger.length} ledger entries`);
    }

    if (state.heldPositions.length > 0 && AGENT_MODE === "live") {
      try {
        const onchain = new OnchainPortfolio();
        const addresses = TwakExecutor.getResolvedAddresses();
        const wallet = process.env.AGENT_WALLET_KEY || process.env.AGENT_WALLET_ADDRESS;
        if (!wallet) {
          console.warn(`  [reconcile] No wallet address configured — skipping on-chain check, keeping all positions`);
        } else {
          const before = state.heldPositions.length;
          const kept: typeof state.heldPositions = [];
          for (const p of state.heldPositions) {
            let contract = addresses.get(p.symbol.toUpperCase());
            if (!contract) contract = (await twakExecutor.resolveAddress(p.symbol)) ?? undefined;
            if (!contract) {
              kept.push(p);
              continue;
            }
            const balance = await onchain.getBalance(contract, wallet);
            if (balance > 0) {
              kept.push(p);
            } else {
              console.log(`  [reconcile] Dropping ghost position ${p.symbol} ($${p.amountUsd.toFixed(2)}) — balanceOf == 0`);
            }
          }
          state.heldPositions = kept;
          if (state.heldPositions.length < before) {
            console.log(`  [reconcile] Pruned ${before - state.heldPositions.length} ghost position(s); ${state.heldPositions.length} confirmed on-chain`);
          } else {
            console.log(`  [reconcile] All ${state.heldPositions.length} positions confirmed on-chain`);
          }
        }
      } catch (err) {
        console.warn(`  [reconcile] On-chain check failed, keeping all positions:`, summarizeError(err));
      }
    }
  } catch (err) {
    console.warn(
      "[snapshot] Restore failed, starting fresh:",
      summarizeError(err)
    );
  }
}

// =============================================================================
// Server Shared State Sync
// =============================================================================

function computeConfigHash(): string {
  const t = AGENT_CONFIG.trading;
  return `${t.topK}-${t.loopIntervalMinutes}-${t.maxDrawdownPercent}-${t.maxPerTradeUsd}-${t.maxDailyTrades}`;
}

function syncServerState(): void {
  const agentSnapshot = {
    cycle: state.cycle,
    status: state.status,
    lastRunAt: state.lastRunAt,
    nextRunAt: state.nextRunAt,
    totalTrades: state.totalTrades,
    totalVolumeUsd: state.totalVolumeUsd,
    totalGasSpentUsd: state.totalGasSpentUsd,
    realizedPnlUsd: state.realizedPnlUsd,
    tradeStats: state.tradeStats,
    errors: state.errors,
    marketData: state.marketData,
    executedTrades: state.executedTrades,
    lastAnchoredHash: state.lastAnchoredHash,
    lastAnchoredThesisHash: state.lastAnchoredThesisHash,
    anchoring: state.anchoring,
    anchorResults: state.anchorResults,
    marketRegime: state.marketRegime,
    convictionSignals: state.convictionSignals,
    heldPositions: state.heldPositions,
    positionVerdicts: state.positionVerdicts,
    narrative: state.narrative,
    llmDeliberation: state.llmDeliberation,
    casperEcosystemContext: state.casperEcosystemContext,
    macroPause: state.macroPause,
    portfolio: state.portfolio,
    behavioralMetrics: state.behavioralMetrics,
    ledger: state.ledger,
    cycleHistory: state.cycleHistory,
    lastCycleObservability: state.lastCycleObservability,
  };

  setAgentState(agentSnapshot);

  persistState({
    agentState: agentSnapshot,
    guardrails: {
      peakValueUsd: guardrails.getPeakValue(),
      totalTradesExecuted: guardrails.getTotals().totalTrades,
      totalVolumeUsd: guardrails.getTotals().totalVolumeUsd,
      lastTradeAt: state.lastRunAt,
    },
    configHash: computeConfigHash(),
  }).catch((err) => {
    console.warn("[persistence] State write failed:", summarizeError(err));
  });
}

// =============================================================================
// Startup
// =============================================================================

async function main(): Promise<void> {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║  EARLY, NOT WRONG — Trading Agent     ║");
  console.log("║  BNB Hack: AI Trading Agent Edition   ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log(`\nTop-K: ${AGENT_CONFIG.trading.topK}`);
  console.log(`Interval: ${AGENT_CONFIG.trading.loopIntervalMinutes} minutes (×2 when BNB < $${AGENT_CONFIG.trading.bankroll.targetBnbUsd})`);
  console.log(`Max drawdown: ${AGENT_CONFIG.trading.maxDrawdownPercent}%`);
  console.log(`Eligible tokens: ${AGENT_CONFIG.competition.eligibleTokens.length}`);
  console.log(`Default slippage: ${AGENT_CONFIG.trading.defaultSlippageBps} bps`);
  console.log(`Bankroll: reserve=$${AGENT_CONFIG.trading.bankroll.minBnbReserveUsd}, target=$${AGENT_CONFIG.trading.bankroll.targetBnbUsd}, max-trade-fraction=${AGENT_CONFIG.trading.bankroll.maxTradeFractionOfBnb * 100}%, entry-skip-below=$${AGENT_CONFIG.trading.bankroll.entrySkipBelowBnbUsd}`);

  const server = startServer(31777);
  loadPaymentStats();
  await startCapClient();
  const capStatus = getCapStatus();
  console.log(`  CROO CAP:    ${capStatus.connected ? "✓" : "○"} (${capStatus.services.length} services)`);
  console.log("");

  const health = await startupCheck();

  sendStartup({
    twakMode: health.twakMode,
    cmcConnected: health.cmcConnected,
    sosovalueConnected: health.sosovalueConnected,
    walletAddress: health.walletAddress,
    isTestnet: health.isTestnet,
    topK: AGENT_CONFIG.trading.topK,
    intervalMinutes: AGENT_CONFIG.trading.loopIntervalMinutes,
    maxDrawdown: AGENT_CONFIG.trading.maxDrawdownPercent,
  }).catch(() => {});

  // Public "watch this agent" channel — polls getUpdates for /start
  // subscribers. No-ops without TELEGRAM_BOT_TOKEN; timer is unref'd so it
  // never holds the process open on its own.
  startSubscriberPolling();

  console.log(`Agent mode: ${AGENT_MODE.toUpperCase()}${AGENT_MODE === "simulator" ? " (no real execution)" : ""}`);

  await restoreSnapshot();
  syncServerState();

  console.log("\nStarting first cycle...");
  await runCycle();

  syncServerState();

  const baseIntervalMs = AGENT_CONFIG.trading.loopIntervalMinutes * 60 * 1000;

  const scheduleNextCycle = (): void => {
    const bnbUsd = getBnbUsd(state.portfolio);
    const cfg = AGENT_CONFIG.trading.bankroll;
    const intervalMs = cfg.adaptiveInterval && bnbUsd > 0 && bnbUsd < cfg.targetBnbUsd
      ? baseIntervalMs * 2
      : baseIntervalMs;
    const intervalMinutes = intervalMs / 60000;

    state.nextRunAt = Date.now() + intervalMs;
    console.log(`\nNext cycle in ${intervalMinutes} minutes (${new Date(state.nextRunAt).toISOString()})${intervalMs > baseIntervalMs ? ` — adaptive (BNB=$${bnbUsd.toFixed(2)} < target=$${cfg.targetBnbUsd})` : ""}`);

    setTimeout(() => {
      runCycle()
        .then(() => {
          try {
            syncServerState();
          } catch (syncError) {
            console.error("State sync failed after cycle:", summarizeError(syncError));
          }
        })
        .catch((cycleError) => {
          console.error("Unhandled cycle error (isolated):", summarizeError(cycleError));
          try {
            syncServerState();
          } catch { /* ignore */ }
        })
        .finally(() => {
          scheduleNextCycle();
        });
    }, intervalMs);
  };

  scheduleNextCycle();

  process.on("SIGINT", async () => {
    console.log("\nGraceful shutdown...");
    console.log(`Total trades: ${state.totalTrades}, Volume: $${state.totalVolumeUsd.toFixed(2)}`);
    stopSubscriberPolling();
    server.close();
    await stopCapClient();
    await shutdownTelemetry();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
