/**
 * Conviction Signal Engine
 *
 * The trading brain of "Early, Not Wrong" — and the single source of truth for
 * how the agent decides what to buy and when to sell.
 *
 * The thesis is behavioral, not predictive:
 *   - Being early feels like being wrong. We reward CONTRARIAN entries
 *     (quality assets that are *down* during fear) — never momentum/chasing.
 *   - The expensive mistake is selling winners too early. We HOLD through
 *     ordinary drawdown and only exit to CAP a loss (thesis invalidated) or to
 *     trail a position that has already run far enough that locking the
 *     asymmetry is no longer "early".
 *
 * Pure functions, no I/O — fully testable in isolation.
 */

import { AGENT_CONFIG } from "./config.js";
import { holderGrowthFraction } from "./holder-growth.js";
import type {
  TokenQuote,
  GlobalMetrics,
  DerivativesMetrics,
} from "./cmc-client.js";

// =============================================================================
// Market Regime (contrarian)
// =============================================================================

export type FearLevel =
  | "extreme-fear"
  | "fear"
  | "neutral"
  | "greed"
  | "extreme-greed"
  | "unknown";

export interface MarketRegime {
  /** 0–100 contrarian opportunity score (higher = more fear = better to enter). */
  score: number;
  /** Human-readable regime label. */
  label: string;
  fearGreedIndex: number | null;
  fearLevel: FearLevel;
}

function classifyFear(fgi: number | null): FearLevel {
  if (fgi === null) return "unknown";
  if (fgi <= 20) return "extreme-fear";
  if (fgi <= 40) return "fear";
  if (fgi <= 60) return "neutral";
  if (fgi <= 80) return "greed";
  return "extreme-greed";
}

/**
 * Score the market regime from a CONTRARIAN lens.
 *
 * Extreme fear and negative funding (the crowd positioned bearish) are the
 * conditions under which being "early" pays — so they score highest.
 */
export function scoreMarketRegime(
  global: GlobalMetrics | null,
  derivatives: DerivativesMetrics | null
): MarketRegime {
  const fgi = global?.fearGreedIndex ?? null;

  // Fear & Greed → contrarian score (0–100). Fear is opportunity.
  const fgiContrarian =
    fgi === null ? 50 :
    fgi <= 20 ? 100 :
    fgi <= 40 ? 75 :
    fgi <= 60 ? 50 :
    fgi <= 80 ? 25 :
    10;

  // Funding → contrarian score (0–100). Negative funding = crowd is short /
  // longs are being paid = contrarian-bullish. Frothy positive funding = caution.
  let fundingContrarian = 50;
  if (derivatives) {
    const avgFunding =
      (derivatives.btcFundingRate + derivatives.ethFundingRate) / 2;
    fundingContrarian =
      avgFunding < -0.01 ? 100 :
      avgFunding < 0 ? 75 :
      avgFunding < 0.01 ? 50 :
      avgFunding < 0.05 ? 30 :
      15;
  }

  const score = Math.round(fgiContrarian * 0.7 + fundingContrarian * 0.3);

  const label =
    score >= 80 ? "DEEP FEAR — PRIME CONTRARIAN" :
    score >= 60 ? "FEAR — FAVORABLE ENTRY" :
    score >= 45 ? "NEUTRAL — SELECTIVE" :
    score >= 30 ? "GREED — CAUTION" :
    "EUPHORIA — DEFENSIVE";

  return { score, label, fearGreedIndex: fgi, fearLevel: classifyFear(fgi) };
}

// =============================================================================
// Token Conviction (entry signal)
// =============================================================================

export interface ConvictionSignal {
  symbol: string;
  /** 0–100 conviction to OPEN a position. */
  score: number;
  breakdown: {
    contrarian: number;
    rsi: number;
    quality: number;
    regime: number;
    /** On-chain accumulation bonus. 0 when holder history is unavailable. */
    holders: number;
    /** Subtracted from the bonus total. Large value = erratic price path. */
    volatilityPenalty: number;
  };
  /** Holder count from BscScan, or null if unavailable. */
  holderCount: number | null;
  /** Holder growth % over the lookback window, or null if history too short. */
  holderGrowthPercent: number | null;
  /** Human-readable "why" for logs and the dashboard. */
  rationale: string;
}

