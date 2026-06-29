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
 * See docs/BNB_HACK_SUBMISSION.md for the agent's full architecture and
 * docs/CASPER_BUILDATHON.md for the cross-chain anchoring layer.
 */

// Load .env FIRST. This module has no other imports; its body runs before
// any sibling module reads process.env — guaranteeing CMC_API_KEY, TWAK_*,
// and MANTLE_OPERATOR_KEY are available at module-construction time.
import "./lib/env-loader.js";

import { AGENT_CONFIG } from "./lib/config.js";
import { cmcClient } from "./lib/cmc-client.js";
import { sosovalueClient } from "./lib/sosovalue-client.js";
import { sodexClient } from "./lib/sodex-client.js";
import { twakExecutor, TwakExecutor } from "./lib/twak-executor.js";
import {
  OnchainPortfolio,
  valueHoldings,
  fetchCoinGeckoPrices,
  fetchDexScreenerPrices,
} from "./lib/onchain-portfolio.js";
import { guardrails } from "./lib/risk-guardrails.js";

import { computeSubjectHash, computeThesisHash, anchorAll } from "./lib/anchors/index.js";
import type { AnchorResult } from "./lib/anchors/index.js";
import { getBscExplorerTxUrl } from "./lib/explorers.js";
import type { CmcMarketData } from "./lib/cmc-client.js";
import type { SwapResult, TwakPortfolio } from "./lib/twak-executor.js";
import type { GuardrailResult } from "./lib/risk-guardrails.js";
import {
  scoreMarketRegime,
  scoreTokenConviction,
  evaluatePosition,
  accruePosition,
  openPosition,
} from "./lib/conviction-signal.js";
import type {
  ConvictionSignal,
  HeldPosition,
  MarketRegime,
  PositionVerdict,
} from "./lib/conviction-signal.js";
import { setAgentState, startServer } from "./src/server.js";
import {
  sendCycleSummary,
  sendStartup,
  sendErrorAlert,
} from "./lib/telegram.js";
import { summarizeError, isRecoverable } from "./lib/errors.js";
import { AGENT_MODE } from "./lib/config.js";
import { persistState, loadPersistentState } from "./lib/persistence.js";
import {
  loadHolderCache,
  saveHolderCache,
  fetchHolderCount,
  recordHolderCount,
} from "./lib/bscscan-client.js";
import { computeHolderMetric } from "./lib/holder-growth.js";
import { generateNarrative } from "./lib/market-narrative.js";
import type { MarketNarrative } from "./lib/market-narrative.js";

// Gas cost estimate per BSC swap (~$1.50 at current gas prices).
// Used for pre-flight balance checks and PnL tracking.
const GAS_BUFFER_USD = 1.5;

/**
 * Pull the live BNB USD value out of the cycle's TWAK portfolio snapshot.
 * Returns 0 if BNB isn't present (e.g., fresh wallet before first funding).
 */
function getBnbUsd(portfolio: TwakPortfolio | null): number {
  if (!portfolio) return 0;
  const bnb = portfolio.positions.find(
    (p) => p.symbol?.toUpperCase() === "BNB" || p.token?.toUpperCase() === "BNB"
  );
  return bnb?.valueUsd ?? 0;
}

/**
 * Conservative size cap for a single trade, derived from BNB availability
 * (not portfolio value). Returns 0 if the trade would breach the BNB
 * reserve floor.
 *
 * The point: when BNB is the binding constraint, sizing off portfolio value
 * is reckless. We always cap by (BNB - reserve) * maxTradeFractionOfBnb.
 */
function computeBankrollCap(bnbUsd: number): {
  tradeableBnb: number;
  maxByBnb: number;
  canTrade: boolean;
  reason?: string;
} {
  const cfg = AGENT_CONFIG.trading.bankroll;
  const tradeableBnb = Math.max(0, bnbUsd - cfg.minBnbReserveUsd);
  const maxByBnb = tradeableBnb * cfg.maxTradeFractionOfBnb;

  if (bnbUsd < cfg.entrySkipBelowBnbUsd) {
    return {
      tradeableBnb,
      maxByBnb,
      canTrade: false,
      reason: `BNB ($${bnbUsd.toFixed(2)}) below entry floor ($${cfg.entrySkipBelowBnbUsd}) — focus on harvest + exits`,
    };
  }
  if (maxByBnb < 0.5) {
    return {
      tradeableBnb,
      maxByBnb,
      canTrade: false,
      reason: `Tradeable BNB ($${maxByBnb.toFixed(2)}) below minimum trade size — defer`,
    };
  }

  return { tradeableBnb, maxByBnb, canTrade: true };
}

