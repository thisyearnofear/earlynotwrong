/**
 * Options Domain Cycle Runner
 *
 * The 8-step autonomous trading pipeline for the options domain.
 * Uses the harness adapter interfaces (DataSource, ConvictionFactors, TradeExecutor)
 * so the loop is domain-agnostic — only the adapter implementations change.
 *
 * Steps:
 *   1. Fetch portfolio      — via TradeExecutor.fetchAlpacaPortfolio()
 *   2. Fetch market data    — via DataSource.fetchSignals() + fetchHistorical()
 *   3. Score conviction     — via ConvictionFactors.score()
 *   4. Manage positions     — P&L + conviction decay → exits
 *   5. Create proposals     — top K by conviction, filtered by risk
 *   6. Check guardrails     — via TradeExecutor.manageRisk()
 *   7. Execute trades       — via TradeExecutor.placeOrder()
 *   8. Self-analysis        — ledger + calibration (domain-agnostic)
 *
 * Runs in parallel with the crypto agent on a separate state container
 * (options-state.ts). Both share: loop, LLM ladder, jury, verification,
 * self-analysis (ledger-based), and anchoring.
 */

import { resolveAdapters } from "./adapters/index.js";
import { getMarketHours } from "./adapters/alpaca-data.js";
import type { AdapterBundle } from "./adapters/index.js";
import type { HarnessConfig } from "./harness-config.js";
import { optionsState } from "./options-state.js";
import type { OptionsPosition, OptionsSignal } from "./options-state.js";
import { AGENT_CONFIG } from "./config.js";
import { anchorAll } from "./anchors/index.js";
import { state } from "./agent-state.js";
import { analyzeAgentBehavior } from "./self-analysis.js";
import type { LedgerEntry } from "conviction-core";
import type { ConvictionRecord } from "./anchors/types.js";
import { persistState } from "./persistence.js";
import { sendEntryAlert, sendExitAlert, sendErrorAlert } from "./telegram.js";
import { summarizeError } from "./errors.js";
import { computeThesisHash, computeSubjectHash } from "./anchors/hashes.js";

// =============================================================================
// Constants
// =============================================================================

const MIN_TRADE_SIZE_USD = 50;
const STUCK_AFTER_FAILED_ATTEMPTS = 3;
const MAX_CONVICTION_DROP_FOR_HOLD = 25; // % drop in conviction → EXIT
const MAX_HOLD_CYCLES = 60; // hard stop after 60 cycles

// =============================================================================
// Step 1: Fetch Portfolio
// =============================================================================