/**
 * Synthesize an RSI-like timing score (0–100) from a single 7d return.
 *
 * True RSI needs a price history; CMC REST only gives us snapshot deltas.
 * We model the 7d return as N=7 daily moves and estimate the win fraction
 * `p` that would produce the observed cumulative return under a symmetric
 * ±2% daily volatility prior. RSI then collapses to 100·p.
 *
 * Sanity check:
 *   +14% over 7d  →  ~5 up days of 7  →  RSI ≈ 71  (overbought)
 *    0%           →  balanced          →  RSI = 50  (neutral)
 *   −25% over 7d  →  ~2 up days of 7  →  RSI ≈ 29  (oversold — our sweet spot)
 */
export function synthesizeRsi7d(percentChange7d: number): number {
  const N = 7;
  const typicalDailyMove = 0.02; // 2%
  const r = Math.max(-0.95, percentChange7d / 100);
  // N·(2p−1)·m ≈ r  ⟹  p = (r/(N·m) + 1) / 2
  const p = Math.max(0.02, Math.min(0.98, (r / (N * typicalDailyMove) + 1) / 2));
  return Math.round(p * 100);
}

/**
 * RSI timing fraction (0–1). Rewards oversold (RSI < 35), neutral in the
 * middle, penalizes overbought (RSI > 70). This is the *timing* layer on
 * top of the contrarian weakness signal.
 */
function rsiTimingFraction(rsi: number): number {
  if (rsi <= 25) return 1.0;    // deeply oversold — ideal entry
  if (rsi <= 35) return 0.85;   // oversold — favorable
  if (rsi <= 50) return 0.5;    // neutral-low
  if (rsi <= 65) return 0.25;   // neutral-high — no timing edge
  return 0;                     // overbought — not our trade
}

/**
 * Volatility penalty fraction (0–1).
 *
 * Uses the divergence between the 7d cumulative return and the 24h return
 * as a proxy for path erraticism. A token down 40% over 7d but up 15% in
 * the last 24h has a volatile, choppy path — "early" here is
 * indistinguishable from a falling knife that's bouncing. We penalize it.
 *
 * Capped at 1.0; scaled by 50pp → a 50pp divergence is the maximum penalty.
 */
export function volatilityPenaltyFraction(
  percentChange7d: number,
  percentChange24h: number
): number {
  const divergence = Math.abs(percentChange7d - percentChange24h);
  return Math.min(1, divergence / 50);
}

/**
 * Map a 7-day return to a contrarian fraction (0–1).
 *
 * The "early" sweet spot is meaningful weakness on a surviving asset
 * (roughly −15% to −50%). Chasing strength scores ~0. Capitulation past the
 * floor is treated as risk, not opportunity.
 */
function contrarianFraction(percentChange7d: number): number {
  const floor = AGENT_CONFIG.signal.capitulationFloorPercent; // e.g. -70
  const d = percentChange7d;

  if (d <= floor) return 0.15;                 // capitulation — likely dying, avoid
  if (d <= -50) {
    // -70 → -50 ramps 0.15 → 1.0 (deep value, getting risky)
    return 0.15 + ((d - floor) / (-50 - floor)) * (1.0 - 0.15);
  }
  if (d <= -15) return 1.0;                     // the early sweet spot
  if (d < 0) {
    // -15 → 0 ramps 1.0 → 0.4 (mild dip)
    return 0.4 + ((-d) / 15) * (1.0 - 0.4);
  }
  if (d <= 25) {
    // 0 → +25 ramps 0.4 → 0.0 (chasing, penalize)
    return Math.max(0, 0.4 * (1 - d / 25));
  }
  return 0; // full chase — not our trade
}

/**
 * Map liquidity & size to a quality fraction (0–1).
 *
 * Quality = capped downside + room to run: a real, liquid asset we can both
 * size into and exit. Turnover (volume / market cap) signals live interest;
 * absolute market cap signals survivability.
 */
function qualityFraction(token: TokenQuote): number {
  const mcap = Math.max(0, token.marketCap);
  const vol = Math.max(0, token.volume24h);
  if (mcap <= 0) return 0;

  // Turnover ratio — healthy daily liquidity sits roughly 2%–40% of mcap.
  const turnover = vol / mcap;
  const turnoverScore = Math.max(0, Math.min(1, turnover / 0.15));

  // Size — log-scaled between $10M (0) and $10B (1).
  const sizeScore = Math.max(
    0,
    Math.min(1, (Math.log10(mcap) - 7) / (10 - 7))
  );

  return turnoverScore * 0.5 + sizeScore * 0.5;
}

/**
 * Score a token's conviction to OPEN a position (0–100), contrarian by design.
 *
 *   score = contrarian + rsi + quality + regime + holders − volatilityPenalty
 *
 * The bonus components reward the thesis (weakness · oversold · liquid ·
 * fearful market · accumulating holders); the penalty discounts erratic
 * paths where "early" is indistinguishable from a falling knife.
 *
 * `holderMetric` is optional — when absent (no BscScan key or not enough
 * history), the holders component scores 0 and the rationale flags it.
 */