/**
 * Augment the TWAK portfolio with the REAL on-chain value of held BEP-20
 * positions. TWAK's `wallet portfolio` only reports native BNB + USDC, so
 * every hackathon token shows as $0 and the portfolio value is badly
 * understated. We read live balances directly via balanceOf and price them
 * through a layered, dependable fallback: CMC (this cycle's quotes) →
 * CoinGecko (by contract) → DexScreener (by contract). A token none of them
 * can price contributes $0 rather than a guess.
 *
 * Scope: only positions the agent actually tracks (`state.heldPositions`).
 * Airdropped spam never enters the ledger, so it is never valued.
 *
 * Note on peak/drawdown safety: prices come purely from contract-keyed sources
 * (never CMC-by-symbol), so a scam lookalike can't be valued at a famous
 * asset's price and over-inflate the portfolio (which would permanently
 * corrupt the high-water peak). A transient pricing gap only *understates*
 * value for one cycle, which is self-correcting and cannot lower the peak
 * (it ratchets up only).
 */
async function augmentPortfolioOnchain(): Promise<void> {
  if (!state.portfolio || state.heldPositions.length === 0) return;
  const wallet = process.env.AGENT_WALLET_KEY || process.env.AGENT_WALLET_ADDRESS;
  if (!wallet) return;

  // Resolve a contract for every held symbol. Use the session cache when
  // available, otherwise resolve on demand (e.g. on the first cycle after a
  // restart, before conviction scoring has populated the cache).
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

    // CONTRACT-BASED pricing only. We deliberately do NOT price held wallet
    // tokens by CMC symbol: the agent's swaps sometimes land scam lookalikes
    // that reuse a famous ticker (e.g. an "ETH" token at 0x000008D2… that is
    // not Ether). Symbol pricing would value those at the real asset's price
    // and massively inflate the portfolio. Contract-keyed sources price the
    // ACTUAL token at that address: CoinGecko first, DexScreener as fallback.
    const contracts = holdings.map((h) => h.contract);
    const cg = await fetchCoinGeckoPrices(contracts);
    const cgMissing = holdings.filter((h) => !(cg.get(h.contract) ?? 0)).map((h) => h.contract);
    const dex = cgMissing.length ? await fetchDexScreenerPrices(cgMissing) : new Map<string, number>();

    // Empty CMC map — pricing comes purely from contract-keyed sources.
    const { positions, totalUsd } = valueHoldings(holdings, new Map(), cg, dex);

    // The TWAK portfolio already counts native BNB (+ any USDC). Replace/insert
    // the held-token rows with their real on-chain value and reconcile the total.
    let addedValue = 0;
    const sources = new Set<string>();
    for (const pos of positions) {
      if (pos.valueUsd <= 0.01) continue;
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
    if (addedValue !== 0) {
      state.portfolio!.totalValueUsd += addedValue;
      console.log(
        `  [onchain] Valued ${pricedCount}/${holdings.length} held position(s) = $${totalUsd.toFixed(2)} ` +
        `(${[...sources].join("+") || "none"}); portfolio → $${state.portfolio!.totalValueUsd.toFixed(2)}`
      );
    }
  } catch {
    // Non-fatal — TWAK value is still usable.
  }
}

// =============================================================================
// Agent State
// =============================================================================

const state = {
  cycle: 0,
  status: "idle" as "idle" | "running" | "paused" | "error",
  lastRunAt: null as number | null,
  nextRunAt: null as number | null,
  totalTrades: 0,
  totalVolumeUsd: 0,
  totalGasSpentUsd: 0,
  realizedPnlUsd: 0,
  errors: [] as string[],

  // Cached market data for this cycle
  marketData: null as CmcMarketData | null,
  portfolio: null as TwakPortfolio | null,

  // Cycle results
  guardrailResults: [] as GuardrailResult[],
  executedTrades: [] as SwapResult[],
  marketRegime: null as MarketRegime | null,
  convictionSignals: [] as ConvictionSignal[],
  positionVerdicts: [] as PositionVerdict[],
  // Conviction ledger — positions we hold to demonstrate "Early, Not Wrong".
  // Valued by real CMC prices regardless of execution mode.
  heldPositions: [] as HeldPosition[],
  // Kept for Telegram payload compatibility (mirror of marketRegime).
  regimeScore: null as number | null,
  sentimentLabel: null as string | null,
  lastAnchoredHash: null as string | null,
  anchoring: null as {
    hash: string;
    mode: "on-chain" | "reverted" | "off-chain" | "simulator";
    blockNumber?: number;
    gasUsed?: string;
  } | null,
  /** Market narrative generated this cycle (SoSoValue feeds + conviction). */
  narrative: null as MarketNarrative | null,

  /** Per-adapter anchor results for the most recent cycle. The orchestrator
   *  populates one entry per enabled adapter (Mantle, Casper, …). The
   *  legacy `anchoring` field above mirrors the first successful adapter so
   *  existing Telegram/server displays keep working. */
  anchorResults: [] as AnchorResult[],
};

/**
 * Track consecutive concentration-limit guardrail rejections per token.
 * Used for adaptive sizing: each rejection reduces the proposed trade size
 * by 20% so the next cycle's proposal is more likely to pass.
 */
