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
 * See docs/HACKATHON_PLAN.md for the full architecture and sprint plan.
 */

import { AGENT_CONFIG } from "./lib/config.js";
import { cmcClient } from "./lib/cmc-client.js";
import { twakExecutor } from "./lib/twak-executor.js";
import { guardrails } from "./lib/risk-guardrails.js";

import {
  computeSubjectHash,
  computeThesisHash,
  getBscExplorerTxUrl,
  createMantleWalletClient,
  anchorToMantleContract,
} from "./lib/mantle.js";
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
  walletAddress: string | null;
  isTestnet: boolean;
}> {
  console.log("\n── Startup Health Check ──");

  const [twakHealth, cmcHealth] = await Promise.all([
    twakExecutor.healthCheck(),
    cmcClient.healthCheck(),
  ]);

  console.log(`  TWAK:      ${twakHealth.available ? "✓" : "○"} (${twakHealth.mode})`);
  console.log(`  CMC MCP:   ${cmcHealth ? "✓" : "○"} (${cmcHealth ? "connected" : "unavailable — using cached/stub data"})`);

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
    walletAddress: twakHealth.agentAddress ?? null,
    isTestnet: twakHealth.testnet,
  };
}

// =============================================================================
// Main Loop - Step 1: Fetch Market Data
// =============================================================================

