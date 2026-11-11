/**
 * Jury smoke test — exercises the real deliberation path with realistic
 * candidates, no RYO credential needed. Judges can watch the model think:
 *
 *   FEATHERLESS_API_KEY=rc_… npx tsx agent/ryo/jury-smoke.ts
 *
 *   # twigpine fallback
 *   OPENAI_API_KEY=ogw_… OPENAI_BASE_URL=https://api.twigpine.com/v1 \
 *   OPENAI_JURY_MODEL=nvidia/nemotron-3.5-super-vl:free \
 *   npx tsx agent/ryo/jury-smoke.ts
 */
import { deliberateRyoJury } from "./ryo-jury.js";
import type { MarketSignal, ConvictionResult } from "../lib/adapters/types.js";

const sig = (symbol: string, price: number, h24: number, d7: number, extra: Record<string, unknown> = {}): MarketSignal => ({
  symbol,
  name: symbol,
  price,
  priceChange24hPercent: h24,
  priceChange7dPercent: d7,
  volume24h: 180_000_000,
  marketCap: 5_600_000_000,
  metadata: { rsi14: 34, emaTrend: "down", verdict: "neutral", missingFields: [], toolStatus: { analyze: "ok" }, ...extra },
});

const conv = (score: number): ConvictionResult => ({
  score,
  breakdown: [
    { name: "contrarian", score: 26, maxScore: 30, rationale: "down -14% 7d during fear" },
    { name: "quality", score: 15, maxScore: 20, rationale: "mid-cap, liquid" },
    { name: "regime", score: 16, maxScore: 20, rationale: "fear 26 favors patience" },
    { name: "timing", score: 9, maxScore: 10, rationale: "RSI 34 oversold" },
    { name: "safety", score: 10, maxScore: 10, rationale: "no flags" },
  ],
  rationale: "oversold quality asset in fear regime",
  vetoed: false,
});

const candidates = [
  {
    signal: sig("HYPE", 31.4, -2.1, -14.1),
    conviction: conv(76),
    deep: {
      verdict: "cautious-accumulate",
      confluence: ["RSI(14) 34 oversold", "funding negative — shorts crowded", "volume declining on sell-off = exhaustion"],
      risks: ["broader market still in fear regime", "no confirmed reversal yet"],
      catalysts: ["upcoming protocol fee upgrade in ~2 weeks"],
    },
    deepStatus: "ok",
  },
  {
    signal: sig("XRP", 2.21, 1.2, -6.4, { verdict: "caution" }),
    conviction: conv(58),
    deep: {
      verdict: "avoid",
      confluence: ["price stabilizing after drawdown"],
      risks: ["top10_concentration 64.7% — whale distribution risk", "exchange outflow spike suggests insider selling"],
      catalysts: [],
    },
    deepStatus: "ok",
  },
  {
    signal: sig("SOL", 142.8, -0.8, -9.2),
    conviction: conv(49),
    deep: null,
    deepStatus: "unavailable",
  },
];

const compare = { winner_by_momentum: "HYPE", winner_by_safety: "SOL", note: "XRP flagged for holder concentration" };
const sentiment = { shift_7d: "fear deepening", fear_greed: 26, direction: "risk-off", notable: "majors bleeding, alts capitulating" };

const d = await deliberateRyoJury(candidates, compare, sentiment);
console.log(`\njury mode: ${d.mode} · provider: ${d.provider} · model: ${d.model}`);
console.log(`market: ${d.marketAssessment}\n`);
for (const v of d.verdicts) {
  console.log(`${v.symbol}: ${v.baseScore} → ${v.adjustedScore} (${v.adjustment >= 0 ? "+" : ""}${v.adjustment}, ${v.agreement})`);
  console.log(`  reasoning: ${v.reasoning}`);
  console.log(`  keyRisk: ${v.keyRisk}\n`);
}