const concentrationRejectionCount = new Map<string, number>();

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
// Main Loop - Step 1: Fetch Market Data
// =============================================================================

async function fetchMarketData(): Promise<void> {
  console.log("\n[1/6] Fetching market data (SoSoValue + CMC composite)...");

  // ── Composite data provider ──
  // Try SoSoValue first for token prices (fresher data at 30s intervals),
  // fall back to CMC for tokens not covered by SoSoValue.
  // CMC always provides regime data (Fear & Greed, funding rates) which
  // SoSoValue doesn't offer.
  const [ssvData, cmcData] = await Promise.all([
    sosovalueClient.fetchMarketData().catch(() => null),
    cmcClient.fetchMarketData().catch(() => null),
  ]);

  // Merge: SoSoValue token prices preferred, CMC fills missing tokens
  let tokenPrices = ssvData?.tokenPrices ?? [];
  if (cmcData?.tokenPrices && ssvData) {
    const ssvSymbols = new Set(tokenPrices.map((t) => t.symbol.toUpperCase()));
    for (const cmcToken of cmcData.tokenPrices) {
      if (!ssvSymbols.has(cmcToken.symbol.toUpperCase())) {
        tokenPrices.push(cmcToken);
      }
    }
  } else if (cmcData?.tokenPrices && !ssvData) {
    tokenPrices = cmcData.tokenPrices;
  }

  const marketData = {
    globalMetrics: cmcData?.globalMetrics ?? null,
    derivatives: cmcData?.derivatives ?? null,
    tokenPrices,
    tokenHolders: cmcData?.tokenHolders ?? [],
    trendingNarratives: cmcData?.trendingNarratives ?? [],
  };

  // ── Logging ──
  const ssvCount = ssvData?.tokenPrices.length ?? 0;
  const cmcCount = cmcData?.tokenPrices.length ?? 0;
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
    // Log top movers
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

  // Seed the resolver's reference prices from the composite data.
  // Reference prices come from SoSoValue (preferred) or CMC (fallback).
  TwakExecutor.setReferencePrices(
    marketData.tokenPrices
      .filter((t) => typeof t.price === "number" && t.price > 0)
      .map((t) => [t.symbol, t.price] as [string, number]),
  );
}

// =============================================================================
// Main Loop - Step 3: Score Market Regime + Token Conviction (contrarian)
// =============================================================================

/** Build a SYMBOL → current USD price map from this cycle's CMC quotes. */
function buildPriceMap(): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of state.marketData?.tokenPrices ?? []) {
    if (t.price > 0) map.set(t.symbol.toUpperCase(), t.price);
  }
  return map;
}

async function analyzeConviction(): Promise<{
  regime: MarketRegime;
  convictionSignals: ConvictionSignal[];
}> {
  console.log("\n[3/8] Scoring market regime + token conviction (contrarian)...");

  const md = state.marketData;
  const regime = scoreMarketRegime(md?.globalMetrics ?? null, md?.derivatives ?? null);
  console.log(`  Regime: ${regime.score}/100 — ${regime.label} (FGI=${regime.fearGreedIndex ?? "?"})`);

  // --- Holder-growth integration (on-chain) ---
  // Load cache, resolve addresses, fetch counts, compute metrics.
  // Gated on NODEREAL_API_KEY (primary) or COINGECKO_API_KEY (fallback).
  // When neither is set, holderMetrics stays empty and the conviction signal
  // gracefully omits the holder component.
  const holderCache = loadHolderCache();
  const holderMetrics = new Map<string, { count: number; growthPercent: number | null }>();
  const tokens = md?.tokenPrices ?? [];

  if (process.env.NODEREAL_API_KEY || process.env.COINGECKO_API_KEY) {
    // Pre-score tokens to find the most promising candidates for holder data.
    // This avoids wasting API calls on stablecoins and large-caps that will
    // never have high contrarian conviction.
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
      // NodeReal free tier: no hard rate limit but pace to be polite.
      if (fetched < toResolve.length) await new Promise((r) => setTimeout(r, 600));
    }
    saveHolderCache(holderCache);
    if (fetched > 0) console.log(`  [holders] Fetched ${fetched} holder counts`);
  }

  // Compute metrics from cache (works even without API key if cache has data).
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
    scoreTokenConviction(t, regime, holderMetrics.get(t.symbol))
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
// Main Loop - Step 4: Manage Open Positions (cap losses, let winners run)
// =============================================================================

/**
 * The soul of the agent. For every open position we either HOLD (through
 * ordinary drawdown — "early, not wrong"), take partial profit at +50%
 * (sell 33%, let the rest ride), or EXIT fully to cap a loss / lock the
 * asymmetry of a position that has already run.
 */