export function scoreTokenConviction(
  token: TokenQuote,
  regime: MarketRegime,
  holderMetric?: { count: number; growthPercent: number | null }
): ConvictionSignal {
  const w = AGENT_CONFIG.signal;

  const contrarian = contrarianFraction(token.percentChange7d) * w.contrarian;

  const rsi = synthesizeRsi7d(token.percentChange7d);
  const rsiBonus = rsiTimingFraction(rsi) * w.rsi;

  const quality = qualityFraction(token) * w.quality;
  const regimeComponent = (regime.score / 100) * w.regime;

  const growthFraction = holderGrowthFraction(holderMetric?.growthPercent ?? null);
  const holderBonus =
    growthFraction === null ? 0 : growthFraction * w.holders;

  const volPenalty =
    volatilityPenaltyFraction(token.percentChange7d, token.percentChange24h) *
    w.volatilityPenaltyMax;

  const raw =
    contrarian + rsiBonus + quality + regimeComponent + holderBonus - volPenalty;
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  const dip = token.percentChange7d;
  const dipText =
    dip <= -15 ? `down ${Math.abs(dip).toFixed(0)}% (early)` :
    dip < 0 ? `mild dip ${Math.abs(dip).toFixed(0)}%` :
    `up ${dip.toFixed(0)}% (chasing)`;
  const rsiText = rsi <= 35 ? ` · RSI ${rsi} oversold` : rsi >= 70 ? ` · RSI ${rsi} hot` : "";
  const holderText =
    !holderMetric ? "" :
    holderMetric.growthPercent === null ? ` · ${holderMetric.count.toLocaleString()} holders (no history)` :
    holderMetric.growthPercent >= 5 ? ` · +${holderMetric.growthPercent.toFixed(1)}% holders` :
    holderMetric.growthPercent <= -3 ? ` · ${holderMetric.growthPercent.toFixed(1)}% holders (fading)` :
    ` · ${holderMetric.growthPercent >= 0 ? "+" : ""}${holderMetric.growthPercent.toFixed(1)}% holders`;
  const volText = volPenalty >= w.volatilityPenaltyMax * 0.5 ? ` · erratic path (−${Math.round(volPenalty)})` : "";
  const rationale = `${dipText}${rsiText} · ${regime.fearLevel.replace("-", " ")} regime · ${
    quality >= w.quality * 0.6 ? "deep" : quality >= w.quality * 0.3 ? "ok" : "thin"
  } liquidity${holderText}${volText}`;

  return {
    symbol: token.symbol,
    score,
    breakdown: {
      contrarian: Math.round(contrarian),
      rsi: Math.round(rsiBonus),
      quality: Math.round(quality),
      regime: Math.round(regimeComponent),
      holders: Math.round(holderBonus),
      volatilityPenalty: Math.round(volPenalty),
    },
    holderCount: holderMetric?.count ?? null,
    holderGrowthPercent: holderMetric?.growthPercent ?? null,
    rationale,
  };
}

// =============================================================================
// Position Management (cap losses, let winners run)
// =============================================================================

export interface HeldPosition {
  symbol: string;
  /** Cost-basis price (USD) at entry. */
  entryPriceUsd: number;
  entryCycle: number;
  entryAt: number;
  /** USD cost basis. */
  amountUsd: number;
  /** Highest price seen since entry (for trailing logic). */
  peakPriceUsd: number;
  /** Worst drawdown from entry weathered while holding (>= 0). */
  maxUnderwaterPercent: number;
  cyclesHeld: number;
  /** True once the first partial profit (33% at +50%) has been taken. */
  partialProfitTaken: boolean;
}

export type PositionAction = "HOLD" | "EXIT_STOP" | "EXIT_TRAIL" | "EXIT_PARTIAL";

export interface PositionVerdict {
  symbol: string;
  action: PositionAction;
  unrealizedPnLPercent: number;
  drawdownFromPeakPercent: number;
  reason: string;
  /** True once the position has weathered a meaningful dip and is still open. */
  heldThroughDrawdown: boolean;
  /** Fraction of position to sell (1.0 = full exit, 0.33 = partial profit). */
  sellFraction: number;
}