async function fetchMarketData(): Promise<void> {
  console.log("\n[1/6] Fetching market data from CMC Agent Hub...");

  const marketData = await cmcClient.fetchMarketData();

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

  const convictionSignals = (md?.tokenPrices ?? []).map((t) =>
    scoreTokenConviction(t, regime)
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
 * ordinary drawdown — "early, not wrong"), or EXIT to cap a loss / lock the
 * asymmetry of a position that has already run. We never take profit early.
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
      tokenOut: "USDC",
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
    tokenOut: "USDC",
    amountIn: pos.amountUsd.toString(),
    slippageBps: AGENT_CONFIG.trading.defaultSlippageBps,
  });

  if (result.success) {
    state.executedTrades.push(result);
    state.totalTrades += 1;
    guardrails.recordTrade(pos.amountUsd, true);
    return true;
  }
  return false;
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
  const PROPOSAL_CONCENTRATION_PERCENT = 15;
  const SAFETY_MARGIN = 0.9;
  const ADAPTIVE_DECAY = 0.8;

  const basePerTrade = Math.min(
    AGENT_CONFIG.trading.maxPerTradeUsd,
    portfolioValue * (PROPOSAL_CONCENTRATION_PERCENT / 100)
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

async function executeTrades(
  proposals: Array<{ tokenSymbol: string; convictionScore: number; amountInUsd: number }>
): Promise<SwapResult[]> {
  console.log(`\n[7/8] Executing ${proposals.length} entries via TWAK...`);

  const priceMap = buildPriceMap();
  const results: SwapResult[] = [];

  for (const proposal of proposals) {
    console.log(`  → Swapping $${proposal.amountInUsd} BNB → ${proposal.tokenSymbol} (conviction: ${proposal.convictionScore})`);

    // Retry loop: up to 3 total attempts (1 initial + 2 retries) on network errors
    const MAX_RETRIES = 2;
    let result: SwapResult | null = null;
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
          amountIn: proposal.amountInUsd.toString(),
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

    // If all retries threw, synthesize a failure result
    if (!result) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      console.log(`    ✗ All ${MAX_RETRIES + 1} attempts failed. Last error: ${message}`);
      result = {
        success: false,
        error: `All retries exhausted: ${message}`,
        tokenIn: "BNB",
        tokenOut: proposal.tokenSymbol,
        amountIn: proposal.amountInUsd.toString(),
        amountOut: "0",
        timestamp: Date.now(),
      };
    }

    if (result.success) {
      console.log(`    ✓ Trade executed${result.txHash ? ` — ${getBscExplorerTxUrl(result.txHash, true)}` : ""}`);
      guardrails.recordTrade(proposal.amountInUsd, true);
      guardrails.updatePeakValue(state.portfolio?.totalValueUsd ?? proposal.amountInUsd * 3);

      // Open a conviction position so we can hold it through drawdown next cycle.
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

  // Try to create a Mantle wallet client from the operator key.
  // If the key is not set, we're in simulator mode — just log the payload.
  const walletClient = createMantleWalletClient();

  if (walletClient) {
    console.log(`  Contract: ${AGENT_CONFIG.mantle.sepolia.registryAddress} on Mantle Sepolia`);
    console.log(`  Wallet:   ${walletClient.account.address.slice(0, 10)}...${walletClient.account.address.slice(-4)}`);

    // Retry loop: up to 3 total attempts (1 initial + 2 retries)
    const MAX_RETRIES = 2;
    let lastError: unknown;
    let succeeded = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`  Retry #${attempt}/${MAX_RETRIES}...`);
        // Brief back-off before retry: 1s, then 2s
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }

      try {
        const result = await anchorToMantleContract(walletClient, {
          subjectHash,
          thesisHash,
          convictionScore: regimeScore,
          archetype: sentimentLabel,
        });

        if (result.status === "success") {
          console.log(`  ✓ Transaction confirmed!`);
          console.log(`  Tx hash:    ${result.txHash}`);
          console.log(`  Block:      ${result.blockNumber.toString()}`);
          console.log(`  Gas used:   ${result.gasUsed.toString()}`);
          console.log(`  Explorer:   ${result.explorerUrl}`);
          console.log(`  Anchored on-chain ✓`);

          state.lastAnchoredHash = result.txHash;
          state.anchoring = {
            hash: result.txHash,
            mode: "on-chain",
            blockNumber: Number(result.blockNumber),
            gasUsed: result.gasUsed.toString(),
          };
          succeeded = true;
          break;
        } else {
          console.log(`  ⚠ Transaction reverted!`);
          console.log(`  Tx hash:    ${result.txHash}`);
          console.log(`  Block:      ${result.blockNumber.toString()}`);
          console.log(`  Explorer:   ${result.explorerUrl}`);
          console.log(`  Falling back to off-chain logging.`);

          state.lastAnchoredHash = thesisHash;
          state.anchoring = {
            hash: result.txHash,
            mode: "reverted",
            blockNumber: Number(result.blockNumber),
            gasUsed: result.gasUsed.toString(),
          };
          succeeded = true;
          break;
        }
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${message}`);
      }
    }

    if (!succeeded) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      console.log(`  All ${MAX_RETRIES + 1} attempts failed. Last error: ${message}`);
      console.log(`  Falling back to off-chain logging.`);

      console.log(`  Off-chain thesis: ${thesisHash.slice(0, 18)}...`);
      console.log(`  Score: ${regimeScore}/100 | Archetype: ${sentimentLabel}`);

      state.lastAnchoredHash = thesisHash;
      state.anchoring = {
        hash: thesisHash,
        mode: "off-chain",
      };
    }
  } else {
    // Simulator mode — no operator key configured
    console.log(`  ○ Simulator mode — no MANTLE_OPERATOR_KEY set`);
    console.log(`  Anchoring payload (not submitted):`);
    console.log(`    Registry: ${AGENT_CONFIG.mantle.sepolia.registryAddress}`);
    console.log(`    Score:    ${regimeScore}/100 (${sentimentLabel})`);
    console.log(`    Held:     ${heldCount} positions (${heldThroughDrawdown} weathered drawdown)`);
    console.log(`    Thesis hash: ${thesisHash.slice(0, 18)}...`);

    state.lastAnchoredHash = thesisHash;
    state.anchoring = {
      hash: thesisHash,
      mode: "simulator",
    };
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

  console.log(`\n═══════════════════════════════════════`);
  console.log(`  CYCLE #${state.cycle} — ${new Date().toISOString()}`);
  console.log(`═══════════════════════════════════════`);

  try {
    // Step 1: Fetch portfolio from TWAK
    state.portfolio = await twakExecutor.getPortfolio();
    console.log(`\n[1/8] Portfolio: $${state.portfolio.totalValueUsd.toFixed(2)} across ${state.portfolio.positions.length} positions`);

    // Step 2: Fetch market data from CMC
    await fetchMarketData();

    // Step 3: Score market regime + token conviction (contrarian)
    const { regime, convictionSignals } = await analyzeConviction();

    // Step 4: Manage open positions — cap losses, let winners run
    await manageOpenPositions();

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

    state.status = "idle";
    state.nextRunAt = Date.now() + AGENT_CONFIG.trading.loopIntervalMinutes * 60 * 1000;

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
    errors: state.errors,
    marketData: state.marketData,
    executedTrades: state.executedTrades,
    lastAnchoredHash: state.lastAnchoredHash,
    anchoring: state.anchoring,
    marketRegime: state.marketRegime,
    convictionSignals: state.convictionSignals,
    heldPositions: state.heldPositions,
    positionVerdicts: state.positionVerdicts,
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
  console.log(`Interval: ${AGENT_CONFIG.trading.loopIntervalMinutes} minutes`);
  console.log(`Max drawdown: ${AGENT_CONFIG.trading.maxDrawdownPercent}%`);
  console.log(`Eligible tokens: ${AGENT_CONFIG.competition.eligibleTokens.length}`);
  console.log(`Default slippage: ${AGENT_CONFIG.trading.defaultSlippageBps} bps`);

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

  // Schedule subsequent cycles with error isolation
  // Each cycle runs independently — a failure in one cycle does not
  // prevent subsequent cycles from executing.
  const intervalMs = AGENT_CONFIG.trading.loopIntervalMinutes * 60 * 1000;
  console.log(`\nNext cycle scheduled in ${AGENT_CONFIG.trading.loopIntervalMinutes} minutes (${new Date(Date.now() + intervalMs).toISOString()})`);
  setInterval(() => {
    // Error isolation: wrap the entire cycle in a try/catch so that
    // an unhandled rejection in one cycle doesn't crash the timer.
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
        // Ensure the server still reports the latest known state
        try {
          syncServerState();
        } catch { /* ignore */ }
      });
  }, intervalMs);

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
