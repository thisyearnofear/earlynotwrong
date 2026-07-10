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
import { holderGrowthFraction } from "./holders.js";
import type {
  TokenQuote,
  GlobalMetrics,
  DerivativesMetrics,
} from "./data-providers.js";

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
  /** SSI index confirmation in [−1, +1]. >0 = indices corroborate fear. null when unavailable. */
  ssiConfirmation: number | null;
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
  derivatives: DerivativesMetrics | null,
  ssiConfirmation: number | null = null,
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

  // SoSoValue SSI index confirmation in [−1, +1] is mapped onto the same
  // 0–100 contrarian axis (50 = neutral). When indices contradict the FGI
  // signal it pulls the regime back toward neutral instead of agreeing
  // blindly with sentiment.
  const ssiContrarian =
    ssiConfirmation === null ? 50 : Math.round(50 + ssiConfirmation * 50);

  // Reweight: 55% FGI · 25% funding · 20% SSI when SSI is available; otherwise
  // fall back to the original 70/30 split so behaviour is unchanged offline.
  const score =
    ssiConfirmation === null
      ? Math.round(fgiContrarian * 0.7 + fundingContrarian * 0.3)
      : Math.round(fgiContrarian * 0.55 + fundingContrarian * 0.25 + ssiContrarian * 0.2);

  const label =
    score >= 80 ? "DEEP FEAR — PRIME CONTRARIAN" :
    score >= 60 ? "FEAR — FAVORABLE ENTRY" :
    score >= 45 ? "NEUTRAL — SELECTIVE" :
    score >= 30 ? "GREED — CAUTION" :
    "EUPHORIA — DEFENSIVE";

  return {
    score,
    label,
    fearGreedIndex: fgi,
    fearLevel: classifyFear(fgi),
    ssiConfirmation,
  };
}

// =============================================================================
// Token Conviction (entry signal)
// =============================================================================

export interface SignalWeights {
  contrarian: number;
  rsi: number;
  quality: number;
  regime: number;
  holders: number;
  volatilityPenaltyMax: number;
  newsMax: number;
}

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
    /** SoSoValue news sentiment adjustment (signed, ±newsMax). */
    news: number;
  };
  /** Active signal weights for this regime — surfaced for transparency. */
  weights: SignalWeights;
  /** Holder count from BscScan, or null if unavailable. */
  holderCount: number | null;
  /** Holder growth % over the lookback window, or null if history too short. */
  holderGrowthPercent: number | null;
  /** Net news sentiment in [−1, +1], or null if no related news in this cycle. */
  newsSentiment: number | null;
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
 * NOTE: this is a pure function of the same 7d return the contrarian factor
 * already scores — it adds no independent information. scoreTokenConviction
 * therefore awards the synthesized fallback only HALF the RSI weight; real
 * RSI(14) from klines keeps full weight.
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
 * Measures how far the last 24h deviates from the smooth 7d path: a 7d move
 * spread evenly implies ~(7d/7)% per day, so the erraticism is the gap
 * between the actual 24h move and that implied daily drift. A clean −40%/7d
 * decline moving ~−5.7% a day scores ~0 — that smooth dip is exactly the
 * "early" trade we want. A token down 40% over 7d but up 15% in the last
 * 24h has a choppy, bouncing path — "early" here is indistinguishable from
 * a falling knife that's bouncing. We penalize it.
 *
 * Clamped to [0, 1]; scaled by 20pp → a 20pp deviation from the implied
 * daily drift is the maximum penalty.
 */