/** Create a fresh held position from an executed entry. */
export function openPosition(params: {
  symbol: string;
  entryPriceUsd: number;
  amountUsd: number;
  cycle: number;
  now?: number;
}): HeldPosition {
  return {
    symbol: params.symbol,
    entryPriceUsd: params.entryPriceUsd,
    entryCycle: params.cycle,
    entryAt: params.now ?? Date.now(),
    amountUsd: params.amountUsd,
    peakPriceUsd: params.entryPriceUsd,
    maxUnderwaterPercent: 0,
    cyclesHeld: 0,
    partialProfitTaken: false,
  };
}

/**
 * Accrue one cycle of price history onto a held position (pure — returns a copy).
 * Updates the running peak, the worst drawdown weathered, and the hold counter.
 */
export function accruePosition(
  pos: HeldPosition,
  currentPriceUsd: number
): HeldPosition {
  if (currentPriceUsd <= 0) {
    return { ...pos, cyclesHeld: pos.cyclesHeld + 1 };
  }
  const underwater =
    pos.entryPriceUsd > 0
      ? ((pos.entryPriceUsd - currentPriceUsd) / pos.entryPriceUsd) * 100
      : 0;
  return {
    ...pos,
    peakPriceUsd: Math.max(pos.peakPriceUsd, currentPriceUsd),
    maxUnderwaterPercent: Math.max(pos.maxUnderwaterPercent, underwater),
    cyclesHeld: pos.cyclesHeld + 1,
  };
}

/**
 * Decide what to do with a held position.
 *
 * Exit rules (tiered):
 *   1. Stop hit — down past stopLossPercent: thesis invalidated, cap the loss.
 *   2. Partial profit — at +50% gain, sell 33% (take chips off, recycle capital).
 *      Fires once per position (tracked by partialProfitTaken flag).
 *   3. Trailing stop — only AFTER a large run (+100% peak), give back
 *      trailingStopPercent from the peak: lock the asymmetry we earned.
 * Everything else is HOLD. We never sell into ordinary drawdown.
 */
export function evaluatePosition(
  pos: HeldPosition,
  currentPriceUsd: number
): PositionVerdict {
  const t = AGENT_CONFIG.trading;
  const pnl =
    pos.entryPriceUsd > 0
      ? ((currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100
      : 0;
  const drawdownFromPeak =
    pos.peakPriceUsd > 0
      ? ((pos.peakPriceUsd - currentPriceUsd) / pos.peakPriceUsd) * 100
      : 0;
  const heldThroughDrawdown = pos.maxUnderwaterPercent >= 15;

  if (currentPriceUsd > 0 && pnl <= -t.stopLossPercent) {
    return {
      symbol: pos.symbol,
      action: "EXIT_STOP",
      unrealizedPnLPercent: round1(pnl),
      drawdownFromPeakPercent: round1(drawdownFromPeak),
      reason: `Stop hit: down ${Math.abs(pnl).toFixed(0)}% — thesis invalidated, capping loss`,
      heldThroughDrawdown,
      sellFraction: 1,
    };
  }

  const peakGain =
    pos.entryPriceUsd > 0
      ? ((pos.peakPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100
      : 0;

  // Tiered profit-taking: sell 33% at +50% gain (once per position).
  if (!pos.partialProfitTaken && peakGain >= t.partialProfitGainPercent) {
    return {
      symbol: pos.symbol,
      action: "EXIT_PARTIAL",
      unrealizedPnLPercent: round1(pnl),
      drawdownFromPeakPercent: round1(drawdownFromPeak),
      reason: `Up ${peakGain.toFixed(0)}% — taking 33% profit, letting the rest ride`,
      heldThroughDrawdown,
      sellFraction: 0.33,
    };
  }

  const trailingArmed = peakGain >= t.trailingActivationGainPercent;
  if (trailingArmed && drawdownFromPeak >= t.trailingStopPercent) {
    return {
      symbol: pos.symbol,
      action: "EXIT_TRAIL",
      unrealizedPnLPercent: round1(pnl),
      drawdownFromPeakPercent: round1(drawdownFromPeak),
      reason: `Up ${peakGain.toFixed(0)}% at peak, gave back ${drawdownFromPeak.toFixed(0)}% — locking asymmetry`,
      heldThroughDrawdown,
      sellFraction: 1,
    };
  }

  const reason =
    pnl < 0
      ? `Holding through ${Math.abs(pnl).toFixed(0)}% drawdown — thesis intact, this is "early"`
      : `Letting winner run (+${pnl.toFixed(0)}%) — no early exit`;

  return {
    symbol: pos.symbol,
    action: "HOLD",
    unrealizedPnLPercent: round1(pnl),
    drawdownFromPeakPercent: round1(drawdownFromPeak),
    reason,
    heldThroughDrawdown,
    sellFraction: 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
