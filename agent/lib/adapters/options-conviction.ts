/**
 * Options Conviction Factors Adapter
 *
 * Implements the harness ConvictionFactors interface for the "options" domain.
 * Maps the harness scoring concept (weighted factors, total 0–100) to
 * options-specific signals.
 *
 * Strategy: "IV edge + conviction overlay" — identify underliers where
 * implied vol is mispriced relative to the conviction score. The harness
 * detects mean-reverting IV extremes (high IV rank on fundamentally strong
 * underliers → sell premium; low IV rank on weak underliers → buy premium).
 *
 * Factor mapping (from the architecture plan):
 *   Crypto Factor        → Options Equivalent             Weight
 *   Contrarian (30)      → IV contrarian                   20
 *   RSI timing (10)      → Underlier RSI + delta            10
 *   Quality (20)         → Underlier liquidity/AUM          15
 *   Regime (20)          → VIX regime, market regime        15
 *   Holder growth (10)   → Open interest growth             10
 *   Vol penalty (−)      → Vanna/Charm decay risk            5
 *   (new)                → Gamma squeeze risk              10
 *   (new)                → Earnings vol crush timing        10
 *                                              Total:       100
 */

import type { ConvictionFactors } from "./conviction-factors.js";
import type {
  ConvictionResult,
  FactorDefinition,
  FactorScore,
  Kline,
  MarketSignal,
} from "./types.js";
import { AGENT_CONFIG } from "../config.js";

// =============================================================================
// Factor Weights (sum to 100)
// =============================================================================

export const OPTIONS_WEIGHTS = {
  ivContrarian: 20,
  rsiDelta: 10,
  quality: 20,
  regime: 15,
  openInterestGrowth: 10,
  vannaCharmPenalty: 5,
  gammaSqueezeRisk: 10,
  earningsVolCrush: 10,
} as const;

// =============================================================================
// Scoring Helpers
// =============================================================================

