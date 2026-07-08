/**
 * Cycle Runner — the 8-step autonomous trading pipeline.
 *
 * Extracted from agent/index.ts for modularity. Each function is a pipeline
 * step that reads/writes the shared `state` object from agent-state.ts.
 *
 * The entry point (index.ts) imports these steps and wires them into runCycle().
 */

import { state, GAS_BUFFER_USD, getBnbUsd, computeBankrollCap, buildPriceMap, concentrationRejectionCount, unharvestableTokens, stuckSymbols, tickUnharvestableCooldowns } from "./agent-state.js";
import { AGENT_CONFIG, AGENT_MODE } from "./config.js";
import { cmcClient, sosovalueClient, computeRSI14 } from "./data-providers.js";
import type { TokenQuote } from "./data-providers.js";
import { sodexClient } from "./dex-trading.js";
import { twakExecutor, TwakExecutor } from "./twak-executor.js";
import {
  OnchainPortfolio,
  valueHoldings,
  fetchCoinGeckoPrices,
  fetchDexScreenerPrices,
} from "./onchain-portfolio.js";
import { guardrails } from "./risk-guardrails.js";
import { computeSubjectHash, computeThesisHash, anchorAll } from "./anchors/index.js";
import type { SwapResult } from "./twak-executor.js";
import { scoreMarketRegime, scoreTokenConviction, evaluatePosition, accruePosition, openPosition, STUCK_AFTER_FAILED_ATTEMPTS } from "./conviction-signal.js";
import type { ConvictionSignal, HeldPosition, MarketRegime, PositionVerdict } from "./conviction-signal.js";
import { sendErrorAlert, sendExitAlert, sendGuardrailBlocked } from "./telegram.js";
import { summarizeError } from "./errors.js";
import { loadHolderCache, saveHolderCache, fetchHolderCount, recordHolderCount, computeHolderMetric } from "./holders.js";
import { generateNarrative } from "./market-narrative.js";
import {
  fetchSsiRegimeSignal,
  fetchMacroPauseSignal,
  fetchNewsSentimentSignal,
} from "./sosovalue-signals.js";
import type { MacroPauseSignal } from "./sosovalue-signals.js";

// =============================================================================
// Trade statistics helpers
// =============================================================================

function recordEntryStats(): void {
  state.tradeStats.entriesCount += 1;
}

function recordExitStats(pnlUsd: number): void {
  state.tradeStats.exitsCount += 1;
  if (pnlUsd > 0) {
    state.tradeStats.winningExitsCount += 1;
    state.tradeStats.totalWinsUsd += pnlUsd;
    state.tradeStats.largestWinUsd = Math.max(state.tradeStats.largestWinUsd, pnlUsd);
  } else if (pnlUsd < 0) {
    state.tradeStats.losingExitsCount += 1;
    state.tradeStats.totalLossesUsd += Math.abs(pnlUsd);
    state.tradeStats.largestLossUsd = Math.max(state.tradeStats.largestLossUsd, Math.abs(pnlUsd));
  }
}

// =============================================================================
// Step 2: Fetch Market Data (SoSoValue + CMC composite)
// =============================================================================

export async function fetchMarketData(): Promise<void> {
  console.log("\n[1/6] Fetching market data (SoSoValue + CMC composite)...");

  // SoSoValue token prices are preferred. CMC is always needed for global
  // metrics + derivatives (SoSoValue doesn't provide them), so we fetch those
  // in parallel. CMC's per-token quote pull (a 147-token batch) is deferred —
  // only fetched as a fallback when SoSoValue returns no prices — to avoid
  // spending CMC credits on a redundant pull every cycle.
  const [ssvData, cmcData] = await Promise.all([
    sosovalueClient.fetchMarketData().catch(() => null),
    cmcClient.fetchGlobalData().catch(() => null),
  ]);

  const ssvTokenPrices = ssvData?.tokenPrices ?? [];
  let cmcTokenPrices: TokenQuote[] = [];
  if (ssvTokenPrices.length === 0 && cmcData) {
    cmcTokenPrices = await cmcClient.getEligibleTokenQuotes().catch(() => []);
  }

  // Merge: SoSoValue token prices preferred, CMC fills missing tokens
  let tokenPrices = ssvTokenPrices;
  if (cmcTokenPrices.length > 0) {
    const ssvSymbols = new Set(tokenPrices.map((t) => t.symbol.toUpperCase()));
    for (const cmcToken of cmcTokenPrices) {
      if (!ssvSymbols.has(cmcToken.symbol.toUpperCase())) {
        tokenPrices.push(cmcToken);
      }
    }
  }

  const marketData = {
    globalMetrics: cmcData?.globalMetrics ?? null,
    derivatives: cmcData?.derivatives ?? null,
    tokenPrices,
    tokenHolders: cmcData?.tokenHolders ?? [],
    trendingNarratives: cmcData?.trendingNarratives ?? [],
  };

  // ── Logging ──
  const ssvCount = ssvTokenPrices.length;
  const cmcCount = cmcTokenPrices.length;
  const mergedCount = tokenPrices.length;
  if (ssvCount > 0) {
    console.log(`  Source: SoSoValue (${ssvCount} tokens) + CMC (${cmcCount} tokens) → ${mergedCount} merged`);
  } else {
    console.log(`  Source: CMC Agent Hub (${mergedCount} tokens)`);
    if (ssvData === null) {
      console.log(`  (SoSoValue unavailable — check SOSOVALUE_API_KEY)`);
    }
  }

  if (marketData.globalMetrics) {
    const fgi = marketData.globalMetrics.fearGreedIndex;
    const fgiLabel = fgi <= 25 ? "Extreme Fear" : fgi <= 45 ? "Fear" : fgi <= 55 ? "Neutral" : fgi <= 75 ? "Greed" : "Extreme Greed";
    console.log(`  Fear & Greed: ${fgi}/100 (${fgiLabel})`);
    console.log(`  Total Market Cap: $${(marketData.globalMetrics.totalMarketCapUsd / 1e12).toFixed(2)}T`);
  } else {
    console.log("  Global metrics: unavailable (using defaults)");
  }

  if (marketData.derivatives) {
    console.log(`  BTC Funding Rate: ${(marketData.derivatives.btcFundingRate * 100).toFixed(4)}%`);
    console.log(`  ETH Funding Rate: ${(marketData.derivatives.ethFundingRate * 100).toFixed(4)}%`);
  } else {
    console.log("  Derivatives data: unavailable");
  }

  if (marketData.tokenPrices.length > 0) {
    console.log(`  Token prices: ${marketData.tokenPrices.length} tokens tracked`);
    const topGainers = [...marketData.tokenPrices]
      .sort((a, b) => b.percentChange24h - a.percentChange24h)
      .slice(0, 3);
    const topLosers = [...marketData.tokenPrices]
      .sort((a, b) => a.percentChange24h - b.percentChange24h)
      .slice(0, 3);
    console.log(`  Top gainers: ${topGainers.map(t => `${t.symbol} ${t.percentChange24h > 0 ? "+" : ""}${t.percentChange24h.toFixed(1)}%`).join(", ")}`);
    console.log(`  Top losers:  ${topLosers.map(t => `${t.symbol} ${t.percentChange24h > 0 ? "+" : ""}${t.percentChange24h.toFixed(1)}%`).join(", ")}`);
  }

  if (marketData.trendingNarratives.length > 0) {
    console.log(`  Trending: ${marketData.trendingNarratives.slice(0, 3).map(n => n.name).join(", ")}`);
  }

  state.marketData = marketData;

  TwakExecutor.setReferencePrices(
    marketData.tokenPrices
      .filter((t) => typeof t.price === "number" && t.price > 0)
      .map((t) => [t.symbol, t.price] as [string, number]),
  );
}