async function manageOpenPositions(): Promise<void> {
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

    // Can't price it this cycle — keep holding, re-check next cycle.
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

/**
 * Execute an exit (sell the held token into USDC). Returns true if the
 * position is now closed. In simulator mode the close is logical (the on-chain
 * swap is cosmetic); in live mode it routes through TWAK.
 */
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
    state.totalTrades += 1;
    guardrails.recordTrade(pos.amountUsd, true);
    return true;
  }

  const result = await twakExecutor.executeSwap({
    tokenIn: pos.symbol,
    tokenOut: "BNB",
    amountIn: pos.amountUsd.toString(),
    slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
  });

  // ── Exit fallback ladder ──
  // 1. Primary:    pos → BNB at default slippage (handled by `result` above)
  // 2. Fallback A: pos → BNB at 5% slippage (for thin pools)
  // 3. Fallback B: pos → USDC at default slippage (USDC pair usually deeper)
  // 4. Final:      alert and return false — caller keeps position flagged
  //
  // Bankroll guard: refuse to attempt exit if position is too small to
  // justify gas. EXIT_STOP on a $0.05 token is not worth burning $1.50.
  const MIN_SWAP_USD = 1.0;
  if (pos.amountUsd < MIN_SWAP_USD) {
    console.log(`    [exit] Position too small ($${pos.amountUsd.toFixed(2)}) to justify gas — deferring`);
    return false;
  }

  if (result.success) {
    return finalizeExit(pos, result, verdict, timestamp);
  }
  console.log(`    [exit] Primary exit failed: ${result.error}`);

  // 2. Fallback A: high slippage (5%)
  console.log(`    [exit] Fallback A: retrying at 5% slippage`);
  const hiSlipResult = await twakExecutor.executeSwap({
    tokenIn: pos.symbol,
    tokenOut: "BNB",
    amountIn: pos.amountUsd.toString(),
    slippageBps: 500,
  });
  if (hiSlipResult.success) {
    return finalizeExit(pos, hiSlipResult, verdict, timestamp);
  }
  console.log(`    [exit] High-slippage failed: ${hiSlipResult.error}`);

  // 3. Fallback B: route through USDC (almost always deeper liquidity)
  console.log(`    [exit] Fallback B: routing ${pos.symbol} → USDC`);
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

  // 4. Final: alert + keep position
  console.log(`    [exit] All exit paths failed for ${pos.symbol} ($${pos.amountUsd.toFixed(2)})`);
  sendErrorAlert({
    cycle: state.cycle,
    error: `EXIT ${verdict.action} failed for ${pos.symbol} ($${pos.amountUsd.toFixed(2)}, ${verdict.unrealizedPnLPercent.toFixed(1)}% PnL) after 3 attempts. Position kept.`,
  }).catch(() => {});
  return false;
}

/**
 * Shared bookkeeping for a successful exit (used by all exit paths).
 * Records trade, gas, PnL, and clears the position from the ledger.
 */
function finalizeExit(
  pos: HeldPosition,
  result: SwapResult,
  verdict: PositionVerdict,
  timestamp: number
): boolean {
  state.executedTrades.push(result);
  state.totalTrades += 1;
  state.totalGasSpentUsd += GAS_BUFFER_USD;
  const exitValue = parseFloat(result.amountOut ?? "0");
  state.realizedPnlUsd += exitValue - pos.amountUsd;
  guardrails.recordTrade(pos.amountUsd, true);
  return true;
}

// =============================================================================
// Main Loop - Step 4b: Harvest for BNB (self-funding)
// =============================================================================

const BNB_FLOOR_USD = 5; // Minimum BNB needed for one trade
const MIN_CYCLES_TO_HARVEST = 8; // Position must have been held this long

