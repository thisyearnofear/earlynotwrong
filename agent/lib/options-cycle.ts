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
import { HARNESS_CONFIG } from "./harness-config.js";
import { optionsState } from "./options-state.js";
import type { OptionsPosition, OptionsSignal } from "./options-state.js";
import { AGENT_CONFIG } from "./config.js";
import { anchorAll } from "./anchors/index.js";
import { state } from "./agent-state.js";
import { analyzeAgentBehavior } from "./self-analysis.js";
import type { LedgerEntry } from "conviction-core";
import type { ConvictionRecord } from "./anchors/types.js";
import { persistState } from "./persistence.js";
import { sendEntryAlert, sendExitAlert } from "./telegram.js";
import { summarizeError } from "./errors.js";
import { computeThesisHash, computeSubjectHash } from "./anchors/hashes.js";
import {
  OPTIONS_POLICY,
  computeRsi,
  evaluateEntry,
  planExits,
  sizeContracts,
  snapshotFromPosition,
} from "./options-policy.js";

// =============================================================================
// Constants
// =============================================================================

const STUCK_AFTER_FAILED_ATTEMPTS = 3;

function brokerToHeld(
  p: import("./adapters/types.js").AdapterPosition,
  now: number,
): OptionsPosition | null {
  const meta = p.metadata ?? {};
  const contractType = meta.contractType as "call" | "put" | undefined;
  if (!contractType) return null;
  return {
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
    enteredAt: now,
    entryConviction: 50,
    unrealizedPnlUsd: p.unrealizedPnlUsd,
    unrealizedPnlPercent: p.unrealizedPnlPercent,
    peakUnrealizedPercent: p.unrealizedPnlPercent,
    stuck: false,
    failedExitAttempts: 0,
  };
}

function reconcileHeldWithBroker(
  brokerPositions: import("./adapters/types.js").AdapterPosition[],
): void {
  const now = Date.now();
  const bySymbol = new Map(optionsState.heldPositions.map((p) => [p.symbol, p]));
  const next: OptionsPosition[] = [];
  let adopted = 0;

  for (const bp of brokerPositions) {
    const existing = bySymbol.get(bp.symbol);
    if (existing) {
      existing.quantity = bp.quantity;
      existing.avgEntryPrice = bp.avgEntryPrice;
      existing.unrealizedPnlUsd = bp.unrealizedPnlUsd;
      existing.unrealizedPnlPercent = bp.unrealizedPnlPercent;
      existing.peakUnrealizedPercent = Math.max(
        existing.peakUnrealizedPercent ?? 0,
        bp.unrealizedPnlPercent,
      );
      if (!existing.enteredAt) existing.enteredAt = now;
      next.push(existing);
      bySymbol.delete(bp.symbol);
    } else {
      const adoptedPos = brokerToHeld(bp, now);
      if (!adoptedPos) {
        console.log(`  [adopt] Skipping non-option position ${bp.symbol}`);
        continue;
      }
      next.push(adoptedPos);
      adopted += 1;
    }
  }

  const dropped = [...bySymbol.keys()];
  optionsState.heldPositions = next;
  if (adopted > 0) {
    console.log(`  Adopted ${adopted} open broker position(s) into tracking`);
  }
  if (dropped.length > 0) {
    console.log(`  Dropped ${dropped.length} ghost(s) no longer on the broker: ${dropped.join(", ")}`);
  }
}