async function fetchPortfolio(
  bundle: AdapterBundle,
): Promise<void> {
  console.log("\n[1/8] Fetching portfolio...");

  try {
    // Try the executor's portfolio fetch method (Alpaca's built-in).
    if ("fetchAlpacaPortfolio" in bundle.executor &&
        typeof (bundle.executor as any).fetchAlpacaPortfolio === "function") {
      const fetchFn = (bundle.executor as any).fetchAlpacaPortfolio as () => Promise<any>;
      optionsState.portfolio = await fetchFn();
    } else {
      // Fallback: if fetchAlpacaPortfolio isn't attached, use the executor
      // interface directly (some executors may not expose it).
      optionsState.portfolio = {
        totalValueUsd: 0,
        cashUsd: 0,
        positions: [],
      };
    }

    // Safe null checks on the portfolio.
    const portfolio = optionsState.portfolio!;
    console.log(
      `  Portfolio: $${portfolio.totalValueUsd.toFixed(2)} ` +
      `across ${portfolio.positions.length} positions, ` +
      `$${portfolio.cashUsd.toFixed(2)} cash`,
    );

    // Adopt open broker positions after a restart. `heldPositions` is
    // in-memory (not persisted across pm2 restarts), so on a fresh boot it
    // starts empty while Alpaca still holds open contracts. The broker is
    // the source of truth — adopt them so exits/P&L tracking resume. This is
    // the options analog of the crypto "reconcileWithChain" lesson.
    if (optionsState.heldPositions.length === 0 && portfolio.positions.length > 0) {
      const adopted: OptionsPosition[] = [];
      for (const p of portfolio.positions) {
        const meta = p.metadata ?? {};
        // Only adopt option contracts (OSI symbols parse into metadata).
        const contractType = meta.contractType as "call" | "put" | undefined;
        if (!contractType) {
          console.log(`  [adopt] Skipping non-option position ${p.symbol}`);
          continue;
        }
        adopted.push({
          symbol: p.symbol,
          contractId: p.positionId ?? p.symbol,
          underlyingSymbol: (meta.underlyingSymbol as string) ?? p.symbol.match(/^[A-Z]+/)?.[0] ?? p.symbol,
          contractType,
          strike: (meta.strike as number) ?? 0,
          expiry: (meta.expiry as string) ?? "",
          entryPrice: p.avgEntryPrice,
          avgEntryPrice: p.avgEntryPrice,
          quantity: p.quantity,
          multiplier: (meta.multiplier as number) ?? 100,
          entryCycle: optionsState.cycle,
          entryConviction: 50, // unknown on adoption — neutral baseline
          unrealizedPnlUsd: p.unrealizedPnlUsd,
          unrealizedPnlPercent: p.unrealizedPnlPercent,
          stuck: false,
          failedExitAttempts: 0,
        });
      }
      if (adopted.length > 0) {
        optionsState.heldPositions = adopted;
        console.log(`  Adopted ${adopted.length} open broker position(s) into tracking`);
      }
    }
  } catch (err) {
    console.error(`  [portfolio] Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    optionsState.portfolio = {
      totalValueUsd: 0,
      cashUsd: 0,
      positions: [],
    };
  }
}

// =============================================================================
// Step 2: Fetch Market Data + Historical
// =============================================================================

async function fetchMarketData(bundle: AdapterBundle): Promise<void> {
  console.log("\n[2/8] Fetching market data...");

  const underliers =
    AGENT_CONFIG.harness.optionsUnderliers;

  try {
    const signals = await bundle.dataSource.fetchSignals({
      symbols: underliers,
      limit: 200,
      minLiquidityUsd: 10000, // $10k min liquidity filter
    });

    console.log(`  Fetched ${signals.length} option contracts across ${underliers.length} underliers`);

    // Fetch historical klines for each underlier (needed for RSI in conviction scoring).
    const uniqueUnderliers = new Set(underliers);
    const klineBySymbol = new Map<string, import("./adapters/types.js").Kline[]>();

    for (const symbol of uniqueUnderliers) {
      try {
        const klines = await bundle.dataSource.fetchHistorical(symbol, 30);
        klineBySymbol.set(symbol, klines);
      } catch {
        // Non-fatal: klines will be empty, conviction uses fallback values.
      }
    }

    // Build conviction signals from market signals + klines.
    const convictionSignals: OptionsSignal[] = [];
    for (const signal of signals) {
      const underlier = signal.metadata?.underlyingSymbol as string | undefined;
      const klines = underlier ? (klineBySymbol.get(underlier) ?? []) : [];
      convictionSignals.push({ signal, conviction: {} as import("./adapters/types.js").ConvictionResult, klines });
    }

    optionsState.convictionSignals = convictionSignals;
    console.log(`  Conviction signals ready: ${convictionSignals.length}`);
  } catch (err) {
    console.error(`  [market-data] Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    optionsState.convictionSignals = [];
  }
}

// =============================================================================
// Step 3: Score Conviction
// =============================================================================

async function scoreConviction(bundle: AdapterBundle): Promise<void> {
  console.log("\n[3/8] Scoring conviction...");

  const scored: OptionsSignal[] = [];

  for (const { signal, klines } of optionsState.convictionSignals) {
    try {
      const result = await bundle.convictionFactors.score(signal, klines);
      scored.push({ signal, conviction: result, klines });
    } catch (err) {
      console.error(`  [conviction] Failed to score ${signal.symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Sort by conviction score descending.
  scored.sort((a, b) => b.conviction.score - a.conviction.score);

  // Re-assign to state after scoring.
  optionsState.convictionSignals = scored;

  // Log top 5.
  const top5 = scored.slice(0, 5);
  if (top5.length > 0) {
    console.log(
      `  Top conviction: ${top5.map(s => `${s.signal.symbol} ${s.conviction.score}/100`).join(", ")}`,
    );
  } else {
    console.log("  No signals scored this cycle.");
  }
}

// =============================================================================
// Step 4: Manage Open Positions
// =============================================================================

async function managePositions(
  bundle: AdapterBundle,
): Promise<void> {
  console.log("\n[4/8] Managing open positions...");

  if (optionsState.heldPositions.length === 0) {
    console.log("  No open positions.");
    return;
  }

  const toClose: OptionsPosition[] = [];
  const remaining: OptionsPosition[] = [];

  for (const pos of optionsState.heldPositions) {
    // Find the matching signal in current scores.
    const currentScore = optionsState.convictionSignals
      .find(s => s.signal.symbol === pos.symbol)?.conviction.score ?? 0;

    // Re-fetch the current market signal for P&L calculation.
    let currentPrice = 0;
    const matchingSignal = optionsState.convictionSignals
      .find(s => s.signal.symbol === pos.symbol);
    if (matchingSignal) {
      currentPrice = matchingSignal.signal.price;
    }

    // Skip if we can't determine price (stale data).
    if (currentPrice <= 0) {
      remaining.push(pos);
      continue;
    }

    // Recalculate P&L (options: cost = price × quantity × 100-share multiplier).
    const multiplier = pos.multiplier || 100;
    const marketValue = pos.quantity * currentPrice * multiplier;
    const costBasis = pos.quantity * pos.avgEntryPrice * multiplier;
    const unrealizedPnl = marketValue - costBasis;
    const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

    // Hard stop: max hold cycles.
    if (pos.entryCycle + MAX_HOLD_CYCLES <= optionsState.cycle) {
      console.log(`  EXPIRED ${pos.symbol}: held ${optionsState.cycle - pos.entryCycle} cycles (max ${MAX_HOLD_CYCLES})`);
      toClose.push(pos);
      continue;
    }

    // Conviction decay: if current conviction dropped significantly below entry, exit.
    const entryConviction = pos.entryConviction ?? 50;
    const convictionDrop = entryConviction - currentScore;
    if (convictionDrop >= MAX_CONVICTION_DROP_FOR_HOLD) {
      console.log(`  CONVICTION_DECAY ${pos.symbol}: ${entryConviction} → ${currentScore} (drop: ${convictionDrop})`);
      toClose.push(pos);
      continue;
    }

    // Mark stuck positions.
    if (pos.stuck || pos.failedExitAttempts >= STUCK_AFTER_FAILED_ATTEMPTS) {
      remaining.push({ ...pos, stuck: true });
      continue;
    }

    remaining.push({
      ...pos,
      unrealizedPnlUsd: unrealizedPnl,
      unrealizedPnlPercent,
    });
  }

  optionsState.heldPositions = remaining;
  console.log(`  Closed ${toClose.length} positions, ${remaining.length} remaining`);

  // Execute closes.
  for (const pos of toClose) {
    const closeResult = await bundle.executor.closePosition(
      pos.symbol,
      pos.contractId || pos.symbol,
    );

    if (closeResult.success) {
      // Record exit in ledger (LedgerEntry has no convictionScore field).
      const multiplier = pos.multiplier || 100;
      const exitPrice = closeResult.executedPrice ?? pos.avgEntryPrice;
      const exitValueUsd = pos.quantity * exitPrice * multiplier;
      const exitEntry: LedgerEntry = {
        hash: `exit:${pos.symbol}:${closeResult.timestamp}`,
        timestamp: closeResult.timestamp,
        tokenAddress: pos.symbol.toLowerCase(),
        tokenSymbol: pos.symbol,
        type: "sell",
        amount: pos.quantity,
        priceUsd: exitPrice,
        valueUsd: exitValueUsd,
      };
      optionsState.ledger.push(exitEntry);

      const pnl = (exitPrice - pos.avgEntryPrice) * pos.quantity * multiplier;
      optionsState.realizedPnlUsd += pnl;
      optionsState.totalTrades += 1;
      optionsState.totalVolumeUsd += exitValueUsd;
      optionsState.tradeStats.exitsCount += 1;

      if (pnl > 0) {
        optionsState.tradeStats.winningExitsCount += 1;
        optionsState.tradeStats.totalWinsUsd += pnl;
        optionsState.tradeStats.largestWinUsd = Math.max(optionsState.tradeStats.largestWinUsd, pnl);
      } else if (pnl < 0) {
        optionsState.tradeStats.losingExitsCount += 1;
        optionsState.tradeStats.totalLossesUsd += Math.abs(pnl);
        optionsState.tradeStats.largestLossUsd = Math.max(optionsState.tradeStats.largestLossUsd, Math.abs(pnl));
      }

      console.log(`  ✓ Closed ${pos.symbol}: P&L $${pnl.toFixed(2)} (tx: ${closeResult.orderId || "N/A"})`);

      // Use EXIT_STOP as action since EXIT_DECAY is not a valid enum value.
      sendExitAlert({
        cycle: optionsState.cycle,
        symbol: pos.symbol,
        action: "EXIT_STOP",
        reason: "Conviction decay",
        pnlPercent: pos.avgEntryPrice > 0 ? (pnl / (pos.quantity * pos.avgEntryPrice)) * 100 : 0,
        amountUsd: pos.quantity * pos.avgEntryPrice,
        sellFraction: 1,
        txHash: closeResult.orderId,
      }).catch(() => {});
    } else {
      pos.failedExitAttempts += 1;
      console.log(`  ✗ Close failed for ${pos.symbol}: ${closeResult.error}`);
    }
  }
}

// =============================================================================
// Step 5: Create Trade Proposals
// =============================================================================

async function createProposals(
  bundle: AdapterBundle,
): Promise<Array<OptionsSignal>> {
  console.log("\n[5/8] Creating trade proposals...");

  const portfolio = optionsState.portfolio;
  if (!portfolio || portfolio.totalValueUsd <= 0) {
    console.log("  No portfolio data — skipping entries (fail closed).");
    return [];
  }

  // Cap: no new entries if we're at max positions.
  const maxPositions = 10;
  const activePositions = optionsState.heldPositions.filter(p => !p.stuck).length;
  if (activePositions >= maxPositions) {
    console.log(`  Position cap reached (${activePositions}/${maxPositions}). Skipping new entries.`);
    return [];
  }

  // Top signals by conviction score.
  const minConviction = 40;
  // Fail-closed on the core signal: the whole edge is "premium priced
  // relative to realized vol" — a contract with no usable IV (a gap/stale
  // quote where the BS solver returned ~0) has no measurable edge and must
  // not be entry-eligible, even if the overlay factors sum past the
  // threshold. This is the no-fabricated-data rule applied to IV.
  const topSignals = optionsState.convictionSignals.filter(s => {
    const iv = (s.signal.metadata?.impliedVolatility as number) ?? 0;
    if (iv < 0.05) return false; // degenerate/stale IV → not tradable
    return s.conviction.score >= minConviction;
  }).slice(0, 5);

  if (topSignals.length === 0) {
    console.log(`  No signals meet minimum conviction (${minConviction}) AND usable IV. Skipping entries.`);
    return [];
  }

  console.log(`  ${topSignals.length} signals above conviction threshold (${minConviction}) with usable IV`);
  return topSignals;
}

// =============================================================================
// Step 6 & 7: Risk Check + Execute
// =============================================================================

async function executeProposals(
  bundle: AdapterBundle,
  proposals: Array<OptionsSignal>,
): Promise<void> {
  if (proposals.length === 0) {
    console.log("\n[6-7/8] No proposals to execute.");
    return;
  }

  const portfolio = optionsState.portfolio!;
  const maxPerTrade = Math.min(500, portfolio.totalValueUsd * 0.1); // max 10% of portfolio per trade, $500 cap

  // Market-hours gate (execution only): options market orders are rejected by
  // Alpaca outside regular hours (422 "only allowed during market hours").
  // We still analyze + score + propose every cycle so the dashboard stays
  // live, but defer placing orders until the market reopens. This is the
  // fail-closed behaviour from the hackathon strategy — no churn, no dead
  // rejections — rather than firing orders into a closed market.
  const marketHours = await getMarketHours();
  if (!marketHours.isOpen) {
    console.log(`\n[6-7/8] Market closed — deferring ${proposals.length} proposal(s) until next open${marketHours.nextOpen ? ` (${marketHours.nextOpen})` : ""}.`);
    return;
  }

  console.log(`\n[6-7/8] Executing ${proposals.length} proposals (max $${maxPerTrade.toFixed(2)}/trade)...`);

  for (const proposal of proposals) {
    const riskCheck = bundle.executor.manageRisk(
      { signal: proposal.signal, conviction: proposal.conviction } as import("./adapters/types.js").SignalWithScore,
      portfolio,
    );

    if (!riskCheck.approved) {
      console.log(`  BLOCKED ${proposal.signal.symbol}: ${riskCheck.reason}`);
      continue;
    }

    const sizeUsd = Math.min(
      maxPerTrade,
      portfolio.totalValueUsd > 0
        ? (riskCheck.maxPositionUsd ?? maxPerTrade)
        : maxPerTrade,
    );
    // Options are priced per-share; each contract covers `multiplier` (100) shares.
    // Position cost = price × multiplier × qty, so quantity accounts for the multiplier.
    const multiplier = (proposal.signal.metadata?.multiplier as number) ?? 100;
    const contractCost = (proposal.signal.price || 1) * multiplier;
    const quantity = Math.max(1, Math.floor(sizeUsd / contractCost));

    const positionConfig: import("./adapters/types.js").PositionConfig = {
      sizeUsd: quantity * contractCost, // actual dollar amount committed
      side: "long", // buy-to-open (long premium); the conviction direction is "long call"/"long put"
      orderType: "market",
      metadata: {
        ...proposal.signal.metadata,
        quantity,
      } as Record<string, unknown>,
    };

    const tradeResult = await bundle.executor.placeOrder(
      { signal: proposal.signal, conviction: proposal.conviction } as import("./adapters/types.js").SignalWithScore,
      positionConfig,
    );

    if (tradeResult.success) {
      // Record in ledger — LedgerEntry has no convictionScore field,
      // so we store conviction separately on the position object.
      const multiplier = (proposal.signal.metadata?.multiplier as number) ?? 100;
      const entryPrice = tradeResult.executedPrice ?? proposal.signal.price;
      const entryQty = tradeResult.executedQuantity ?? quantity;
      const entryValueUsd = entryPrice * entryQty * multiplier;
      const entryEntry: LedgerEntry = {
        hash: `entry:${proposal.signal.symbol}:${tradeResult.timestamp}`,
        timestamp: tradeResult.timestamp,
        tokenAddress: proposal.signal.symbol.toLowerCase(),
        tokenSymbol: proposal.signal.symbol,
        type: "buy",
        amount: entryQty,
        priceUsd: entryPrice,
        valueUsd: entryValueUsd,
      };
      optionsState.ledger.push(entryEntry);

      // Track position.
      const newState: OptionsPosition = {
        symbol: proposal.signal.symbol,
        contractId: tradeResult.orderId ?? proposal.signal.symbol,
        underlyingSymbol: (proposal.signal.metadata?.underlyingSymbol as string) ?? proposal.signal.symbol,
        contractType: (proposal.signal.metadata?.contractType as "call" | "put") ?? "call",
        strike: (proposal.signal.metadata?.strike as number) ?? 0,
        expiry: (proposal.signal.metadata?.expiry as string) ?? "",
        entryPrice: proposal.signal.price,
        avgEntryPrice: entryPrice,
        quantity: entryQty,
        multiplier,
        entryCycle: optionsState.cycle,
        entryConviction: proposal.conviction.score,
        unrealizedPnlUsd: 0,
        unrealizedPnlPercent: 0,
        stuck: false,
        failedExitAttempts: 0,
      };
      optionsState.heldPositions.push(newState);

      optionsState.totalTrades += 1;
      optionsState.totalVolumeUsd += entryValueUsd;
      optionsState.tradeStats.entriesCount += 1;

      console.log(`  ✓ ${proposal.signal.symbol}: ${quantity} contracts @ $${(tradeResult.executedPrice ?? proposal.signal.price).toFixed(4)}`);

      // sendEntryAlert expects: cycle, symbol, amountUsd, convictionScore, rationale, txHash?
      sendEntryAlert({
        cycle: optionsState.cycle,
        symbol: proposal.signal.symbol,
        amountUsd: tradeResult.executedValueUsd ?? entryValueUsd,
        convictionScore: proposal.conviction.score,
        rationale: proposal.conviction.rationale,
        txHash: tradeResult.orderId,
      }).catch(() => {});
    } else {
      console.log(`  ✗ ${proposal.signal.symbol}: ${tradeResult.error}`);
      optionsState.errors.push(`${proposal.signal.symbol}: ${tradeResult.error}`);
    }
  }
}

// =============================================================================
// Step 8: Self-Analysis + Anchoring
// =============================================================================

async function selfAnalyzeAndAnchor(): Promise<void> {
  console.log("\n[8/8] Self-analysis + anchoring...");

  // Self-analysis uses conviction-core's calculateBehavioralMetrics.
  // Domain-agnostic — works on any ledger. The self-analysis module reads
  // from the shared `state.ledger` which both crypto and options cycles
  // append to. This means behavioral metrics are cumulative across domains.
  const behavior = analyzeAgentBehavior();
  if (behavior) {
    console.log(`  Behavioral conviction: ${behavior.score} (${behavior.archetype})`);
  } else {
    console.log("  Insufficient closed positions for behavioral analysis.");
  }

  // Thesis anchoring — domain-agnostic. Builds a ConvictionRecord and calls
  // anchorAll which sends it to all configured chains (Mantle + Casper).
  try {
    // Compute a mean conviction score across signals for the record.
    const meanScore = optionsState.convictionSignals.length > 0
      ? Math.round(
          optionsState.convictionSignals
            .reduce((sum, s) => sum + s.conviction.score, 0) /
            optionsState.convictionSignals.length,
        )
      : 0;

    const record: ConvictionRecord = {
      subjectHash: computeSubjectHash("options", "harness"),
      thesisHash: computeThesisHash({
        cycle: optionsState.cycle,
        domain: "options",
        signals: optionsState.convictionSignals.length,
        meanScore: meanScore,
      }),
      convictionScore: meanScore,
      archetype: "ALPHA OPTIONS",
      timestamp: Date.now(),
    };

    const anchorResults = await anchorAll(record);

    if (anchorResults && anchorResults.length > 0) {
      const successful = anchorResults.filter(r => r.status === "success");
      const skipped = anchorResults.filter(r => r.status === "skipped");
      console.log(`  Anchored: ${successful.length} success, ${skipped.length} skipped`);
      optionsState.anchorResults = anchorResults;
    }
  } catch (err) {
    console.log(`  [anchor] Skipped: ${err instanceof Error ? err.message : String(err)}`);
    optionsState.anchorResults = [];
  }
}

// =============================================================================
// Options Cycle Pipeline
// =============================================================================

/**
 * Run a full options domain cycle using the harness adapters.
 *
 * This is the options-domain equivalent of the crypto `runCycle()` in
 * index.ts. It uses the same 8-step structure but adapts each step for
 * options contracts (IV scoring, Alpaca execution, etc.).
 */
export async function runOptionsCycle(harnessConfig: HarnessConfig): Promise<void> {
  console.log(`\n╔═══════════════════════════════════════╗`);
  console.log(`║  OPTIONS CYCLE #${String(optionsState.cycle + 1).padStart(2)} — ${new Date().toISOString()}  ║`);
  console.log(`╚═══════════════════════════════════════╝`);

  optionsState.cycle += 1;
  optionsState.status = "running";
  optionsState.lastRunAt = Date.now();

  const cycleStart = Date.now();

  // Resolve adapters (should already be resolved at startup, but re-check).
  let bundle: AdapterBundle;
  try {
    bundle = resolveAdapters(harnessConfig);
  } catch (err) {
    console.error(`  [options-cycle] Failed to resolve adapters: ${err instanceof Error ? err.message : String(err)}`);
    optionsState.status = "error";
    return;
  }

  try {
    await fetchPortfolio(bundle);
    await fetchMarketData(bundle);
    await scoreConviction(bundle);
    await managePositions(bundle);
    const proposals = await createProposals(bundle);
    await executeProposals(bundle, proposals);
    await selfAnalyzeAndAnchor();

    const durationMs = Date.now() - cycleStart;
    const activePositions = optionsState.heldPositions.filter(p => !p.stuck).length;

    // Update observability snapshot — match CycleObservabilitySnapshot shape.
    optionsState.lastCycleObservability = {
      cycle: optionsState.cycle,
      completedAt: Date.now(),
      durationMs,
      traceId: null, // TODO: add tracing
      spanId: null,
      otelEnabled: false, // TODO: add OpenTelemetry
      portfolioUsd: optionsState.portfolio?.totalValueUsd ?? 0,
      drawdownPercent: 0, // TODO: compute from peak value
      activePositions,
      regimeScore: optionsState.regimeScore,
      tradesSucceeded: optionsState.executedTrades.filter(t => t.success).length,
      tradesFailed: optionsState.executedTrades.filter(t => !t.success).length,
      guardrailsRejected: 0,
      anchorOutcomes: (optionsState.anchorResults ?? []).map(r => ({
        adapter: "options-harness",
        status: r.status,
      })),
      pipelineSteps: [], // TODO: add pipeline timing
    };

    // Persist cycle history.
    optionsState.cycleHistory.push({
      cycle: optionsState.cycle,
      timestamp: Date.now(),
      durationMs,
      tradesExecuted: optionsState.executedTrades.filter(t => t.success).length,
      portfolioValueUsd: optionsState.portfolio?.totalValueUsd ?? 0,
      drawdownPercent: 0,
      regimeScore: optionsState.regimeScore,
    });
    // Keep last 20 entries.
    if (optionsState.cycleHistory.length > 20) {
      optionsState.cycleHistory = optionsState.cycleHistory.slice(-20);
    }

    // Persist state to disk. Only use fields compatible with
    // `AgentServerState`. Options positions have a different shape than
    // crypto HeldPosition, so we only persist the domain-agnostic ledger.
    try {
      await persistState({
        agentState: {
          cycle: optionsState.cycle,
          status: optionsState.status,
          lastRunAt: optionsState.lastRunAt,
          nextRunAt: optionsState.nextRunAt,
          totalTrades: optionsState.totalTrades,
          totalVolumeUsd: optionsState.totalVolumeUsd,
          totalGasSpentUsd: optionsState.totalGasSpentUsd,
          realizedPnlUsd: optionsState.realizedPnlUsd,
          errors: optionsState.errors,
          ledger: optionsState.ledger,
          lastCycleObservability: optionsState.lastCycleObservability,
        },
        guardrails: {
          peakValueUsd: 0,
          totalTradesExecuted: optionsState.totalTrades,
          totalVolumeUsd: optionsState.totalVolumeUsd,
          lastTradeAt: optionsState.lastRunAt,
        },
        configHash: "options-harness",
      }).catch(() => {});
    } catch {
      // Non-fatal.
    }

    optionsState.status = "idle";
    const intervalMs = AGENT_CONFIG.harness.optionsIntervalMinutes
      ? AGENT_CONFIG.harness.optionsIntervalMinutes * 60 * 1000
      : 60 * 60 * 1000; // default 1h
    optionsState.nextRunAt = Date.now() + intervalMs;

    console.log(`  Cycle #${optionsState.cycle} complete in ${durationMs / 1000}s`);
  } catch (err) {
    optionsState.status = "error";
    const summary = summarizeError(err);
    optionsState.errors.push(summary);
    console.error(`  ✗ Options cycle failed: ${summary}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  }
}