export function volatilityPenaltyFraction(
  percentChange7d: number,
  percentChange24h: number
): number {
  const erraticism = Math.abs(percentChange24h - percentChange7d / 7) / 20;
  return Math.max(0, Math.min(1, erraticism));
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
 * Compute regime-adaptive signal weights.
 *
 * In deep fear we lean into contrarian entries and accept more volatility;
 * in euphoria we get defensive and only buy high-quality dips. The base
 * weights from config are shifted, never inverted below zero.
 */
export function computeAdaptiveWeights(regime: MarketRegime): SignalWeights {
  const base = AGENT_CONFIG.signal;
  const score = regime.score;

  const adjustments: Partial<SignalWeights> = {};

  if (score >= 80) {
    // Deep fear: greedy for dips, volatility is just noise, holders matter.
    adjustments.contrarian = 5;
    adjustments.regime = 5;
    adjustments.quality = -3;
    adjustments.holders = 2;
    adjustments.volatilityPenaltyMax = 3;
  } else if (score >= 60) {
    // Fear: slight tilt toward contrarian opportunities.
    adjustments.contrarian = 3;
    adjustments.regime = 3;
    adjustments.quality = -2;
  } else if (score >= 45) {
    // Neutral: quality becomes the differentiator.
    adjustments.quality = 3;
    adjustments.contrarian = -2;
    adjustments.rsi = -1;
  } else if (score >= 30) {
    // Greed: only high-quality, liquid dips; penalize chop harder.
    adjustments.quality = 5;
    adjustments.contrarian = -5;
    adjustments.holders = -2;
    adjustments.volatilityPenaltyMax = 5;
  } else {
    // Euphoria: defensive — quality over everything, avoid risky early entries.
    adjustments.contrarian = -10;
    adjustments.quality = 8;
    adjustments.regime = -5;
    adjustments.holders = -3;
    adjustments.newsMax = -3;
  }

  return {
    contrarian: Math.max(0, base.contrarian + (adjustments.contrarian ?? 0)),
    rsi: Math.max(0, base.rsi + (adjustments.rsi ?? 0)),
    quality: Math.max(0, base.quality + (adjustments.quality ?? 0)),
    regime: Math.max(0, base.regime + (adjustments.regime ?? 0)),
    holders: Math.max(0, base.holders + (adjustments.holders ?? 0)),
    volatilityPenaltyMax: Math.max(0, base.volatilityPenaltyMax + (adjustments.volatilityPenaltyMax ?? 0)),
    newsMax: Math.max(0, base.newsMax + (adjustments.newsMax ?? 0)),
  };
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
  holderMetric?: { count: number; growthPercent: number | null },
  newsSentiment?: number | null,
  rsi14?: number | null,
): ConvictionSignal {
  const w = computeAdaptiveWeights(regime);

  const contrarian = contrarianFraction(token.percentChange7d) * w.contrarian;

  // Real RSI(14) earns the full weight. The synthesized fallback derives from
  // the same 7d return the contrarian factor already scores — full weight
  // would double-count one input — so it only earns half weight (reduced
  // confidence in a non-independent signal).
  const hasRealRsi = rsi14 != null;
  const rsi = hasRealRsi ? rsi14 : synthesizeRsi7d(token.percentChange7d);
  const rsiBonus = rsiTimingFraction(rsi) * w.rsi * (hasRealRsi ? 1 : 0.5);

  const quality = qualityFraction(token) * w.quality;
  const regimeComponent = (regime.score / 100) * w.regime;

  const growthFraction = holderGrowthFraction(holderMetric?.growthPercent ?? null);
  const holderBonus =
    growthFraction === null ? 0 : growthFraction * w.holders;

  const volPenalty =
    volatilityPenaltyFraction(token.percentChange7d, token.percentChange24h) *
    w.volatilityPenaltyMax;

  // News sentiment is a signed adjustment in ±w.newsMax. We treat absent
  // coverage (null) as 0 so quiet tokens neither benefit nor get penalised.
  const newsAdj =
    newsSentiment == null
      ? 0
      : Math.max(-1, Math.min(1, newsSentiment)) * w.newsMax;

  const raw =
    contrarian + rsiBonus + quality + regimeComponent + holderBonus - volPenalty + newsAdj;
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
  const newsText =
    newsSentiment == null || Math.abs(newsAdj) < 1
      ? ""
      : newsAdj > 0
        ? ` · news ${newsAdj > 0 ? "+" : ""}${Math.round(newsAdj)}`
        : ` · news ${Math.round(newsAdj)}`;
  const rationale = `${dipText}${rsiText} · ${regime.fearLevel.replace("-", " ")} regime · ${
    quality >= w.quality * 0.6 ? "deep" : quality >= w.quality * 0.3 ? "ok" : "thin"
  } liquidity${holderText}${volText}${newsText}`;

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
      news: Math.round(newsAdj),
    },
    weights: w,
    holderCount: holderMetric?.count ?? null,
    holderGrowthPercent: holderMetric?.growthPercent ?? null,
    newsSentiment: newsSentiment ?? null,
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
  /** Number of consecutive failed exit attempts. */
  failedExitAttempts: number;
  /** True if the position has been marked un-exitable (honeypot/broken token). */
  stuck: boolean;
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
    failedExitAttempts: 0,
    stuck: false,
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

/** Max failed exit attempts before a position is marked stuck. */
export const STUCK_AFTER_FAILED_ATTEMPTS = 2;

/**
 * Decide what to do with a held position.
 *
 * Exit rules (tiered):
 *   1. Stop hit — down past stopLossPercent: thesis invalidated, cap the loss.
 *   2. Partial profit — at +50% CURRENT gain, sell 33% (take chips off, recycle
 *      capital). Fires once per position (tracked by partialProfitTaken flag).
 *   3. Trailing stop — only AFTER a large run (+100% peak), give back
 *      trailingStopPercent from the peak: lock the asymmetry we earned.
 * Everything else is HOLD. We never sell into ordinary drawdown.
 */
export function evaluatePosition(
  pos: HeldPosition,
  currentPriceUsd: number
): PositionVerdict {
  if (pos.stuck) {
    return {
      symbol: pos.symbol,
      action: "HOLD",
      unrealizedPnLPercent: round1(
        pos.entryPriceUsd > 0
          ? ((currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100
          : 0
      ),
      drawdownFromPeakPercent: round1(
        pos.peakPriceUsd > 0
          ? ((pos.peakPriceUsd - currentPriceUsd) / pos.peakPriceUsd) * 100
          : 0
      ),
      reason: `Position marked stuck after ${pos.failedExitAttempts} failed exits — no further exit attempts`,
      heldThroughDrawdown: pos.maxUnderwaterPercent >= 15,
      sellFraction: 0,
    };
  }

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

  // Tiered profit-taking: sell 33% at +50% CURRENT gain (once per position).
  // Gating on the live pnl — not the peak — matters at a 4h cadence: a token
  // can peak +55% intra-cycle and be back at −10% by evaluation, and selling
  // there is realizing a loss while calling it profit-taking.
  if (!pos.partialProfitTaken && pnl >= t.partialProfitGainPercent) {
    return {
      symbol: pos.symbol,
      action: "EXIT_PARTIAL",
      unrealizedPnLPercent: round1(pnl),
      drawdownFromPeakPercent: round1(drawdownFromPeak),
      reason: `Up ${pnl.toFixed(0)}% — taking 33% profit, letting the rest ride`,
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