function rsiForUnderlier(underlier: string): number | null {
  const match = optionsState.convictionSignals.find(
    (s) => (s.signal.metadata?.underlyingSymbol as string) === underlier,
  );
  if (!match || match.klines.length === 0) return null;
  return computeRsi(match.klines.map((k) => k.close));
}

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

    // Broker is the source of truth every cycle (not only on empty memory).
    // Adopt missing contracts, refresh marks/qty, drop ghosts. Same lesson
    // as crypto reconcileWithChain — a bounce must not orphan the book.
    reconcileHeldWithBroker(portfolio.positions);
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
    optionsState.positionVerdicts = [];
    return;
  }

  const now = Date.now();
  const brokerBySymbol = new Map(
    (optionsState.portfolio?.positions ?? []).map((p) => [p.symbol, p]),
  );

  const snapshots = optionsState.heldPositions.map((pos) => {
    const scored = optionsState.convictionSignals.find((s) => s.signal.symbol === pos.symbol);
    const broker = brokerBySymbol.get(pos.symbol);
    const currentPrice =
      (broker?.currentPrice && broker.currentPrice > 0 ? broker.currentPrice : 0) ||
      scored?.signal.price ||
      pos.avgEntryPrice;
    const bid = (scored?.signal.metadata?.bid as number | undefined) ??
      (currentPrice <= OPTIONS_POLICY.deadPrice ? 0 : undefined);
    return snapshotFromPosition(pos, {
      currentPrice,
      bid,
      currentConviction: scored?.conviction.score ?? 0,
      rsi: rsiForUnderlier(pos.underlyingSymbol),
      delta: (scored?.signal.metadata?.delta as number) ?? 0,
      now,
    });
  });

  const plans = planExits(snapshots);
  optionsState.positionVerdicts = plans.map((p) => ({
    action: p.action === "HOLD" ? "HOLD" : p.reason,
    reason: p.detail,
    symbol: p.symbol,
  }));

  for (const plan of plans) {
    const tag = plan.action === "HOLD" ? "HOLD" : plan.reason;
    console.log(`  ${tag} ${plan.symbol}: ${plan.detail}`);
  }

  const toClose = optionsState.heldPositions.filter((pos) => {
    const plan = plans.find((p) => p.symbol === pos.symbol);
    return plan?.action === "EXIT" && !pos.stuck && pos.failedExitAttempts < STUCK_AFTER_FAILED_ATTEMPTS;
  });

  const remaining = optionsState.heldPositions.filter(
    (pos) => !toClose.some((c) => c.symbol === pos.symbol),
  );

  // Refresh marks on the positions we're keeping.
  for (const pos of remaining) {
    const snap = snapshots.find((s) => s.symbol === pos.symbol);
    if (!snap) continue;
    const multiplier = pos.multiplier || 100;
    pos.unrealizedPnlPercent = snap.unrealizedPnlPercent;
    pos.unrealizedPnlUsd = (snap.currentPrice - pos.avgEntryPrice) * pos.quantity * multiplier;
    pos.peakUnrealizedPercent = snap.peakUnrealizedPercent;
  }

  if (toClose.length === 0) {
    optionsState.heldPositions = remaining;
    console.log(`  Closed 0 positions, ${remaining.length} remaining`);
    return;
  }

  const marketHours = await getMarketHours();
  if (!marketHours.isOpen) {
    optionsState.heldPositions = [...remaining, ...toClose];
    console.log(
      `  Market closed — deferring ${toClose.length} exit(s) until next open` +
        `${marketHours.nextOpen ? ` (${marketHours.nextOpen})` : ""}.`,
    );
    return;
  }

  console.log(`  Closing ${toClose.length} position(s)...`);
  const stillOpen: OptionsPosition[] = [...remaining];

  for (const pos of toClose) {
    const plan = plans.find((p) => p.symbol === pos.symbol);
    const closeResult = await bundle.executor.closePosition(
      pos.symbol,
      pos.contractId || pos.symbol,
    );

    if (closeResult.success) {
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

      console.log(`  ✓ Closed ${pos.symbol} (${plan?.reason ?? "EXIT"}): P&L $${pnl.toFixed(2)} (tx: ${closeResult.orderId || "N/A"})`);

      if (HARNESS_CONFIG.domain !== "options") {
        sendExitAlert({
          cycle: optionsState.cycle,
          symbol: pos.symbol,
          action: "EXIT_STOP",
          reason: plan?.detail ?? "Policy exit",
          pnlPercent: pos.avgEntryPrice > 0 ? (pnl / (pos.quantity * pos.avgEntryPrice * multiplier)) * 100 : 0,
          amountUsd: pos.quantity * pos.avgEntryPrice * multiplier,
          sellFraction: 1,
          txHash: closeResult.orderId,
        }).catch(() => {});
      }
    } else {
      pos.failedExitAttempts += 1;
      if (pos.failedExitAttempts >= STUCK_AFTER_FAILED_ATTEMPTS) pos.stuck = true;
      stillOpen.push(pos);
      console.log(`  ✗ Close failed for ${pos.symbol}: ${closeResult.error}`);
    }
  }

  optionsState.heldPositions = stillOpen;
  console.log(`  Closed ${toClose.length - (stillOpen.length - remaining.length)} positions, ${stillOpen.length} remaining`);
}

// =============================================================================
// Step 5: Create Trade Proposals
// =============================================================================

