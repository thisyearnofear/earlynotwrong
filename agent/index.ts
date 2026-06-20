/**
 * Early, Not Wrong — Conviction-Weighted Copy-Trader Agent
 *
 * Main entry point. Orchestrates the autonomous trading loop:
 *   CMC Data → Conviction Scoring → Guardrails → TWAK Execution → Mantle Anchoring
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
import type { CmcMarketData, TokenQuote } from "./lib/cmc-client.js";
import type { SwapResult, TwakPortfolio } from "./lib/twak-executor.js";
import type { GuardrailResult } from "./lib/risk-guardrails.js";
import type { ConvictionMetrics } from "./lib/types.js";
import { setAgentState, startServer } from "./src/server.js";
import {
  sendCycleSummary,
  sendStartup,
  sendErrorAlert,
} from "./lib/telegram.js";
import { summarizeError, isRecoverable } from "./lib/errors.js";
import { AGENT_MODE } from "./lib/config.js";
import { persistState } from "./lib/persistence.js";

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

  const guardrailStatus = guardrails.getStatus(10000);
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
// Main Loop - Step 2: Score Market Regime
// =============================================================================

async function scoreMarketRegime(): Promise<{
  regimeScore: number;
  sentimentLabel: string;
  convictionScores: ConvictionMetrics[];
}> {
  console.log("\n[2/6] Scoring market regime and token conviction...");

  const md = state.marketData;
  const regimeScores: number[] = [];

  // Factor 1: Fear & Greed (0–100 → conviction score 0–20)
  if (md?.globalMetrics) {
    const fgi = md.globalMetrics.fearGreedIndex;
    // Extreme fear → higher conviction (contrarian opportunity)
    // Extreme greed → lower conviction (overheated)
    const fgiScore = fgi <= 20 ? 18 : fgi <= 40 ? 14 : fgi <= 60 ? 10 : fgi <= 80 ? 6 : 3;
    regimeScores.push(fgiScore);
    console.log(`  FGI contribution: ${fgiScore}/20 (FGI=${fgi})`);
  }

  // Factor 2: Funding rates (negative = bullish, positive = bearish)
  if (md?.derivatives) {
    const btcFundingScore = md.derivatives.btcFundingRate < -0.01 ? 15 : md.derivatives.btcFundingRate < 0 ? 12 : md.derivatives.btcFundingRate < 0.01 ? 8 : 4;
    const ethFundingScore = md.derivatives.ethFundingRate < -0.01 ? 15 : md.derivatives.ethFundingRate < 0 ? 12 : md.derivatives.ethFundingRate < 0.01 ? 8 : 4;
    regimeScores.push(Math.round((btcFundingScore + ethFundingScore) / 2));
    console.log(`  Funding contribution: ${Math.round((btcFundingScore + ethFundingScore) / 2)}/15`);
  }

  // Factor 3: Token price momentum
  if (md?.tokenPrices && md.tokenPrices.length > 0) {
    const positiveMomentum = md.tokenPrices.filter(t => t.percentChange24h > 0).length;
    const momentumRatio = positiveMomentum / md.tokenPrices.length;
    const momentumScore = Math.round(momentumRatio * 15);
    regimeScores.push(momentumScore);
    console.log(`  Momentum contribution: ${momentumScore}/15 (${positiveMomentum}/${md.tokenPrices.length} tokens positive)`);
  }

  // Compute final regime score
  const regimeScore = regimeScores.length > 0
    ? Math.round(regimeScores.reduce((a, b) => a + b, 0) / Math.max(1, regimeScores.length) * AGENT_CONFIG.trading.topK)
    : 0;

  const sentimentLabel =
    regimeScore >= 40 ? "HIGH CONVICTION" :
    regimeScore >= 25 ? "MODERATE CONVICTION" :
    regimeScore >= 15 ? "LOW CONVICTION" :
    "CAUTION";

  console.log(`  Regime score: ${regimeScore}/60 (${sentimentLabel})`);

  // Store on state for Telegram cycle summary and other consumers
  state.regimeScore = regimeScore;
  state.sentimentLabel = sentimentLabel;

  // Score individual tokens from price data
  const convictionScores: ConvictionMetrics[] = [];
  if (md?.tokenPrices) {
    for (const token of md.tokenPrices) {
      // Score each token based on price action
      const metrics: ConvictionMetrics = {
        score: scoreTokenConviction(token),
        patienceTax: 0,
        upsideCapture: Math.max(0, token.percentChange7d),
        earlyExits: 0,
        convictionWins: token.percentChange7d > 20 ? 1 : 0,
        percentile: 0,
        archetype: undefined,
        totalPositions: 0,
        avgHoldingPeriod: 0,
        winRate: token.percentChange24h > 0 ? 60 : 40,
      };
      convictionScores.push(metrics);
    }

    // Log top conviction tokens
    const topConviction = [...convictionScores]
      .map((m, i) => ({ ...m, symbol: md.tokenPrices[i]?.symbol ?? "???" }))
      .sort((a, b) => b.score - a.score)
      .slice(0, AGENT_CONFIG.trading.topK);
    console.log(`  Top conviction tokens: ${topConviction.map(t => `${t.symbol} (${t.score})`).join(", ")}`);
  }

  return { regimeScore, sentimentLabel, convictionScores };
}

/**
 * Score an individual token's conviction based on price action.
 */
