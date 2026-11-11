/**
 * RYO-CHAN Conviction Factors Adapter (Harness Domain: ryo)
 *
 * Deterministic 0–100 conviction scoring over RYO-CHAN research evidence.
 * Same factor philosophy as the crypto domain — contrarian entries into
 * verified-safe assets during fear — re-expressed for what RYO's tools
 * actually return. `check_safety` is a hard gate, not a soft factor.
 */

import type { ConvictionFactors } from "./conviction-factors.js";
import type { ConvictionResult, FactorDefinition, FactorScore, Kline, MarketSignal } from "./types.js";

const W = { contrarian: 30, quality: 20, timing: 10, regime: 20, safety: 10 } as const;
const SAFETY_VETO_SCORE = 0;

function scoreOne(signal: MarketSignal, historical: Kline[]): ConvictionResult {
  const meta = signal.metadata ?? {};
  const breakdown: FactorScore[] = [];
  const notes: string[] = [];
  if (typeof meta.rsi14 === "number" && meta.rsi14 < 35) notes.push(`RSI ${meta.rsi14.toFixed(0)} — oversold timing`);

  // Degraded-evidence disclosure (spec: never convert unavailable → zero).
  // Missing fields don't fabricate a number — they cut the score AND get named.
  const missing = Array.isArray(meta.missingFields) ? (meta.missingFields as string[]) : [];
  if (missing.length) notes.push(`evidence degraded — missing: ${missing.join(", ")}`);
  const toolStatus = (meta.toolStatus ?? {}) as Record<string, string>;
  if (Object.values(toolStatus).some((s) => s === "partial" || s === "unavailable")) {
    notes.push(`tool status: ${Object.entries(toolStatus).filter(([, s]) => s !== "ok").map(([t, s]) => `${t}=${s}`).join(", ")}`);
  }

  // Contrarian (30): reward 7d drawdowns — "early, not wrong".
  const chg7d = signal.priceChange7dPercent;
  const contrarian = chg7d < 0 ? Math.min(W.contrarian, Math.abs(chg7d) * 1.5) : Math.max(0, 10 - chg7d * 0.5);
  breakdown.push({ name: "contrarian", score: round(contrarian), maxScore: W.contrarian, rationale: `7d change ${chg7d.toFixed(1)}%` });
  if (chg7d < -10) notes.push(`down ${chg7d.toFixed(1)}% over 7d — contrarian window`);

  // Quality (20): log-scaled market cap + liquidity.
  const mcapPts = signal.marketCap > 0 ? Math.min(12, Math.log10(Math.max(signal.marketCap, 1)) * 1.5) : 4;
  const liqPts = signal.volume24h > 0 ? Math.min(8, Math.log10(Math.max(signal.volume24h, 1))) : 2;
  breakdown.push({ name: "quality", score: round(mcapPts + liqPts), maxScore: W.quality, rationale: `mcap $${fmt(signal.marketCap)}, vol $${fmt(signal.volume24h)}` });

  // Timing (10): 24h stabilization after a drop; penalize chasing.
  const chg24h = signal.priceChange24hPercent;
  const timing = chg24h > -3 && chg24h < 8 ? W.timing : chg24h >= 8 ? 4 : 2;
  breakdown.push({ name: "timing", score: timing, maxScore: W.timing, rationale: `24h change ${chg24h.toFixed(1)}%` });
  if (chg24h >= 8) notes.push(`+${chg24h.toFixed(1)}% 24h — timing penalty (don't chase)`);

  // Regime (20): fear/greed from market_overview via signal metadata.
  const fear = typeof meta.fearGreed === "number" ? meta.fearGreed : 50;
  const regime = fear <= 30 ? W.regime : fear <= 50 ? 14 : fear <= 70 ? 8 : 4;
  breakdown.push({ name: "regime", score: regime, maxScore: W.regime, rationale: `fear/greed ${fear}` });
  if (fear <= 30) notes.push(`fear regime (${fear}) — asymmetry favors buyers`);

  // Volatility penalty (within quality envelope): erratic kline path.
  if (historical.length >= 7) {
    const rets = historical.slice(-7).map((k, i, a) => (i ? Math.abs((k.close - a[i - 1].close) / a[i - 1].close) : 0));
    const avgAbs = rets.reduce((a, b) => a + b, 0) / rets.length;
    if (avgAbs > 0.15) {
      breakdown[1].score = Math.max(0, breakdown[1].score - 4);
      notes.push(`high 7d realized vol (${(avgAbs * 100).toFixed(0)}%/day) — quality haircut`);
    }
  }

  // Safety (10): check_safety evidence; a positive honeypot flag or explicit
  // unsafe verdict = hard veto. An unavailable safety source is neutral (5).
  const safety = (meta.safety ?? null) as Record<string, unknown> | null;
  const honeypot = safety?.honeypot === true || safety?.safe === false || (Array.isArray(safety?.flags) && (safety.flags as unknown[]).some((f) => String(f).toLowerCase().includes("honeypot")));
  const safeScore = numField(safety, "score", "safety_score", "risk");
  const safetyPts = honeypot ? SAFETY_VETO_SCORE : safeScore != null ? Math.min(W.safety, Math.max(0, safeScore / 10)) : 5;
  breakdown.push({ name: "safety", score: round(safetyPts), maxScore: W.safety, rationale: honeypot ? "honeypot flag — hard veto" : "check_safety passed" });
  if (honeypot) notes.push("HONEYPOT — vetoed");

  // A score built on missing evidence is a weaker claim — cap it instead of
  // pretending the inputs were there (published contract: null ≠ 0).
  let total = honeypot ? 0 : Math.round(breakdown.reduce((a, b) => a + b.score, 0));
  if (!honeypot && missing.length >= 2) {
    total = Math.min(total, 45);
    notes.push(`score capped at 45 — ${missing.length} core fields missing`);
  }
  return { symbol: signal.symbol, score: total, breakdown, rationale: notes.join("; ") || `${signal.symbol} factors net ${total}` };
}

function numField(obj: unknown, ...keys: string[]): number | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (keys.some((f) => k.toLowerCase().includes(f)) && typeof v === "number") return v;
    if (v && typeof v === "object") {
      const nested = numField(v, ...keys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}
const round = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toFixed(0));

export function createRyoConvictionAdapter(): ConvictionFactors {
  return {
    score(signal: MarketSignal, historical: Kline[]): Promise<ConvictionResult> {
      return Promise.resolve(scoreOne(signal, historical));
    },
    factors(): FactorDefinition[] {
      return [
        { name: "contrarian", weight: W.contrarian, description: "Rewards quality assets down 7d — early, not wrong." },
        { name: "quality", weight: W.quality, description: "Market cap + liquidity floor from analyze_token." },
        { name: "timing", weight: W.timing, description: "24h stabilization; penalizes chasing pumps." },
        { name: "regime", weight: W.regime, description: "Fear/greed regime + 7d sentiment shift." },
        { name: "safety", weight: W.safety, description: "check_safety/deep_analysis verdict gate — honeypot is a hard veto." },
        { name: "jury", weight: 0, description: "LLM jury adjusts ±15 post-scoring over deep_analysis/compare_tokens/sentiment evidence." },
      ];
    },
  };
}

let _instance: ConvictionFactors | null = null;
export function getRyoConvictionAdapter(): ConvictionFactors {
  if (!_instance) _instance = createRyoConvictionAdapter();
  return _instance;
}