async function createProposals(
  _bundle: AdapterBundle,
): Promise<Array<OptionsSignal>> {
  console.log("\n[5/8] Creating trade proposals...");

  const portfolio = optionsState.portfolio;
  if (!portfolio || portfolio.totalValueUsd <= 0) {
    console.log("  No portfolio data — skipping entries (fail closed).");
    return [];
  }

  const activePositions = optionsState.heldPositions.filter((p) => !p.stuck).length;
  if (activePositions >= OPTIONS_POLICY.maxPositions) {
    console.log(`  Position cap reached (${activePositions}/${OPTIONS_POLICY.maxPositions}). Skipping new entries.`);
    return [];
  }

  const eligible: OptionsSignal[] = [];
  const usedUnderliers = new Set(
    optionsState.heldPositions.filter((p) => !p.stuck).map((p) => p.underlyingSymbol),
  );

  for (const s of optionsState.convictionSignals) {
    const underlier = (s.signal.metadata?.underlyingSymbol as string) ?? "";
    if (underlier && usedUnderliers.has(underlier)) continue;
    const rsi = rsiForUnderlier(underlier);
    const decision = evaluateEntry({
      signal: s.signal,
      score: s.conviction.score,
      rsi,
      held: optionsState.heldPositions,
    });
    if (!decision.ok) continue;
    eligible.push(s);
    if (underlier) usedUnderliers.add(underlier);
    if (eligible.length >= 3) break;
  }

  if (eligible.length === 0) {
    console.log(
      `  No signals meet the thesis (conviction ≥${OPTIONS_POLICY.minConviction}, living premium, one-per-underlier). Skipping entries.`,
    );
    return [];
  }

  console.log(
    `  ${eligible.length} thesis-eligible signal(s): ${eligible.map((s) => `${s.signal.symbol} ${s.conviction.score}/100`).join(", ")}`,
  );
  return eligible;
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

  console.log(`\n[6-7/8] Executing ${proposals.length} proposals...`);

  for (const proposal of proposals) {
    // Re-check one-thesis in case an earlier fill this cycle took the underlier.
    const recheck = evaluateEntry({
      signal: proposal.signal,
      score: proposal.conviction.score,
      rsi: rsiForUnderlier((proposal.signal.metadata?.underlyingSymbol as string) ?? ""),
      held: optionsState.heldPositions,
    });
    if (!recheck.ok) {
      console.log(`  SKIP ${proposal.signal.symbol}: ${recheck.reason}`);
      continue;
    }

    const riskCheck = bundle.executor.manageRisk(
      { signal: proposal.signal, conviction: proposal.conviction } as import("./adapters/types.js").SignalWithScore,
      portfolio,
    );

    if (!riskCheck.approved) {
      console.log(`  BLOCKED ${proposal.signal.symbol}: ${riskCheck.reason}`);
      continue;
    }

    const sized = sizeContracts({
      price: proposal.signal.price,
      multiplier: (proposal.signal.metadata?.multiplier as number) ?? 100,
      portfolioUsd: portfolio.totalValueUsd,
      cashUsd: portfolio.cashUsd,
    });
    if (!sized.ok) {
      console.log(`  SKIP ${proposal.signal.symbol}: ${sized.reason}`);
      continue;
    }
    const quantity = sized.quantity;
    const multiplier = (proposal.signal.metadata?.multiplier as number) ?? 100;
    const contractCost = (proposal.signal.price || 1) * multiplier;

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
        enteredAt: Date.now(),
        entryConviction: proposal.conviction.score,
        unrealizedPnlUsd: 0,
        unrealizedPnlPercent: 0,
        peakUnrealizedPercent: 0,
        stuck: false,
        failedExitAttempts: 0,
      };
      optionsState.heldPositions.push(newState);

      optionsState.totalTrades += 1;
      optionsState.totalVolumeUsd += entryValueUsd;
      optionsState.tradeStats.entriesCount += 1;

      console.log(`  ✓ ${proposal.signal.symbol}: ${quantity} contracts @ $${(tradeResult.executedPrice ?? proposal.signal.price).toFixed(4)}`);

      // sendEntryAlert expects: cycle, symbol, amountUsd, convictionScore, rationale, txHash?
      // Domain guard: see exit-alert comment above — the options process must
      // not broadcast entry alerts to the crypto Telegram channel.
      if (HARNESS_CONFIG.domain !== "options") {
        sendEntryAlert({
          cycle: optionsState.cycle,
          symbol: proposal.signal.symbol,
          amountUsd: tradeResult.executedValueUsd ?? entryValueUsd,
          convictionScore: proposal.conviction.score,
          rationale: proposal.conviction.rationale,
          txHash: tradeResult.orderId,
        }).catch(() => {});
      }
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