function scoreTokenConviction(token: TokenQuote): number {
  const weights = AGENT_CONFIG.weights;

  // Normalize 24h change (-100% to +100%) → 0–1
  const momentum24h = Math.max(0, Math.min(1, (token.percentChange24h + 100) / 200));
  // Normalize 7d change
  const momentum7d = Math.max(0, Math.min(1, (token.percentChange7d + 100) / 200));
  // Volume signals interest
  const volumeScore = Math.min(1, token.volume24h / Math.max(1, token.marketCap) * 10);

  const rawScore =
    momentum24h * 40 +
    momentum7d * 30 +
    volumeScore * 30;

  return Math.round(Math.max(0, Math.min(100, rawScore)));
}

// =============================================================================
// Main Loop - Step 3: Create Trade Proposals
// =============================================================================

async function createTradeProposals(
  regimeScore: number,
  convictionScores: ConvictionMetrics[]
): Promise<Array<{
  tokenSymbol: string;
  convictionScore: number;
  amountInUsd: number;
}>> {
  console.log("\n[3/6] Creating trade proposals...");

  const portfolio = state.portfolio;
  const portfolioValue = portfolio?.totalValueUsd ?? AGENT_CONFIG.trading.maxPerTradeUsd * 3;

  // Sort tokens by conviction score and take top-K
  const scoredTokens = (state.marketData?.tokenPrices ?? [])
    .map((token, i) => ({
      token,
      conviction: convictionScores[i]?.score ?? 0,
    }))
    .filter(t => t.conviction >= AGENT_CONFIG.trading.minConvictionScore)
    .sort((a, b) => b.conviction - a.conviction);

  if (scoredTokens.length === 0) {
    console.log("  No tokens meet the minimum conviction threshold. Skipping trading this cycle.");
    return [];
  }

  // Select top-K tokens
  const selected = scoredTokens.slice(0, AGENT_CONFIG.trading.topK);

  // Size each position: evenly split the per-trade budget
  const perTradeUsd = Math.min(
    AGENT_CONFIG.trading.maxPerTradeUsd,
    portfolioValue * (AGENT_CONFIG.trading.maxPositionConcentrationPercent / 100)
  );

  const proposals = selected.map(s => ({
    tokenSymbol: s.token.symbol,
    convictionScore: s.conviction,
    amountInUsd: Math.round(perTradeUsd),
  }));

  console.log(`  Proposals: ${proposals.map(p => `${p.tokenSymbol} $${p.amountInUsd} (score: ${p.convictionScore})`).join(", ")}`);
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
  console.log("\n[4/6] Checking risk guardrails...");

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
      tokenIn: "USDC",     // Always swap from USDC (stable)
      tokenOut: proposal.tokenSymbol,
      amountInUsd: proposal.amountInUsd,
      expectedAmountOut: 0,
      convictionScore: proposal.convictionScore,
      portfolioValue,
    });

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
// Main Loop - Step 5: Execute Trades
// =============================================================================