async function harvestForBnb(): Promise<void> {
  const bnbPosition = state.portfolio?.positions.find(
    (p) => p.symbol.toUpperCase() === "BNB" || p.token.toUpperCase() === "BNB"
  );
  const bnbValue = bnbPosition?.valueUsd ?? 0;

  // Two triggers — harvest when EITHER:
  //   1. BNB drops below floor — need gas/trading capital, OR
  //   2. Position count exceeds the cap — proactively shrink toward target.
  // Trigger 2 ensures the ledger converges to the cap even when BNB is fine
  // (otherwise we'd be stuck at 14 positions blocking new entries forever).
  const HARVEST_FLOOR = AGENT_CONFIG.trading.bankroll.harvestMinBnbUsd;
  const POSITION_CAP = AGENT_CONFIG.trading.maxOpenPositions;
  const bnbLow = bnbValue < HARVEST_FLOOR;
  const overCap = state.heldPositions.length > POSITION_CAP;
  if (!bnbLow && !overCap) return;

  // Skip dust — swapping a $0.08 position costs more in gas than it returns.
  // We need a meaningful chunk of BNB to actually re-enable trading.
  const MIN_HARVEST_USD = 1.0;
  const maturePositions = state.heldPositions
    .filter(
      (p) =>
        p.cyclesHeld >= MIN_CYCLES_TO_HARVEST &&
        !unharvestableTokens.has(p.symbol) &&
        p.amountUsd >= MIN_HARVEST_USD,
    );

  // When BNB-low: sell the largest mature position (maximum BNB per swap).
  // When only over-cap: sell the smallest mature (clean up the tail first,
  // preserve the strong positions). When both: BNB-low dominates.
  maturePositions.sort((a, b) => (bnbLow ? b.amountUsd - a.amountUsd : a.amountUsd - b.amountUsd));

  if (maturePositions.length === 0) {
    const trigger = bnbLow ? `BNB low ($${bnbValue.toFixed(2)})` : `over cap (${state.heldPositions.length}/${POSITION_CAP})`;
    console.log(`  [harvest] ${trigger} but no harvestable position (need ≥${MIN_CYCLES_TO_HARVEST} cycles held AND ≥$${MIN_HARVEST_USD})`);
    return;
  }

  const target = maturePositions[0];
  const trigger = bnbLow
    ? `BNB low (balance: $${bnbValue.toFixed(2)}, floor: $${HARVEST_FLOOR})`
    : `over cap (${state.heldPositions.length}/${POSITION_CAP})`;
  console.log(`\n[4b/8] Harvesting — ${trigger}`);
  console.log(`  Selling ${target.symbol} ($${target.amountUsd.toFixed(2)}) — held ${target.cyclesHeld} cycles, ${bnbLow ? "largest" : "smallest"} harvestable position`);

  // ── Fallback ladder ──
  // 1. Primary:  ${target.symbol} → BNB (deepest pools)
  // 2. Fallback A: ${target.symbol} → USDC → BNB (USDC has the deepest
  //    liquidity on BSC; intermediate hop often succeeds when direct fails)
  // 3. Fallback B: smaller test swap to diagnose amount-related reverts
  // 4. Final: Telegram alert + mark token un-harvestable for next cycles

  // Sell 95% of the ledger value, not 100% — leaves slack for the small
  // ledger-vs-on-chain-balance drift (rounding, price tick between the
  // valuation snapshot and tx submission). Without this, the router reverts
  // with ExceedsBalance (0xf4059071) on any harvest where the position's
  // token balance is the precise basis. Verified: $2 of FET swapped fine,
  // $13.78 = 100% of FET balance reverted on the same router/route.
  const harvestAmountUsd = target.amountUsd * 0.95;

  // 1. Primary attempt
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
    state.totalGasSpentUsd += GAS_BUFFER_USD;
    guardrails.recordTrade(target.amountUsd, true);
    console.log(`  ✓ Harvested ${target.symbol} → BNB (tx: ${primary.txHash?.slice(0, 10)}...)`);
    state.portfolio = await twakExecutor.getPortfolio();
    return;
  }

  // 2. Fallback A: route through USDC
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
        // Remove the FULL position from the ledger — we sold half and the
        // other half is now illiquid (still tracked as remaining cost basis
        // but no longer a swap candidate). Better to clear than to retry
        // forever on a broken pair.
        state.heldPositions = state.heldPositions.filter(
          (p) => p.symbol !== target.symbol
        );
        state.executedTrades.push(toUsdc, usdcToBnb);
        state.totalTrades += 2;
        state.totalGasSpentUsd += GAS_BUFFER_USD * 2;
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

  // 3. Fallback B: smaller test amount (catches tax/transfer-fee tokens
  // where the revert is amount-proportional)
  console.log(`  [harvest] Fallback B: test swap at $0.50 to diagnose revert`);
  const tinyTest = await twakExecutor.executeSwap({
    tokenIn: target.symbol,
    tokenOut: "BNB",
    amountIn: "0.5",
    slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
  });
  if (tinyTest.success) {
    // The token is swapable, just not at full size — try medium size
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
      state.totalGasSpentUsd += GAS_BUFFER_USD * 2;
      guardrails.recordTrade(1.5, true);
      // Reduce remaining position cost basis by what we sold (~$1.50)
      const idx = state.heldPositions.findIndex((p) => p.symbol === target.symbol);
      if (idx >= 0) {
        state.heldPositions[idx].amountUsd = Math.max(0, state.heldPositions[idx].amountUsd - 1.5);
      }
      console.log(`  ✓ Harvested via size-probing (${tinyTest.txHash?.slice(0, 10)}, ${retry.txHash?.slice(0, 10)})`);
      state.portfolio = await twakExecutor.getPortfolio();
      return;
    }
  }

  // 4. Final: alert and stop retrying this token for N cycles
  console.log(`  ✗ All harvest attempts failed for ${target.symbol}`);
  console.log(`  [harvest] Marking ${target.symbol} as un-harvestable for 5 cycles`);
  unharvestableTokens.set(target.symbol, 5);
  sendErrorAlert({
    cycle: state.cycle,
    error: `Harvest failed for ${target.symbol} after 3 attempts (primary + USDC hop + size probe). Token marked un-harvestable.`,
  }).catch(() => {});
}

/**
 * Per-token cooldown for tokens that fail the harvest ladder. Prevents
 * the same broken token from being tried every cycle.
 */
const unharvestableTokens = new Map<string, number>();