// =============================================================================
// Step 3: Score Market Regime + Token Conviction
// =============================================================================

export async function analyzeConviction(): Promise<{
  regime: MarketRegime;
  convictionSignals: ConvictionSignal[];
}> {
  console.log("\n[3/8] Scoring market regime + token conviction (contrarian)...");

  const md = state.marketData;

  // SoSoValue augmentations — SSI index regime confirmation + per-symbol
  // news sentiment. Both degrade silently if SoSoValue is offline.
  // News keyword-extraction needs the eligible-token universe so common
  // 3-letter English words (USD, AND, FOR) can't false-match as tickers.
  const tickerUniverse = new Set(AGENT_CONFIG.competition.eligibleTokens.map((s) => s.toUpperCase()));
  const [ssi, newsSignal] = await Promise.all([
    fetchSsiRegimeSignal(),
    fetchNewsSentimentSignal(tickerUniverse),
  ]);
  const ssiConfirmation = ssi.indicesRead > 0 ? ssi.confirmation : null;

  const regime = scoreMarketRegime(
    md?.globalMetrics ?? null,
    md?.derivatives ?? null,
    ssiConfirmation,
  );
  const ssiNote =
    ssi.indicesRead > 0
      ? ` · SSI ${ssi.avgPercentChange7d >= 0 ? "+" : ""}${ssi.avgPercentChange7d.toFixed(1)}% (${ssi.indicesRead} indices)`
      : "";
  console.log(`  Regime: ${regime.score}/100 — ${regime.label} (FGI=${regime.fearGreedIndex ?? "?"}${ssiNote})`);
  if (newsSignal.totalItems > 0 && newsSignal.perSymbol.size > 0) {
    console.log(`  News sentiment: ${newsSignal.perSymbol.size} symbols covered across ${newsSignal.totalItems} items`);
  }

  const holderCache = loadHolderCache();
  const holderMetrics = new Map<string, { count: number; growthPercent: number | null }>();
  const rsiCache = new Map<string, number>();
  const tokens = md?.tokenPrices ?? [];

  if (process.env.NODEREAL_API_KEY || process.env.COINGECKO_API_KEY) {
    const preScores = tokens.map((t) => ({
      symbol: t.symbol,
      preScore: scoreTokenConviction(t, regime).score,
    }));
    const topCandidates = [...preScores]
      .sort((a, b) => b.preScore - a.preScore)
      .slice(0, 15);

    const resolved = TwakExecutor.getResolvedAddresses();
    const toResolve = topCandidates.filter(
      (c) => !resolved.has(c.symbol.toUpperCase())
    );
    for (const c of toResolve) {
      await twakExecutor.resolveAddress(c.symbol);
    }

    const addresses = TwakExecutor.getResolvedAddresses();
    let fetched = 0;
    for (const c of topCandidates) {
      const addr = addresses.get(c.symbol.toUpperCase());
      if (!addr) continue;
      const count = await fetchHolderCount(addr, c.symbol);
      if (count !== null) {
        recordHolderCount(holderCache, c.symbol, count);
        fetched++;
      }
      if (fetched < toResolve.length) await new Promise((r) => setTimeout(r, 600));
    }
    saveHolderCache(holderCache);
    if (fetched > 0) console.log(`  [holders] Fetched ${fetched} holder counts`);
  }

  // Fetch real RSI(14) from SoSoValue daily klines for the top candidates.
  // We only fetch for tokens that are likely to enter; the rest use the
  // synthesized 7d-return RSI fallback. Skip entirely when no SoSoValue key
  // is configured to avoid hanging the cycle on public-test / CI runs.
  if (process.env.SOSOVALUE_API_KEY) {
    const rsiCandidates = [...tokens]
      .map((t) => ({ symbol: t.symbol, score: scoreTokenConviction(t, regime, holderMetrics.get(t.symbol), newsSignal.perSymbol.get(t.symbol.toUpperCase()) ?? null).score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    let fetchedRsi = 0;
    for (const c of rsiCandidates) {
      try {
        const klines = await sosovalueClient.fetchKlinesBySymbol(c.symbol, "1d", 30);
        if (klines.length >= 15) {
          const rsi = computeRSI14(klines);
          rsiCache.set(c.symbol.toUpperCase(), rsi);
          fetchedRsi++;
        }
      } catch {
        // Non-fatal: fall back to synthesized RSI.
      }
    }
    if (fetchedRsi > 0) console.log(`  [rsi] Fetched real RSI(14) for ${fetchedRsi} top candidates`);
  }

  for (const t of tokens) {
    const metric = computeHolderMetric(holderCache, t.symbol);
    if (metric.count > 0) {
      holderMetrics.set(t.symbol, {
        count: metric.count,
        growthPercent: metric.growthPercent,
      });
    }
  }

  const convictionSignals = tokens.map((t) =>
    scoreTokenConviction(
      t,
      regime,
      holderMetrics.get(t.symbol),
      newsSignal.perSymbol.get(t.symbol.toUpperCase()) ?? null,
      rsiCache.get(t.symbol.toUpperCase()) ?? null,
    )
  );

  const top = [...convictionSignals]
    .sort((a, b) => b.score - a.score)
    .slice(0, AGENT_CONFIG.trading.topK);
  if (top.length > 0) {
    console.log(
      `  Top conviction: ${top.map((s) => `${s.symbol} ${s.score} [${s.rationale}]`).join(" · ")}`
    );
  }

  state.marketRegime = regime;
  state.convictionSignals = convictionSignals;
  state.regimeScore = regime.score;
  state.sentimentLabel = regime.label;

  return { regime, convictionSignals };
}

// =============================================================================
// Augment Portfolio On-Chain
// =============================================================================

export async function augmentPortfolioOnchain(): Promise<void> {
  if (!state.portfolio || state.heldPositions.length === 0) return;
  const wallet = process.env.AGENT_WALLET_KEY || process.env.AGENT_WALLET_ADDRESS;
  if (!wallet) return;

  const cached = TwakExecutor.getResolvedAddresses();
  const addressMap = new Map<string, string>();
  for (const p of state.heldPositions) {
    const sym = p.symbol.toUpperCase();
    let c = cached.get(sym);
    if (!c) c = (await twakExecutor.resolveAddress(p.symbol)) ?? undefined;
    if (c) addressMap.set(sym, c);
  }
  if (addressMap.size === 0) return;

  try {
    const onchain = new OnchainPortfolio();
    const holdings = await onchain.getHoldings(addressMap, wallet);
    if (holdings.length === 0) return;

    const contracts = holdings.map((h) => h.contract);
    const cg = await fetchCoinGeckoPrices(contracts);
    const cgMissing = holdings.filter((h) => !(cg.get(h.contract) ?? 0)).map((h) => h.contract);
    const dex = cgMissing.length ? await fetchDexScreenerPrices(cgMissing) : new Map<string, number>();

    const { positions, totalUsd } = valueHoldings(holdings, new Map(), cg, dex);

    let addedValue = 0;
    let stuckValueExcluded = 0;
    const sources = new Set<string>();
    for (const pos of positions) {
      if (pos.valueUsd <= 0.01) continue;
      if (stuckSymbols.has(pos.symbol)) {
        stuckValueExcluded += pos.valueUsd;
        continue;
      }
      sources.add(pos.priceSource);
      const existing = state.portfolio!.positions.find(
        (p) => p.symbol.toUpperCase() === pos.symbol.toUpperCase()
      );
      if (existing) {
        addedValue += pos.valueUsd - (existing.valueUsd > 0.01 ? existing.valueUsd : 0);
        existing.balance = pos.balance.toString();
        existing.valueUsd = pos.valueUsd;
      } else {
        addedValue += pos.valueUsd;
        state.portfolio!.positions.push({
          token: pos.symbol,
          symbol: pos.symbol,
          balance: pos.balance.toString(),
          valueUsd: pos.valueUsd,
          chain: "bsc",
        });
      }
    }

    const pricedCount = positions.filter((p) => p.valueUsd > 0.01).length;
    if (addedValue !== 0 || stuckValueExcluded > 0) {
      state.portfolio!.totalValueUsd += addedValue;
      const stuckMsg = stuckValueExcluded > 0 ? ` (excluded $${stuckValueExcluded.toFixed(2)} stuck)` : "";
      console.log(
        `  [onchain] Valued ${pricedCount}/${holdings.length} held position(s) = $${totalUsd.toFixed(2)} ` +
        `(${[...sources].join("+") || "none"}); portfolio → $${state.portfolio!.totalValueUsd.toFixed(2)}${stuckMsg}`
      );
    }
  } catch {
    // Non-fatal
  }
}

// =============================================================================
// Step 4: Manage Open Positions
// =============================================================================

export async function manageOpenPositions(): Promise<void> {
  console.log("\n[4/8] Managing open positions (cap losses, let winners run)...");

  if (state.heldPositions.length === 0) {
    console.log("  No open positions.");
    state.positionVerdicts = [];
    return;
  }

  const priceMap = buildPriceMap();
  const verdicts: PositionVerdict[] = [];
  const remaining: HeldPosition[] = [];

  for (let pos of state.heldPositions) {
    const price = priceMap.get(pos.symbol.toUpperCase()) ?? 0;
    pos = accruePosition(pos, price);

    if (price <= 0) {
      remaining.push(pos);
      continue;
    }

    const verdict = evaluatePosition(pos, price);
    verdicts.push(verdict);

    if (verdict.action === "HOLD") {
      console.log(`  HOLD ${pos.symbol}: ${verdict.reason}`);
      remaining.push(pos);
      continue;
    }

    if (verdict.action === "EXIT_PARTIAL") {
      const sellAmount = pos.amountUsd * verdict.sellFraction;
      console.log(`  PARTIAL ${pos.symbol}: ${verdict.reason} (selling $${sellAmount.toFixed(2)})`);
      const partialPos = { ...pos, amountUsd: sellAmount };
      const closed = await closePosition(partialPos, verdict);
      if (closed) {
        pos.partialProfitTaken = true;
        pos.amountUsd -= sellAmount;
        remaining.push(pos);
        console.log(`    ✓ Sold $${sellAmount.toFixed(2)}, keeping $${pos.amountUsd.toFixed(2)} riding`);
      } else {
        console.log(`    ✗ Partial exit failed — keeping full position, will retry next cycle`);
        remaining.push(pos);
      }
      continue;
    }

    console.log(`  ${verdict.action} ${pos.symbol}: ${verdict.reason}`);
    const closed = await closePosition(pos, verdict);
    if (!closed) {
      console.log(`    ✗ Exit failed — keeping position, will retry next cycle`);
      remaining.push(pos);
    }
  }

  state.heldPositions = remaining;
  state.positionVerdicts = verdicts;
}

const MIN_SWAP_USD = 1.0;
const STUCK_SLIPPAGES_BPS = [1000, 2000, 4900]; // 10%, 20%, 49%

async function closePosition(
  pos: HeldPosition,
  verdict: PositionVerdict
): Promise<boolean> {
  const timestamp = Date.now();

  if (AGENT_MODE === "simulator") {
    state.executedTrades.push({
      success: true,
      tokenIn: pos.symbol,
      tokenOut: "BNB",
      amountIn: pos.amountUsd.toFixed(2),
      amountOut: (pos.amountUsd * (1 + verdict.unrealizedPnLPercent / 100)).toFixed(2),
      txHash: `0xSIM_EXIT_${timestamp.toString(16)}`,
      timestamp,
    });
    const simPnlUsd = pos.amountUsd * (verdict.unrealizedPnLPercent / 100);
    state.totalTrades += 1;
    state.totalVolumeUsd += pos.amountUsd;
    recordExitStats(simPnlUsd);
    guardrails.recordTrade(pos.amountUsd, true);
    return true;
  }

  if (pos.stuck) {
    console.log(`    [exit] ${pos.symbol} is marked stuck — skipping exit attempts`);
    return false;
  }

  if (pos.amountUsd < MIN_SWAP_USD) {
    console.log(`    [exit] Position too small ($${pos.amountUsd.toFixed(2)}) to justify gas — deferring`);
    return false;
  }

  // Reconcile the intended sell size with the actual on-chain balance. Tokens with
  // buy/sell taxes (or bridged/wrapped proxies like BSB) often leave the wallet
  // with fewer tokens than the recorded cost basis implies, causing "transfer
  // amount exceeds balance" reverts. Using the live balance prevents that.
  const balance = await twakExecutor.getBalance(pos.symbol);
  const balanceUsd = balance?.valueUsd ?? 0;
  if (balanceUsd > 0 && balanceUsd < pos.amountUsd) {
    console.log(`    [exit] Recorded cost basis $${pos.amountUsd.toFixed(2)} exceeds live balance $${balanceUsd.toFixed(2)} — sizing down`);
    pos.amountUsd = balanceUsd;
  }

  if (pos.amountUsd < MIN_SWAP_USD) {
    console.log(`    [exit] Live balance too small ($${pos.amountUsd.toFixed(2)}) to justify gas — deferring`);
    return false;
  }

  // Primary: default slippage direct to BNB.
  const result = await twakExecutor.executeSwap({
    tokenIn: pos.symbol,
    tokenOut: "BNB",
    amountIn: pos.amountUsd.toString(),
    slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
  });
  if (result.success) {
    return finalizeExit(pos, result, verdict, timestamp);
  }
  console.log(`    [exit] Primary exit failed: ${result.error}`);

  // Fallback A: progressively higher slippage (tax / low-liquidity tokens).
  for (const slippageBps of STUCK_SLIPPAGES_BPS) {
    console.log(`    [exit] Fallback: retrying at ${(slippageBps / 100).toFixed(0)}% slippage`);
    const hiSlipResult = await twakExecutor.executeSwap({
      tokenIn: pos.symbol,
      tokenOut: "BNB",
      amountIn: pos.amountUsd.toString(),
      slippageBps,
    });
    if (hiSlipResult.success) {
      return finalizeExit(pos, hiSlipResult, verdict, timestamp);
    }
    console.log(`    [exit] ${(slippageBps / 100).toFixed(0)}% slippage failed: ${hiSlipResult.error}`);
  }

  // Fallback B: route through USDC (often deeper liquidity on BSC).
  console.log(`    [exit] Fallback: routing ${pos.symbol} → USDC`);
  const usdcResult = await twakExecutor.executeSwap({
    tokenIn: pos.symbol,
    tokenOut: "USDC",
    amountIn: pos.amountUsd.toString(),
    slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
  });
  if (usdcResult.success) {
    console.log(`    [exit] USDC leg succeeded — closing position (USDC held as stablecoin)`);
    return finalizeExit(pos, usdcResult, verdict, timestamp);
  }
  console.log(`    [exit] USDC route failed: ${usdcResult.error}`);

  // Track failure. After repeated failures, mark the position as stuck so we
  // stop wasting gas on a honeypot / broken tax token.
  pos.failedExitAttempts += 1;
  if (pos.failedExitAttempts >= STUCK_AFTER_FAILED_ATTEMPTS) {
    pos.stuck = true;
    stuckSymbols.add(pos.symbol);
    console.log(`    [exit] ${pos.symbol} marked STUCK after ${pos.failedExitAttempts} failed exits; added to blocklist`);
    sendErrorAlert({
      cycle: state.cycle,
      error: `${pos.symbol} marked STUCK after ${pos.failedExitAttempts} failed exits ($${pos.amountUsd.toFixed(2)}). Added to blocklist — treating as worthless/honeypot.`,
    }).catch(() => {});
  } else {
    console.log(`    [exit] All exit paths failed for ${pos.symbol} ($${pos.amountUsd.toFixed(2)}) — attempt ${pos.failedExitAttempts}/${STUCK_AFTER_FAILED_ATTEMPTS}`);
    sendErrorAlert({
      cycle: state.cycle,
      error: `EXIT ${verdict.action} failed for ${pos.symbol} ($${pos.amountUsd.toFixed(2)}, ${verdict.unrealizedPnLPercent.toFixed(1)}% PnL). Attempt ${pos.failedExitAttempts}/${STUCK_AFTER_FAILED_ATTEMPTS}.`,
    }).catch(() => {});
  }

  return false;
}

function finalizeExit(
  pos: HeldPosition,
  result: SwapResult,
  verdict: PositionVerdict,
  timestamp: number
): boolean {
  state.executedTrades.push(result);
  state.totalTrades += 1;
  state.totalVolumeUsd += pos.amountUsd;
  state.totalGasSpentUsd += result.feeUsd ?? GAS_BUFFER_USD;
  const exitValue = parseFloat(result.amountOut ?? "0");
  const pnlUsd = exitValue - pos.amountUsd;
  state.realizedPnlUsd += pnlUsd;
  recordExitStats(pnlUsd);
  guardrails.recordTrade(pos.amountUsd, true);

  // Surface this exit to Telegram so judges see live risk decisions, not
  // just terminal logs. Non-blocking; safe when Telegram is unconfigured.
  if (verdict.action !== "HOLD") {
    sendExitAlert({
      cycle: state.cycle,
      symbol: pos.symbol,
      action: verdict.action as "EXIT_STOP" | "EXIT_TRAIL" | "EXIT_PARTIAL",
      reason: verdict.reason,
      pnlPercent: verdict.unrealizedPnLPercent,
      amountUsd: pos.amountUsd,
      sellFraction: verdict.sellFraction,
      txHash: result.txHash,
    }).catch(() => {});
  }
  return true;
}

// =============================================================================
// Step 4b: Harvest for BNB (self-funding)
// =============================================================================

const MIN_CYCLES_TO_HARVEST = 5;
const DUST_USD = 0.5;

export async function harvestForBnb(): Promise<void> {
  const bnbPosition = state.portfolio?.positions.find(
    (p) => p.symbol.toUpperCase() === "BNB" || p.token.toUpperCase() === "BNB"
  );
  const bnbValue = bnbPosition?.valueUsd ?? 0;

  const HARVEST_FLOOR = AGENT_CONFIG.trading.bankroll.harvestMinBnbUsd;
  const POSITION_CAP = AGENT_CONFIG.trading.maxOpenPositions;
  const bnbLow = bnbValue < HARVEST_FLOOR;
  const atCap = state.heldPositions.length >= POSITION_CAP;
  if (!bnbLow && !atCap) return;

  // When BNB is very low we are willing to harvest tiny "dust" positions just
  // to recycle gas. Otherwise we need at least $1 of value to justify a swap.
  const minHarvestUsd = bnbValue < HARVEST_FLOOR * 0.5 ? DUST_USD : 1.0;

  // Mature positions are the preferred harvest candidates.
  const maturePositions = state.heldPositions
    .filter(
      (p) =>
        !p.stuck &&
        !stuckSymbols.has(p.symbol) &&
        p.cyclesHeld >= MIN_CYCLES_TO_HARVEST &&
        !unharvestableTokens.has(p.symbol) &&
        p.amountUsd >= minHarvestUsd,
    );

  // If we are at cap and have no mature positions, fall back to any non-stuck
  // position held for at least 2 cycles so we can free a slot for a better
  // conviction entry.
  const youngFallback = maturePositions.length === 0 && atCap
    ? state.heldPositions
        .filter(
          (p) =>
            !p.stuck &&
            !stuckSymbols.has(p.symbol) &&
            p.cyclesHeld >= 2 &&
            !unharvestableTokens.has(p.symbol) &&
            p.amountUsd >= minHarvestUsd,
        )
    : [];

  const candidates = maturePositions.length > 0 ? maturePositions : youngFallback;

  // Sort order depends on why we are harvesting:
  //   - BNB low → sell the largest position to raise the most BNB.
  //   - At cap  → sell the smallest position to free a slot with minimal impact.
  candidates.sort((a, b) => (bnbLow ? b.amountUsd - a.amountUsd : a.amountUsd - b.amountUsd));

  if (candidates.length === 0) {
    const trigger = bnbLow ? `BNB low ($${bnbValue.toFixed(2)})` : `at cap (${state.heldPositions.length}/${POSITION_CAP})`;
    console.log(`  [harvest] ${trigger} but no harvestable position`);
    return;
  }

  const target = candidates[0];
  const trigger = bnbLow
    ? `BNB low (balance: $${bnbValue.toFixed(2)}, floor: $${HARVEST_FLOOR})`
    : `at cap (${state.heldPositions.length}/${POSITION_CAP}) — freeing a slot`;
  const targetLabel = maturePositions.length > 0 ? "mature" : "young";
  console.log(`\n[4b/8] Harvesting — ${trigger}`);
  console.log(`  Selling ${target.symbol} ($${target.amountUsd.toFixed(2)}) — ${targetLabel}, ${target.cyclesHeld} cycles held`);

  const harvestAmountUsd = target.amountUsd * 0.95;

  const primary = await twakExecutor.executeSwap({
    tokenIn: target.symbol,
    tokenOut: "BNB",
    amountIn: harvestAmountUsd.toFixed(4),
    slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
  });

  if (primary.success) {
    state.heldPositions = state.heldPositions.filter(
      (p) => p.symbol !== target.symbol
    );
    state.executedTrades.push(primary);
    state.totalTrades += 1;
    state.totalVolumeUsd += target.amountUsd;
    state.totalGasSpentUsd += primary.feeUsd ?? GAS_BUFFER_USD;
    const harvestPnlUsd = parseFloat(primary.amountOut ?? "0") - target.amountUsd;
    state.realizedPnlUsd += harvestPnlUsd;
    recordExitStats(harvestPnlUsd);
    guardrails.recordTrade(target.amountUsd, true);
    console.log(`  ✓ Harvested ${target.symbol} → BNB (tx: ${primary.txHash?.slice(0, 10)}...)`);
    state.portfolio = await twakExecutor.getPortfolio();
    return;
  }

  console.log(`  ⚠ Primary harvest failed: ${primary.error}`);
  console.log(`  [harvest] Fallback A: routing ${target.symbol} → USDC → BNB`);

  const halfAmount = (target.amountUsd / 2).toFixed(2);
  const toUsdc = await twakExecutor.executeSwap({
    tokenIn: target.symbol,
    tokenOut: "USDC",
    amountIn: halfAmount,
    slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
  });

  if (toUsdc.success) {
    const usdcBalance = await twakExecutor.getBalance("USDC");
    const usdcUsd = usdcBalance?.valueUsd ?? 0;
    if (usdcUsd > 0.5) {
      const usdcToBnb = await twakExecutor.executeSwap({
        tokenIn: "USDC",
        tokenOut: "BNB",
        amountIn: usdcUsd.toFixed(2),
        slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
      });
      if (usdcToBnb.success) {
        state.heldPositions = state.heldPositions.filter(
          (p) => p.symbol !== target.symbol
        );
        state.executedTrades.push(toUsdc, usdcToBnb);
        state.totalTrades += 2;
        state.totalVolumeUsd += target.amountUsd;
        state.totalGasSpentUsd += (toUsdc.feeUsd ?? GAS_BUFFER_USD) + (usdcToBnb.feeUsd ?? GAS_BUFFER_USD);
        const hopPnlUsd = parseFloat(usdcToBnb.amountOut ?? "0") - target.amountUsd;
        state.realizedPnlUsd += hopPnlUsd;
        recordExitStats(hopPnlUsd);
        guardrails.recordTrade(target.amountUsd, true);
        console.log(`  ✓ Harvested via USDC hop (${toUsdc.txHash?.slice(0, 10)} → ${usdcToBnb.txHash?.slice(0, 10)})`);
        state.portfolio = await twakExecutor.getPortfolio();
        return;
      }
      console.log(`  ⚠ USDC → BNB failed: ${usdcToBnb.error}`);
    } else {
      console.log(`  ⚠ USDC leg produced $${usdcUsd.toFixed(2)} (too small to continue)`);
    }
  } else {
    console.log(`  ⚠ ${target.symbol} → USDC failed: ${toUsdc.error}`);
  }

  console.log(`  [harvest] Fallback B: test swap at $0.50 to diagnose revert`);
  const tinyTest = await twakExecutor.executeSwap({
    tokenIn: target.symbol,
    tokenOut: "BNB",
    amountIn: "0.5",
    slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
  });
  if (tinyTest.success) {
    console.log(`  ✓ Tiny swap worked, retrying at $1`);
    const retry = await twakExecutor.executeSwap({
      tokenIn: target.symbol,
      tokenOut: "BNB",
      amountIn: "1",
      slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
    });
    if (retry.success) {
      state.executedTrades.push(tinyTest, retry);
      state.totalTrades += 2;
      state.totalVolumeUsd += 1.5;
      state.totalGasSpentUsd += (tinyTest.feeUsd ?? GAS_BUFFER_USD) + (retry.feeUsd ?? GAS_BUFFER_USD);
      const probePnlUsd = parseFloat(retry.amountOut ?? "0") - 1.5;
      state.realizedPnlUsd += probePnlUsd;
      recordExitStats(probePnlUsd);
      guardrails.recordTrade(1.5, true);
      const idx = state.heldPositions.findIndex((p) => p.symbol === target.symbol);
      if (idx >= 0) {
        state.heldPositions[idx].amountUsd = Math.max(0, state.heldPositions[idx].amountUsd - 1.5);
      }
      console.log(`  ✓ Harvested via size-probing (${tinyTest.txHash?.slice(0, 10)}, ${retry.txHash?.slice(0, 10)})`);
      state.portfolio = await twakExecutor.getPortfolio();
      return;
    }
  }

  console.log(`  ✗ All harvest attempts failed for ${target.symbol}`);
  console.log(`  [harvest] Marking ${target.symbol} as un-harvestable for 5 cycles`);
  unharvestableTokens.set(target.symbol, 5);
  sendErrorAlert({
    cycle: state.cycle,
    error: `Harvest failed for ${target.symbol} after 3 attempts (primary + USDC hop + size probe). Token marked un-harvestable.`,
  }).catch(() => {});
}

// =============================================================================
// Step 5: Create Entry Proposals
// =============================================================================

export async function createTradeProposals(): Promise<Array<{
  tokenSymbol: string;
  convictionScore: number;
  amountInUsd: number;
}>> {
  console.log("\n[5/8] Creating entry proposals...");

  const convictionSignals = state.convictionSignals;
  const portfolio = state.portfolio;
  const portfolioValue = portfolio?.totalValueUsd ?? AGENT_CONFIG.trading.maxPerTradeUsd * 3;

  if (state.heldPositions.length >= AGENT_CONFIG.trading.maxOpenPositions) {
    console.log(
      `  Position cap reached (${state.heldPositions.length}/${AGENT_CONFIG.trading.maxOpenPositions}). Skipping new entries — harvest first.`,
    );
    return [];
  }

  const held = new Set(state.heldPositions.map((p) => p.symbol.toUpperCase()));
  const signalBySymbol = new Map(
    convictionSignals.map((s) => [s.symbol.toUpperCase(), s])
  );

  const scoredTokens = (state.marketData?.tokenPrices ?? [])
    .map((token) => ({
      token,
      conviction: signalBySymbol.get(token.symbol.toUpperCase())?.score ?? 0,
      signal: signalBySymbol.get(token.symbol.toUpperCase()),
    }))
    .filter(
      (t) =>
        t.conviction >= AGENT_CONFIG.trading.minConvictionScore &&
        !held.has(t.token.symbol.toUpperCase())
    )
    .filter((t) => {
      const signal = t.signal;
      if (!signal) return false;
      const holders = signal.holderCount;
      const growth = signal.holderGrowthPercent;
      if (holders != null && holders < AGENT_CONFIG.trading.minHolderCount) {
        console.log(`    [holder gate] Skipping ${t.token.symbol} — only ${holders.toLocaleString()} holders (min ${AGENT_CONFIG.trading.minHolderCount.toLocaleString()})`);
        return false;
      }
      if (AGENT_CONFIG.trading.requireNonNegativeHolderGrowth && growth != null && growth < 0) {
        console.log(`    [holder gate] Skipping ${t.token.symbol} — holder growth ${growth.toFixed(1)}% is negative`);
        return false;
      }
      return true;
    })
    .sort((a, b) => b.conviction - a.conviction);

  if (scoredTokens.length === 0) {
    console.log("  No tokens meet the minimum conviction threshold. Skipping trading this cycle.");
    return [];
  }

  const MAX_SCAN = Math.min(scoredTokens.length, AGENT_CONFIG.trading.topK * 10);
  const liquidTokens: typeof scoredTokens = [];
  const checkedTokens: string[] = [];

  console.log(`  Scanning up to ${MAX_SCAN} tokens for DEX liquidity...`);

  for (let i = 0; i < MAX_SCAN && liquidTokens.length < AGENT_CONFIG.trading.topK; i++) {
    const candidate = scoredTokens[i];
    if (!candidate) break;
    if (stuckSymbols.has(candidate.token.symbol)) {
      console.log(`    [blocklist] Skipping ${candidate.token.symbol} — previously marked stuck`);
      continue;
    }
    checkedTokens.push(candidate.token.symbol);
    const hasLiquidity = await twakExecutor.checkLiquidity(candidate.token.symbol);
    if (!hasLiquidity) continue;

    // Honeypot / tax-token defence: verify the token can actually be sold
    // before we commit BNB to a buy.
    const isSellable = await twakExecutor.checkSellability(candidate.token.symbol);
    if (!isSellable) {
      console.log(`    [honeypot gate] Skipping ${candidate.token.symbol} — sell route reverts or has no liquidity`);
      continue;
    }

    liquidTokens.push(candidate);
  }

  console.log(`  Checked ${checkedTokens.length} tokens, ${liquidTokens.length} are both buyable and sellable`);

  if (liquidTokens.length === 0) {
    console.log("  No tradeable tokens with sufficient liquidity. Skipping trading this cycle.");
    return [];
  }

  const PROPOSAL_CONCENTRATION_PERCENT = 15;
  const SAFETY_MARGIN = 0.9;
  const ADAPTIVE_DECAY = 0.8;

  const bnbUsd = getBnbUsd(portfolio);
  const bankroll = computeBankrollCap(bnbUsd);
  if (!bankroll.canTrade) {
    console.log(`  [bankroll] ${bankroll.reason}`);
    return [];
  }

  const basePerTrade = Math.min(
    AGENT_CONFIG.trading.maxPerTradeUsd,
    portfolioValue * (PROPOSAL_CONCENTRATION_PERCENT / 100),
    bankroll.maxByBnb
  );

  const safePerTrade = basePerTrade * SAFETY_MARGIN;

  const proposals = liquidTokens.map(s => {
    const rejectionCount = concentrationRejectionCount.get(s.token.symbol) ?? 0;
    const adaptiveMultiplier = Math.pow(ADAPTIVE_DECAY, rejectionCount);
    const amountInUsd = Math.round(safePerTrade * adaptiveMultiplier);
    return {
      tokenSymbol: s.token.symbol,
      convictionScore: s.conviction,
      amountInUsd,
    };
  });

  console.log(`  Proposals: ${proposals.map(p => `${p.tokenSymbol} $${p.amountInUsd} (score: ${p.convictionScore})${concentrationRejectionCount.get(p.tokenSymbol) ? ` [rejected ${concentrationRejectionCount.get(p.tokenSymbol)}x before]` : ""}`).join(", ")}`);
  console.log(`  [bankroll] BNB=$${bnbUsd.toFixed(2)}, tradeable=$${bankroll.tradeableBnb.toFixed(2)}, per-trade cap=$${bankroll.maxByBnb.toFixed(2)} → sized to $${safePerTrade.toFixed(2)}`);
  return proposals;
}

// =============================================================================
// Step 6: Check Guardrails
// =============================================================================

export async function checkTradeGuardrails(
  proposals: Array<{ tokenSymbol: string; convictionScore: number; amountInUsd: number }>
): Promise<{
  passed: Array<{ tokenSymbol: string; convictionScore: number; amountInUsd: number }>;
  rejected: Array<{ tokenSymbol: string; reason: string }>;
}> {
  console.log("\n[6/8] Checking risk guardrails...");

  const portfolioValue = state.portfolio?.totalValueUsd ?? 10000;
  const guardrailStatus = guardrails.getStatus(portfolioValue);
  console.log(`  ${guardrailStatus.tradesToday}/${AGENT_CONFIG.trading.maxDailyTrades} trades today, drawdown: ${guardrailStatus.drawdownPercent.toFixed(1)}%`);

  if (!guardrailStatus.allOk) {
    console.log("  GUARDRAILS BLOCKED: One or more limits exceeded.");
    const rejected = proposals.map(p => ({ tokenSymbol: p.tokenSymbol, reason: "Guardrails blocked trading this cycle" }));
    sendGuardrailBlocked({ cycle: state.cycle, rejected, blockedAll: true }).catch(() => {});
    return { passed: [], rejected };
  }

  const passed: typeof proposals = [];
  const rejected: Array<{ tokenSymbol: string; reason: string }> = [];

  for (const proposal of proposals) {
    const result = guardrails.checkTrade({
      tokenIn: "BNB",
      tokenOut: proposal.tokenSymbol,
      amountInUsd: proposal.amountInUsd,
      expectedAmountOut: 0,
      convictionScore: proposal.convictionScore,
      portfolioValue,
    });

    if (result.code === "CONCENTRATION_LIMIT") {
      const current = concentrationRejectionCount.get(proposal.tokenSymbol) ?? 0;
      concentrationRejectionCount.set(proposal.tokenSymbol, current + 1);
    } else if (result.allowed) {
      concentrationRejectionCount.delete(proposal.tokenSymbol);
    }

    if (result.allowed) {
      passed.push(proposal);
    } else {
      rejected.push({ tokenSymbol: proposal.tokenSymbol, reason: result.message });
    }

    state.guardrailResults.push(result);
  }

  if (passed.length > 0) {
    console.log(`  Passed: ${passed.map(p => p.tokenSymbol).join(", ")}`);
  }
  if (rejected.length > 0) {
    console.log(`  Rejected: ${rejected.map(r => `${r.tokenSymbol} (${r.reason})`).join(", ")}`);
    sendGuardrailBlocked({ cycle: state.cycle, rejected }).catch(() => {});
  }

  return { passed, rejected };
}

// =============================================================================
// Step 7: Execute Trades (SoDEX → TWAK fallback)
// =============================================================================

function sodexToSwapResult(
  order: import("./dex-trading.js").OrderResult,
  tokenIn: string,
  tokenOut: string,
  amountInUsd: string,
): SwapResult {
  return {
    success: order.success,
    txHash: order.orderID ? `0xSODEX_${order.orderID}` : undefined,
    tokenIn,
    tokenOut,
    amountIn: amountInUsd,
    amountOut: order.filledQuantity || order.cummulativeQuoteQty || "0",
    error: order.error,
    timestamp: order.timestamp,
  };
}

export async function executeTrades(
  proposals: Array<{ tokenSymbol: string; convictionScore: number; amountInUsd: number }>
): Promise<SwapResult[]> {
  const sodexAvailable = sodexClient.isAvailable();
  const venue = sodexAvailable ? "SoDEX testnet → TWAK fallback" : "TWAK";
  console.log(`\n[7/8] Executing ${proposals.length} entries via ${venue}...`);

  // Macro event pause — high-impact events within 4h skip entries entirely;
  // within 12h halve trade size. Exits are never paused.
  const macroPause: MacroPauseSignal = await fetchMacroPauseSignal();
  state.macroPause = macroPause;
  if (!macroPause.clear) {
    console.log(`  [macro] ${macroPause.reason}`);
  }
  if (macroPause.skipEntries) {
    console.log(`  ⏸ Skipping all entries this cycle (macro pause)`);
    return [];
  }
  if (macroPause.sizeMultiplier < 1) {
    proposals = proposals.map((p) => ({
      ...p,
      amountInUsd: Math.max(1, Math.round(p.amountInUsd * macroPause.sizeMultiplier)),
    }));
  }

  const bnbBalanceUsd = getBnbUsd(state.portfolio);
  const bankroll = computeBankrollCap(bnbBalanceUsd);

  let liveBnbUsd = bnbBalanceUsd;
  try {
    const liveBnb = await twakExecutor.getBalance("BNB");
    if (liveBnb && liveBnb.valueUsd > 0) {
      liveBnbUsd = liveBnb.valueUsd;
      if (Math.abs(liveBnbUsd - bnbBalanceUsd) > 0.5) {
        console.log(`  [preflight] BNB drift: portfolio=$${bnbBalanceUsd.toFixed(2)}, live=$${liveBnbUsd.toFixed(2)} — using live`);
      }
    }
  } catch {
    console.log(`  [preflight] Live BNB check failed, using portfolio value $${bnbBalanceUsd.toFixed(2)}`);
  }

  if (!bankroll.canTrade) {
    console.log(`  ⚠ ${bankroll.reason}`);
    return [];
  }

  const tradeCostUsd = (proposals[0]?.amountInUsd ?? 2) + GAS_BUFFER_USD;
  const affordableTrades = Math.floor(liveBnbUsd / tradeCostUsd);

  if (affordableTrades === 0) {
    console.log(`  ⚠ BNB too low ($${liveBnbUsd.toFixed(2)}) — need $${tradeCostUsd.toFixed(2)} per trade. Skipping all trades.`);
    return [];
  }

  if (affordableTrades < proposals.length) {
    console.log(`  ⚠ BNB ($${liveBnbUsd.toFixed(2)}) only covers ${affordableTrades}/${proposals.length} trades. Reducing.`);
    proposals = proposals.slice(0, affordableTrades);
  }

  const reserveAfterFirst = liveBnbUsd - tradeCostUsd;
  if (reserveAfterFirst < AGENT_CONFIG.trading.bankroll.minBnbReserveUsd) {
    console.log(`  ⚠ First trade would leave BNB at $${reserveAfterFirst.toFixed(2)} (below $${AGENT_CONFIG.trading.bankroll.minBnbReserveUsd} reserve). Skipping.`);
    return [];
  }

  const priceMap = buildPriceMap();
  const results: SwapResult[] = [];

  for (const proposal of proposals) {
    const amountInStr = proposal.amountInUsd.toString();
    console.log(`  → Buying $${amountInStr} ${proposal.tokenSymbol} (conviction: ${proposal.convictionScore})`);

    let result: SwapResult | null = null;

    if (sodexAvailable) {
      try {
        const symbol = `${proposal.tokenSymbol}USDC`;
        console.log(`    [SoDEX] Market buy ${symbol} @ $${amountInStr}`);
        const orderResult = await sodexClient.placeMarketBuy(symbol, amountInStr);

        if (orderResult.success) {
          result = sodexToSwapResult(orderResult, "USDC", proposal.tokenSymbol, amountInStr);
          console.log(`    ✓ [SoDEX] Order filled — ID: ${orderResult.orderID ?? "?"}, avg: ${orderResult.avgPrice ?? "?"}`);
        } else {
          console.log(`    ○ [SoDEX] Failed: ${orderResult.error} — falling back to TWAK`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`    ○ [SoDEX] Error: ${msg} — falling back to TWAK`);
      }
    }

    if (!result) {
      console.log(`    [TWAK] Swapping BNB → ${proposal.tokenSymbol}`);

      const MAX_RETRIES = 2;
      let lastError: unknown;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          console.log(`    Retry #${attempt}/${MAX_RETRIES}...`);
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }

        try {
          const swapResult = await twakExecutor.executeSwap({
            tokenIn: "BNB",
            tokenOut: proposal.tokenSymbol,
            amountIn: amountInStr,
            slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
          });

          result = swapResult;
          break;
        } catch (err) {
          lastError = err;
          const message = err instanceof Error ? err.message : String(err);
          console.log(`    ✗ Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${message}`);
        }
      }

      if (!result) {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        console.log(`    ✗ All ${MAX_RETRIES + 1} TWAK attempts failed. Last error: ${message}`);
        result = {
          success: false,
          error: `All retries exhausted: ${message}`,
          tokenIn: sodexAvailable ? "SoDEX" : "BNB",
          tokenOut: proposal.tokenSymbol,
          amountIn: amountInStr,
          amountOut: "0",
          timestamp: Date.now(),
        };
      }
    }

    if (result.success) {
      console.log(`    ✓ Trade executed${result.txHash ? ` — ${result.txHash.slice(0, 18)}...` : ""}`);
      state.totalTrades += 1;
      state.totalVolumeUsd += proposal.amountInUsd;
      recordEntryStats();
      guardrails.recordTrade(proposal.amountInUsd, true);
      state.totalGasSpentUsd += result.feeUsd ?? GAS_BUFFER_USD;

      const entryPriceUsd = priceMap.get(proposal.tokenSymbol.toUpperCase()) ?? 0;
      if (entryPriceUsd > 0) {
        state.heldPositions.push(
          openPosition({
            symbol: proposal.tokenSymbol,
            entryPriceUsd,
            amountUsd: proposal.amountInUsd,
            cycle: state.cycle,
          })
        );
      }
    } else {
      console.log(`    ✗ Trade failed: ${result.error}`);
      guardrails.recordTrade(proposal.amountInUsd, false);
    }

    results.push(result);
  }

  state.executedTrades.push(...results);

  const successful = results.filter(r => r.success).length;
  console.log(`  ${successful}/${proposals.length} trades succeeded`);

  return results;
}

// =============================================================================
// Step 8: Anchor to Mantle + Casper
// =============================================================================

export async function anchorToMantle(): Promise<void> {
  const regimeScore = state.regimeScore ?? 0;
  const sentimentLabel = state.sentimentLabel ?? "unknown";

  console.log("\n[8/8] Anchoring conviction record to Mantle ERC-8004 registry...");

  const heldCount = state.heldPositions.length;
  const heldThroughDrawdown = state.positionVerdicts.filter(
    (v) => v.action === "HOLD" && v.heldThroughDrawdown
  ).length;
  const maxUnderwater = state.heldPositions.reduce(
    (m, p) => Math.max(m, p.maxUnderwaterPercent),
    0
  );
  const cyclesHeld = state.heldPositions.reduce(
    (sum, p) => sum + p.cyclesHeld,
    0
  );

  const metrics = {
    score: regimeScore,
    fearLevel: state.marketRegime?.fearLevel ?? "unknown",
    heldPositions: heldCount,
    heldThroughDrawdown,
    maxUnderwaterPercent: Math.round(maxUnderwater * 10) / 10,
    totalCyclesHeld: cyclesHeld,
    exitsStop: state.positionVerdicts.filter((v) => v.action === "EXIT_STOP").length,
    exitsTrail: state.positionVerdicts.filter((v) => v.action === "EXIT_TRAIL").length,
    archetype: sentimentLabel,
  };

  const subjectHash = computeSubjectHash(
    "bsc",
    AGENT_CONFIG.competition.identityRegistry
  );
  const thesisHash = computeThesisHash(metrics);

  console.log(`  Subject hash: ${subjectHash.slice(0, 18)}...`);
  console.log(`  Thesis hash:  ${thesisHash.slice(0, 18)}...`);

  const results = await anchorAll({
    subjectHash,
    thesisHash,
    convictionScore: regimeScore,
    archetype: sentimentLabel,
    timestamp: Date.now(),
  });
  state.anchorResults = results;

  for (const r of results) {
    const label = r.adapter.padEnd(6);
    if (r.status === "success") {
      console.log(`  ✓ [${label}] tx ${r.txHash?.slice(0, 12)}… block ${r.blockNumber ?? "?"} gas ${r.gasUsed ?? "?"}`);
      if (r.explorerUrl) console.log(`         ${r.explorerUrl}`);
    } else if (r.status === "skipped") {
      console.log(`  ○ [${label}] skipped — ${r.error ?? "not configured"}`);
    } else {
      console.log(`  ✗ [${label}] failed — ${r.error ?? "unknown"}`);
    }
  }

  const primary = results.find((r) => r.status === "success");
  if (primary) {
    state.lastAnchoredHash = primary.txHash ?? thesisHash;
    state.anchoring = {
      hash: primary.txHash ?? thesisHash,
      mode: "on-chain",
      blockNumber: primary.blockNumber,
      gasUsed: primary.gasUsed,
    };
  } else {
    const anySkipped = results.every((r) => r.status === "skipped");
    console.log(`  Anchored off-chain (thesis hash only) — ${anySkipped ? "no adapter configured" : "all adapters failed"}`);
    state.lastAnchoredHash = thesisHash;
    state.anchoring = {
      hash: thesisHash,
      mode: anySkipped ? "simulator" : "off-chain",
    };
  }
}

// =============================================================================
// Step 8b: Generate Market Narrative
// =============================================================================

export async function generateAndStoreNarrative(): Promise<void> {
  const topSignals = [...state.convictionSignals]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => {
      const quote = state.marketData?.tokenPrices?.find(
        (t) => t.symbol.toUpperCase() === s.symbol.toUpperCase()
      );
      return {
        symbol: s.symbol,
        score: s.score,
        rationale: s.rationale,
        percentChange7d: quote?.percentChange7d ?? 0,
      };
    });

  console.log("\n[8b/8] Generating market narrative from SoSoValue feeds...");

  try {
    const narrative = await generateNarrative({
      regime: state.marketRegime,
      topSignals,
      portfolioValueUsd: state.portfolio?.totalValueUsd ?? 0,
      positionsHeld: state.heldPositions.length,
      cycle: state.cycle,
    });

    state.narrative = narrative;

    if (narrative.headline) {
      console.log(`  Headline: ${narrative.headline}`);
    }
    if (narrative.newsCount > 0 || narrative.macroEventCount > 0) {
      console.log(`  ${narrative.newsCount} news items · ${narrative.macroEventCount} macro events`);
    }
    console.log(`  Summary: ${narrative.summary}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [narrative] Generation skipped: ${msg}`);
  }
}

// =============================================================================
// Cycle Summary (console)
// =============================================================================

export function printCycleSummary(startTime: number): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successfulTrades = state.executedTrades.filter(t => t.success).length;
  const failedTrades = state.executedTrades.filter(t => !t.success).length;

  console.log(`\n── Cycle #${state.cycle} Summary ──`);
  console.log(`  Duration:     ${elapsed}s`);
  console.log(`  Trades:       ${successfulTrades} succeeded, ${failedTrades} failed`);
  console.log(`  Total volume: $${state.totalVolumeUsd.toFixed(2)}`);

  const anchor = state.anchoring;
  if (anchor) {
    const statusIcon =
      anchor.mode === "on-chain" ? "✓" :
      anchor.mode === "simulator" ? "○" :
      "⚠";
    console.log(`  Anchoring:    ${statusIcon} ${anchor.mode}`);
    if (anchor.blockNumber) console.log(`  Block:        ${anchor.blockNumber}`);
    if (anchor.gasUsed) console.log(`  Gas used:     ${anchor.gasUsed}`);
  } else {
    console.log(`  Anchoring:    ○ skipped`);
  }

  if (state.portfolio) {
    const guardrailStatus = guardrails.getStatus(state.portfolio.totalValueUsd);
    console.log(`  Portfolio:    $${state.portfolio.totalValueUsd.toFixed(2)} (drawdown: ${guardrailStatus.drawdownPercent.toFixed(1)}%)`);
  }

  if (state.errors.length > 0) {
    console.log(`  Errors:       ${state.errors.length} total`);
  }
}