/** RSI(14) from klines — same algorithm as the crypto domain. */
function computeRsi(klines: Kline[], period: number = 14): number | null {
  if (klines.length < period + 1) return null;
  const closes = klines.map((k) => k.close);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

/**
 * IV contrarian fraction (0–1).
 *
 * Extreme IV rank on a mean-reverting underlier is the options equivalent
 * of a crypto contrarian dip. High IV → sell premium (IV will crush);
 * low IV → buy premium (IV will expand). We score the *extremeness*.
 */
function ivContrarianFraction(iv: number): number {
  if (iv <= 0) return 0;
  // IV is typically 0.1–2.0 (10%–200%). Extreme = > 0.8 or < 0.2.
  if (iv >= 1.0) return 1.0;  // extreme high IV — prime sell premium
  if (iv >= 0.6) return 0.85; // high IV — favorable
  if (iv >= 0.3) return 0.5;  // normal IV — neutral
  if (iv >= 0.15) return 0.75; // low IV — buy premium opportunity
  return 0.5; // very low IV — could be dead stock, neutral
}

/** RSI timing fraction — rewards oversold underliers for call premium buying. */
function rsiTimingFraction(rsi: number | null): number {
  if (rsi === null) return 0.5;
  if (rsi <= 30) return 1.0;  // oversold — good call entry
  if (rsi <= 45) return 0.75;
  if (rsi <= 55) return 0.5;   // neutral
  if (rsi <= 70) return 0.25;
  return 0;                    // overbought — avoid call entries
}

/** Quality fraction from volume (proxy for liquidity). */
function qualityFraction(volume24h: number, marketCap: number): number {
  // For options, marketCap is the underlier's mcap (if provided in metadata).
  const liquidity = Math.max(volume24h, marketCap);
  if (liquidity <= 0) return 0;
  if (liquidity >= 1e11) return 1.0; // $100B+ mega-cap
  if (liquidity >= 1e10) return 0.8;  // $10B+
  if (liquidity >= 1e9) return 0.6;   // $1B+
  if (liquidity >= 1e8) return 0.3;   // $100M+
  return 0.1;
}

/** Gamma squeeze risk fraction (0–1). High gamma = dangerous. */
function gammaSqueezeFraction(gamma: number): number {
  if (gamma <= 0) return 0;
  if (gamma >= 0.1) return 1.0;  // extreme gamma — squeeze risk
  if (gamma >= 0.05) return 0.7;
  if (gamma >= 0.01) return 0.4;
  return 0.1;
}

/** Vanna/Charm decay penalty fraction (0–1). High theta = fast decay. */
function vannaCharmFraction(theta: number): number {
  const absTheta = Math.abs(theta);
  if (absTheta >= 0.5) return 1.0;  // extreme decay
  if (absTheta >= 0.2) return 0.7;
  if (absTheta >= 0.05) return 0.4;
  return 0.1;
}

// =============================================================================
// Adapter
// =============================================================================

/**
 * Create an options-domain ConvictionFactors adapter.
 *
 * The scoring framework stays the same (weighted factors, total 0–100),
 * but the factors are options-specific: IV contrarian, RSI + delta sensitivity,
 * underlier quality, VIX regime, OI growth, gamma squeeze risk, vanna/charm
 * decay, and earnings vol crush timing.
 */
export function createOptionsConvictionAdapter(): ConvictionFactors {
  return {
    async score(signal: MarketSignal, historical: Kline[]): Promise<ConvictionResult> {
      const meta = signal.metadata ?? {};
      const iv = (meta.impliedVolatility as number) ?? 0;
      const delta = (meta.delta as number) ?? 0;
      const gamma = (meta.gamma as number) ?? 0;
      const theta = (meta.theta as number) ?? 0;
      const openInterest = (meta.openInterest as number) ?? 0;
      const volume = (meta.volume as number) ?? signal.volume24h;
      const contractType = (meta.contractType as string) ?? "call";

      // RSI from underlier historical klines.
      const rsi = computeRsi(historical);
      const rsiTiming = rsiTimingFraction(rsi);
      const ivFraction = ivContrarianFraction(iv);
      const qualityFrac = qualityFraction(volume, signal.marketCap);

      // Regime: use a neutral baseline (VIX would come from data source metadata).
      const vixLevel = (meta.vix as number) ?? 20;
      const regimeFraction =
        vixLevel >= 35 ? 1.0 : vixLevel >= 25 ? 0.7 : vixLevel >= 15 ? 0.5 : 0.3;

      // Open interest growth (proxy: high OI = active market = better fill).
      const oiFraction =
        openInterest >= 10000 ? 1.0 : openInterest >= 1000 ? 0.6 : openInterest >= 100 ? 0.3 : 0.1;

      const gammaRisk = gammaSqueezeFraction(gamma);
      const decayRisk = vannaCharmFraction(theta);
      const earningsNear = (meta.earningsNear as boolean) ?? false;
      const earningsFraction = earningsNear ? 1.0 : 0.3;

      const w = OPTIONS_WEIGHTS;
      const breakdown: FactorScore[] = [
        { name: "iv_contrarian", score: Math.round(ivFraction * w.ivContrarian), maxScore: w.ivContrarian,
          rationale: `IV=${iv.toFixed(3)} → ${iv >= 0.6 ? "sell premium" : iv <= 0.2 ? "buy premium" : "neutral"}` },
        { name: "rsi_delta", score: Math.round(rsiTiming * w.rsiDelta), maxScore: w.rsiDelta,
          rationale: `RSI=${rsi ?? "N/A"}, delta=${delta.toFixed(2)}` },
        { name: "quality", score: Math.round(qualityFrac * w.quality), maxScore: w.quality,
          rationale: `Volume=$${(volume / 1e6).toFixed(1)}M` },
        { name: "regime", score: Math.round(regimeFraction * w.regime), maxScore: w.regime,
          rationale: `VIX≈${vixLevel}` },
        { name: "open_interest_growth", score: Math.round(oiFraction * w.openInterestGrowth), maxScore: w.openInterestGrowth,
          rationale: `OI=${openInterest}` },
        { name: "vanna_charm_penalty", score: -Math.round(decayRisk * w.vannaCharmPenalty), maxScore: w.vannaCharmPenalty,
          rationale: `Theta=${theta.toFixed(2)} → decay risk` },
        { name: "gamma_squeeze_risk", score: -Math.round(gammaRisk * w.gammaSqueezeRisk), maxScore: w.gammaSqueezeRisk,
          rationale: `Gamma=${gamma.toFixed(3)} → squeeze risk` },
        { name: "earnings_vol_crush", score: Math.round(earningsFraction * w.earningsVolCrush), maxScore: w.earningsVolCrush,
          rationale: earningsNear ? "Earnings near expiry — vol crush opportunity" : "No earnings timing" },
      ];

      const score = Math.max(0, Math.min(100, breakdown.reduce((sum, f) => sum + f.score, 0)));
      const direction = contractType === "call" ? "long call" : "long put";
      const rationale = `${signal.symbol}: ${direction} conviction ${score}/100 (IV=${iv.toFixed(2)}, RSI=${rsi ?? "N/A"}, VIX≈${vixLevel})`;

      return { symbol: signal.symbol, score, breakdown, rationale };
    },

    factors(): FactorDefinition[] {
      const w = OPTIONS_WEIGHTS;
      return [
        { name: "iv_contrarian", weight: w.ivContrarian, description: "Extreme IV rank on mean-reverting underlier — sell/buy premium edge." },
        { name: "rsi_delta", weight: w.rsiDelta, description: "Underlier RSI + delta sensitivity for timing." },
        { name: "quality", weight: w.quality, description: "Underlier liquidity, AUM, institutional ownership." },
        { name: "regime", weight: w.regime, description: "VIX regime and market regime composite." },
        { name: "open_interest_growth", weight: w.openInterestGrowth, description: "Open interest growth (replaces crypto holder growth)." },
        { name: "vanna_charm_penalty", weight: w.vannaCharmPenalty, description: "Vanna/Charm decay risk penalty." },
        { name: "gamma_squeeze_risk", weight: w.gammaSqueezeRisk, description: "Gamma squeeze risk (penalty for high-gamma positions)." },
        { name: "earnings_vol_crush", weight: w.earningsVolCrush, description: "Earnings vol crush timing (premium near earnings expiry)." },
      ];
    },
  };
}

let _instance: ConvictionFactors | null = null;
export function getOptionsConvictionAdapter(): ConvictionFactors {
  if (!_instance) _instance = createOptionsConvictionAdapter();
  return _instance;
}