function tickUnharvestableCooldowns(): void {
  for (const [sym, count] of unharvestableTokens.entries()) {
    if (count <= 1) unharvestableTokens.delete(sym);
    else unharvestableTokens.set(sym, count - 1);
  }
}

// =============================================================================
// Main Loop - Step 5: Create Entry Proposals (contrarian)
// =============================================================================

async function createTradeProposals(): Promise<Array<{
  tokenSymbol: string;
  convictionScore: number;
  amountInUsd: number;
}>> {
  console.log("\n[5/8] Creating entry proposals...");

  const convictionSignals = state.convictionSignals;
  const portfolio = state.portfolio;
  const portfolioValue = portfolio?.totalValueUsd ?? AGENT_CONFIG.trading.maxPerTradeUsd * 3;

  // Hard cap on total open positions. Above this we focus on harvesting,
  // not entering — new conviction signals are deferred until a slot frees up.
  if (state.heldPositions.length >= AGENT_CONFIG.trading.maxOpenPositions) {
    console.log(
      `  Position cap reached (${state.heldPositions.length}/${AGENT_CONFIG.trading.maxOpenPositions}). Skipping new entries — harvest first.`,
    );
    return [];
  }

  // Don't double-buy positions we already hold — add to conviction, don't churn.
  const held = new Set(state.heldPositions.map((p) => p.symbol.toUpperCase()));

  // Index signals by symbol, then rank candidates by conviction score.
  const signalBySymbol = new Map(
    convictionSignals.map((s) => [s.symbol.toUpperCase(), s])
  );

  const scoredTokens = (state.marketData?.tokenPrices ?? [])
    .map((token) => ({
      token,
      conviction: signalBySymbol.get(token.symbol.toUpperCase())?.score ?? 0,
    }))
    .filter(
      (t) =>
        t.conviction >= AGENT_CONFIG.trading.minConvictionScore &&
        !held.has(t.token.symbol.toUpperCase())
    )
    .sort((a, b) => b.conviction - a.conviction);

  if (scoredTokens.length === 0) {
    console.log("  No tokens meet the minimum conviction threshold. Skipping trading this cycle.");
    return [];
  }

  // Scan down the candidate list to find topK liquid tokens
  // Liquidity is scarce for hackathon tokens, so we check progressively
  // and bail early once we have enough tradeable tokens.
  const MAX_SCAN = Math.min(scoredTokens.length, AGENT_CONFIG.trading.topK * 10); // Check up to 30 tokens
  const liquidTokens: typeof scoredTokens = [];
  const checkedTokens: string[] = [];

  console.log(`  Scanning up to ${MAX_SCAN} tokens for DEX liquidity...`);

  for (let i = 0; i < MAX_SCAN && liquidTokens.length < AGENT_CONFIG.trading.topK; i++) {
    const candidate = scoredTokens[i];
    if (!candidate) break;
    checkedTokens.push(candidate.token.symbol);

    const hasLiquidity = await twakExecutor.checkLiquidity(candidate.token.symbol);
    if (hasLiquidity) {
      liquidTokens.push(candidate);
    }
  }

  console.log(`  Checked ${checkedTokens.length} tokens, ${liquidTokens.length} have DEX liquidity`);

  if (liquidTokens.length === 0) {
    console.log("  No tradeable tokens with sufficient liquidity. Skipping trading this cycle.");
    return [];
  }

  // Size each position with three layers of safety:
  // 1. Reduced concentration cap (15% vs guardrails 20%) for headroom
  // 2. Safety margin (0.9x) to avoid hitting the limit exactly
  // 3. Adaptive sizing — reduce by 20% per consecutive concentration rejection
  // 4. BNB-aware bankroll cap — never let one trade consume more than
  //    `maxTradeFractionOfBnb` of tradeable BNB. This is the binding
  //    constraint when bankroll is tight (vs portfolio %, which can lie).
  const PROPOSAL_CONCENTRATION_PERCENT = 15;
  const SAFETY_MARGIN = 0.9;
  const ADAPTIVE_DECAY = 0.8;

  // Bankroll check — if BNB can't fund a single trade, bail early.
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
// Main Loop - Step 4: Check Guardrails
// =============================================================================

async function checkTradeGuardrails(
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
    return { passed: [], rejected: proposals.map(p => ({ tokenSymbol: p.tokenSymbol, reason: "Guardrails blocked trading this cycle" })) };
  }

  const passed: typeof proposals = [];
  const rejected: Array<{ tokenSymbol: string; reason: string }> = [];

  for (const proposal of proposals) {
    const result = guardrails.checkTrade({
      tokenIn: "BNB",      // Swap from BNB (native token we hold)
      tokenOut: proposal.tokenSymbol,
      amountInUsd: proposal.amountInUsd,
      expectedAmountOut: 0,
      convictionScore: proposal.convictionScore,
      portfolioValue,
    });

    // Track concentration rejections for adaptive sizing in the next cycle
    if (result.code === "CONCENTRATION_LIMIT") {
      const current = concentrationRejectionCount.get(proposal.tokenSymbol) ?? 0;
      concentrationRejectionCount.set(proposal.tokenSymbol, current + 1);
    } else if (result.allowed) {
      // Reset on success — the token is no longer over-concentrated
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
  }

  return { passed, rejected };
}

// =============================================================================
// Main Loop - Step 7: Execute Entries
// =============================================================================

/**
 * Convert a SoDEX OrderResult to a SwapResult for compatibility with the
 * existing state tracking, Telegram summaries, and guardrail hooks.
 */
function sodexToSwapResult(
  order: import("./lib/sodex-client.js").OrderResult,
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

async function executeTrades(
  proposals: Array<{ tokenSymbol: string; convictionScore: number; amountInUsd: number }>
): Promise<SwapResult[]> {
  // ── Execution venue preference ──
  // SoDEX testnet (orderbook, ValueChain) preferred when configured.
  // TWAK (AMM swap, BSC) is the universal fallback.
  const sodexAvailable = sodexClient.isAvailable();
  const venue = sodexAvailable ? "SoDEX testnet → TWAK fallback" : "TWAK";
  console.log(`\n[7/8] Executing ${proposals.length} entries via ${venue}...`);

  // Pre-flight: check BNB balance before attempting any trades.
  // Each trade needs: trade amount (in BNB) + gas. Don't waste gas
  // on trades that will fail with "insufficient funds".
  const bnbPrice = state.marketData?.tokenPrices?.find(
    (t) => t.symbol.toUpperCase() === "BNB"
  )?.price ?? 589;
  const bnbBalanceUsd = getBnbUsd(state.portfolio);
  const bankroll = computeBankrollCap(bnbBalanceUsd);

  // Defensive pre-flight: re-check on-chain BNB (TWAK portfolio can drift
  // from the chain). If we can't reach TWAK here, fall back to the cached
  // value but log the warning.
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

  // Calculate how many trades we can afford — uses LIVE BNB, not the cached
  // portfolio value. Each trade reserves its full USD size + gas.
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

  // Hard pre-flight check: refuse if the FIRST trade would breach the
  // BNB reserve floor. TWAK will reject with "insufficient funds" anyway,
  // but doing this check client-side saves a failed-tx and gas.
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

    // ── Try SoDEX first (orderbook) when available ──
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

    // ── Fall back to TWAK (AMM swap on BSC) ──
    if (!result) {
      console.log(`    [TWAK] Swapping BNB → ${proposal.tokenSymbol}`);

      // Retry loop: up to 3 total attempts
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
      guardrails.recordTrade(proposal.amountInUsd, true);
      state.totalGasSpentUsd += GAS_BUFFER_USD;

      // Open a conviction position
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

  // Append entries to whatever exits step 4 already recorded this cycle.
  state.executedTrades.push(...results);
  state.totalTrades += results.filter(r => r.success).length;
  state.totalVolumeUsd += results.filter(r => r.success).reduce((sum, r) => sum + parseFloat(r.amountIn), 0);

  const successful = results.filter(r => r.success).length;
  console.log(`  ${successful}/${proposals.length} trades succeeded`);

  return results;
}

// =============================================================================
// Main Loop - Step 8: Anchor to Mantle
// =============================================================================

async function anchorToMantle(): Promise<void> {
  const regimeScore = state.regimeScore ?? 0;
  const sentimentLabel = state.sentimentLabel ?? "unknown";

  console.log("\n[8/8] Anchoring conviction record to Mantle ERC-8004 registry...");

  // Aggregate conviction performance across all open positions. These are the
  // numbers that prove the agent embodies "Early, Not Wrong": how many positions
  // it's held through drawdown, how big the worst weathered dip was, how long
  // it has let winners run without taking profit early.
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

  // Anchor across all enabled adapters (Mantle, Casper, …). The orchestrator
  // never throws — it returns one AnchorResult per adapter, and we surface the
  // first successful one as the legacy single-anchor `state.anchoring` slot
  // so existing Telegram/server displays keep working without changes.
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

  // Promote the first success to the legacy `state.anchoring` slot. If
  // nothing succeeded, fall back to off-chain mode (thesis-hash only).
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
// Main Loop - Step 8b: Generate Market Narrative
// =============================================================================

/**
 * Generate a natural-language market narrative from SoSoValue news feeds,
 * macroeconomic events, and the agent's own conviction data.
 *
 * Non-blocking: if SoSoValue is unreachable or times out, the narrative
 * stays null and the cycle continues without interruption.
 */
async function generateAndStoreNarrative(): Promise<void> {
  const topSignals = [...state.convictionSignals]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => {
      // Find the 7d price change from market data for the narrative
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
    // Non-fatal — narrative is a nice-to-have
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [narrative] Generation skipped: ${msg}`);
  }
}

// =============================================================================
// Main Loop - Cycle Summary
// =============================================================================

function printCycleSummary(startTime: number): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successfulTrades = state.executedTrades.filter(t => t.success).length;
  const failedTrades = state.executedTrades.filter(t => !t.success).length;

  console.log(`\n── Cycle #${state.cycle} Summary ──`);
  console.log(`  Duration:     ${elapsed}s`);
  console.log(`  Trades:       ${successfulTrades} succeeded, ${failedTrades} failed`);
  console.log(`  Total volume: $${state.totalVolumeUsd.toFixed(2)}`);

  // Anchoring details
  const anchor = state.anchoring;
  if (anchor) {
    const statusIcon =
      anchor.mode === "on-chain" ? "✓" :
      anchor.mode === "simulator" ? "○" :
      "⚠";
    console.log(`  Anchoring:    ${statusIcon} ${anchor.mode}`);
    if (anchor.blockNumber) {
      console.log(`  Block:        ${anchor.blockNumber}`);
    }
    if (anchor.gasUsed) {
      console.log(`  Gas used:     ${anchor.gasUsed}`);
    }
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
      gasSpentThisCycle: state.executedTrades.filter(t => t.success).length * GAS_BUFFER_USD,
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
    }).catch(() => {});
  } catch (error) {
    state.status = "error";
    const summary = summarizeError(error);
    state.errors.push(summary);
    console.error(`\n✗ Cycle failed: ${summary}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    // Log whether the error is recoverable
    if (!isRecoverable(error)) {
      console.error(`  Non-recoverable error — agent will not retry this cycle.`);
    }

    // Send error alert to Telegram (non-blocking, skip if not configured)
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
      state.heldPositions = held;
      console.log(
        `  Snapshot: restored ${held.length} open position(s) from last cycle`
      );
    } else {
      console.log(`  Snapshot: no open positions to restore`);
    }

    // Restore cumulative gas + realized PnL so the Telegram summary doesn't
    // report $0.00 gas after every pm2 restart. These are session-scoped in
    // memory; without persistence the Net P&L line is overstated.
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

    // ── Reconcile with on-chain reality ──
    // state.json can drift from chain (positions sold off-chain, dust, etc).
    // We verify each restored position with a DIRECT on-chain balanceOf — NOT
    // TWAK's `wallet portfolio`, which only reports native BNB + USDC and would
    // wrongly flag every BEP-20 as a ghost (this is what previously orphaned
    // ~$100 of real positions). A position is only dropped when balanceOf == 0.
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
            // Resolve via the session cache, falling back to a live lookup
            // (the cache is empty on the first cycle after a restart).
            let contract = addresses.get(p.symbol.toUpperCase());
            if (!contract) contract = (await twakExecutor.resolveAddress(p.symbol)) ?? undefined;
            if (!contract) {
              // Can't resolve a contract to verify — keep it rather than risk
              // deleting a real position on a transient resolution miss.
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

/** Compute a quick config hash from the trading params. */
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
    portfolio: state.portfolio,
  };

  setAgentState(agentSnapshot);

  // Persist state after every sync (non-blocking, errors are logged)
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

  // Start the HTTP server (serves /status, /trades, /conviction on exotic port)
  const server = startServer(31777);
  console.log("");  // spacer

  // Health check at startup
  const health = await startupCheck();

  // Send startup notification to Telegram with real health data (skip if not configured)
  sendStartup({
    twakMode: health.twakMode,
    cmcConnected: health.cmcConnected,
    walletAddress: health.walletAddress,
    isTestnet: health.isTestnet,
    topK: AGENT_CONFIG.trading.topK,
    intervalMinutes: AGENT_CONFIG.trading.loopIntervalMinutes,
    maxDrawdown: AGENT_CONFIG.trading.maxDrawdownPercent,
  }).catch(() => {});

  // Log resolved agent mode (explicit env var or auto-detected)
  console.log(`Agent mode: ${AGENT_MODE.toUpperCase()}${AGENT_MODE === "simulator" ? " (no real execution)" : ""}`);

  // Restore the conviction ledger from the last persisted cycle so open
  // positions aren't abandoned across restarts.
  await restoreSnapshot();

  // Sync initial state to server
  syncServerState();

  // First cycle
  console.log("\nStarting first cycle...");
  await runCycle();

  // Sync state after first cycle (also persists via syncServerState)
  syncServerState();

  // Schedule subsequent cycles with error isolation.
  // Each cycle runs independently — a failure in one cycle does not
  // prevent subsequent cycles from executing.
  //
  // We use a self-rescheduling setTimeout instead of setInterval so that
  // the loop interval can adapt to BNB availability. When BNB is below the
  // target ($25), the agent runs cycles less frequently (8h instead of 4h)
  // to preserve gas spent on Mantle anchoring.
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

  // Keep process alive — graceful shutdown stops the server
  process.on("SIGINT", () => {
    console.log("\nGraceful shutdown...");
    console.log(`Total trades: ${state.totalTrades}, Volume: $${state.totalVolumeUsd.toFixed(2)}`);
    server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