async function executeTrades(
  proposals: Array<{ tokenSymbol: string; convictionScore: number; amountInUsd: number }>
): Promise<SwapResult[]> {
  console.log(`\n[5/6] Executing ${proposals.length} trades via TWAK...`);

  const results: SwapResult[] = [];

  for (const proposal of proposals) {
    console.log(`  → Swapping $${proposal.amountInUsd} USDC → ${proposal.tokenSymbol} (conviction: ${proposal.convictionScore})`);

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
          tokenIn: "USDC",
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
        tokenIn: "USDC",
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
    } else {
      console.log(`    ✗ Trade failed: ${result.error}`);
      guardrails.recordTrade(proposal.amountInUsd, false);
    }

    results.push(result);
  }

  state.executedTrades = results;
  state.totalTrades += results.filter(r => r.success).length;
  state.totalVolumeUsd += results.filter(r => r.success).reduce((sum, r) => sum + parseFloat(r.amountIn), 0);

  const successful = results.filter(r => r.success).length;
  console.log(`  ${successful}/${proposals.length} trades succeeded`);

  return results;
}

// =============================================================================
// Main Loop - Step 6: Anchor to Mantle
// =============================================================================

async function anchorToMantle(
  regimeScore: number,
  sentimentLabel: string
): Promise<void> {
  console.log("\n[6/6] Anchoring analysis to Mantle ERC-8004 registry...");

  const metrics = {
    score: regimeScore,
    patienceTax: 0,
    upsideCapture: 0,
    archetype: sentimentLabel,
    totalPositions: state.executedTrades.length,
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
      console.log(`  Score: ${regimeScore}/60 | Archetype: ${sentimentLabel}`);

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
    console.log(`    Score:    ${regimeScore}/60`);
    console.log(`    Archetype: ${sentimentLabel}`);
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

  // Reset cycle-local state
  state.guardrailResults = [];
  state.executedTrades = [];
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
    console.log(`  Portfolio: $${state.portfolio.totalValueUsd.toFixed(2)} across ${state.portfolio.positions.length} positions`);

    // Step 2: Fetch market data from CMC
    await fetchMarketData();

    // Step 3: Score market regime and token conviction
    const { regimeScore, sentimentLabel, convictionScores } = await scoreMarketRegime();

    // Step 4: Create trade proposals from conviction scores
    const proposals = await createTradeProposals(regimeScore, convictionScores);

    // If no proposals, skip to anchoring
    if (proposals.length === 0) {
      console.log("\n  No qualifying trade proposals this cycle.");
      await anchorToMantle(regimeScore, sentimentLabel);
      state.status = "idle";
      state.nextRunAt = Date.now() + AGENT_CONFIG.trading.loopIntervalMinutes * 60 * 1000;
      printCycleSummary(cycleStart);

      // Send cycle summary to Telegram (non-blocking, skip if not configured)
      const elapsedEarly = ((Date.now() - cycleStart) / 1000).toFixed(1);
      sendCycleSummary({
        cycle: state.cycle,
        duration: `${elapsedEarly}s`,
        status: state.status,
        tradesSucceeded: 0,
        tradesFailed: 0,
        totalVolumeUsd: state.totalVolumeUsd,
        portfolioValueUsd: state.portfolio?.totalValueUsd ?? 0,
        drawdownPercent: state.portfolio
          ? guardrails.getStatus(state.portfolio.totalValueUsd).drawdownPercent
          : 0,
        regimeScore: state.regimeScore,
        sentimentLabel: state.sentimentLabel,
        anchoring: state.anchoring,
        executedTrades: [],
        errors: state.errors,
      }).catch(() => {});

      return;
    }

    // Step 5: Check guardrails
    const { passed, rejected } = await checkTradeGuardrails(proposals);

    // Step 6: Execute passed trades
    if (passed.length > 0) {
      await executeTrades(passed);
    } else {
      console.log("\n[5/6] No trades passed guardrails. Skipping execution.");
    }

    // Step 7: Anchor analysis to Mantle
    await anchorToMantle(regimeScore, sentimentLabel);

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
// Startup
// =============================================================================

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

  // Start the HTTP server (serves /status, /trades, /conviction on port 3000)
  const server = startServer(3000);
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
