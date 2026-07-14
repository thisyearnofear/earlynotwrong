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

import { state, getBnbUsd, stuckSymbols, tickUnharvestableCooldowns } from "./lib/agent-state.js";
import {
  augmentPortfolioOnchain,
  fetchMarketData,
  analyzeConviction,
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
import { setAgentState, startServer } from "./src/server.js";
import { startCapClient, stopCapClient, getCapStatus } from "./src/cap/client.js";
import {
  sendCycleSummary,
  sendStartup,
  sendErrorAlert,
} from "./lib/telegram.js";
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

  // Reset cycle-local state (heldPositions persist across cycles — they ARE
  // the conviction ledger).
  state.guardrailResults = [];
  state.executedTrades = [];
  state.positionVerdicts = [];
  state.convictionSignals = [];
  state.marketRegime = null;
  state.regimeScore = null;
  state.sentimentLabel = null;
  state.lastAnchoredHash = null;
  state.anchoring = null;
  state.anchorResults = [];
  state.narrative = null;
  state.macroPause = null;

  console.log(`\n═══════════════════════════════════════`);
  console.log(`  CYCLE #${state.cycle} — ${new Date().toISOString()}`);
  console.log(`═══════════════════════════════════════`);

  try {
    // Step 1: Fetch portfolio from TWAK
    state.portfolio = await twakExecutor.getPortfolio();
    // Augment with real on-chain value of held BEP-20s (TWAK can't see them)
    await augmentPortfolioOnchain();
    console.log(`\n[1/8] Portfolio: $${state.portfolio.totalValueUsd.toFixed(2)} across ${state.portfolio.positions.length} positions`);

    // Tick down per-token harvest cooldowns (one cycle elapsed since last tick)
    tickUnharvestableCooldowns();

    // Step 2: Fetch market data from CMC
    await fetchMarketData();

    // Step 3: Score market regime + token conviction (contrarian)
    const { regime, convictionSignals } = await analyzeConviction();

    // Step 4: Manage open positions — cap losses, let winners run
    await manageOpenPositions();

    // Step 4b: Harvest mature positions to BNB if balance is low (self-funding)
    await harvestForBnb();

    // Step 5: Create entry proposals from conviction signals
    const proposals = await createTradeProposals();

    // If no proposals, still run guardrails/anchor for the conviction record
    if (proposals.length === 0) {
      console.log("\n  No qualifying entry proposals this cycle.");
    }

    // Step 6: Check risk guardrails
    const passed = proposals.length > 0
      ? (await checkTradeGuardrails(proposals)).passed
      : [];

    // Step 7: Execute entries that passed guardrails
    if (passed.length > 0) {
      await executeTrades(passed);
    } else if (proposals.length > 0) {
      console.log("\n[7/8] No trades passed guardrails. Skipping execution.");
    } else {
      console.log("\n[7/8] No entries to execute.");
    }

    // Step 8: Anchor conviction record to Mantle
    await anchorToMantle();

    // Step 8b: Generate market narrative from SoSoValue feeds + macro events
    await generateAndStoreNarrative();

    state.status = "idle";
    state.nextRunAt = Date.now() + AGENT_CONFIG.trading.loopIntervalMinutes * 60 * 1000;

    // Refresh portfolio snapshot AFTER all trades have settled, then update
    // peak. The cycle's state.portfolio is from step 1 (pre-trade) and would
    // otherwise register as a phantom drawdown when capital is deployed into
    // new positions.
    try {
      const postCyclePortfolio = await twakExecutor.getPortfolio();
      state.portfolio = postCyclePortfolio;
      // Value held BEP-20s on-chain (contract-priced) so peak/drawdown track
      // REAL portfolio value, not just the native BNB + USDC TWAK reports.
      await augmentPortfolioOnchain();
      guardrails.updatePeakValue(state.portfolio.totalValueUsd);
    } catch (err) {
      // If the refresh fails, fall back to the cached value rather than
      // throw — anchoring already succeeded, this is housekeeping.
      console.warn(`  [peak-refresh] Post-cycle portfolio refresh failed:`, summarizeError(err));
      if (state.portfolio) {
        guardrails.updatePeakValue(state.portfolio.totalValueUsd);
      }
    }

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
    }).catch(() => {});
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
    anchoring: state.anchoring,
    anchorResults: state.anchorResults,
    marketRegime: state.marketRegime,
    convictionSignals: state.convictionSignals,
    heldPositions: state.heldPositions,
    positionVerdicts: state.positionVerdicts,
    narrative: state.narrative,
    macroPause: state.macroPause,
    portfolio: state.portfolio,
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
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
