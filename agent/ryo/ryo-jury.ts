/**
 * RYO conviction jury — the "real thinking" stage of the practice agent.
 *
 * Mirrors the production llm-jury.ts pattern (±15 adjustment, agreement
 * bands, calibrated reasoning, template fallback when no provider is keyed)
 * on the same shared LLM ladder (`llm-providers.ts` — zero crypto coupling).
 *
 * What makes this version richer than the crypto jury: it deliberates over
 * RYO's own deepest evidence — deep_analysis verdicts/confluence/risks/
 * catalysts, compare_tokens head-to-heads, and the 7-day sentiment shift —
 * not just price fields. Every verdict lands in the reasoning ledger as a
 * JURY entry, so the judge can read actual judgements, not only hashed inputs.
 */
import { chatCompletion, firstAvailableLlmProvider, parseLenientJson } from "../lib/llm-providers.js";
import type { LlmProviderName } from "../lib/llm-providers.js";
import type { ConvictionResult, MarketSignal } from "../lib/adapters/types.js";

const JURY_MODELS = {
  "vercel-gateway": { envVar: "VERCEL_GATEWAY_JURY_MODEL", defaultModel: "zai/glm-5.2" },
  openrouter: { envVar: "OPENROUTER_JURY_MODEL", defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free" },
  "b-ai": { envVar: "BAI_JURY_MODEL", defaultModel: "deepseek-v4-flash" },
  orcarouter: { envVar: "ORCAROUTER_JURY_MODEL", defaultModel: "deepseek/deepseek-v4-flash-free" },
  featherless: { envVar: "FEATHERLESS_JURY_MODEL", defaultModel: "Qwen/Qwen2.5-72B-Instruct" },
  openai: { envVar: "OPENAI_JURY_MODEL", defaultModel: "gpt-4o-mini" },
  anthropic: { envVar: "ANTHROPIC_JURY_MODEL", defaultModel: "claude-3-haiku-20240307" },
} as const;

export interface RyoJuryCandidate {
  signal: MarketSignal;
  conviction: ConvictionResult;
  /** Envelope data from deep_analysis on this symbol — verdict, confluence,
   *  risks, catalysts, preview plan. May be null when the tool is down. */
  deep: unknown;
  /** Tool status of the deep_analysis call — the jury sees degraded evidence. */
  deepStatus?: string;
}

export interface RyoJuryVerdict {
  symbol: string;
  baseScore: number;
  adjustment: number;
  adjustedScore: number;
  agreement: "strong-agree" | "agree" | "neutral" | "disagree" | "strong-disagree";
  reasoning: string;
  keyRisk: string;
}

export interface RyoJuryDeliberation {
  provider: string;
  model: string;
  marketAssessment: string;
  verdicts: RyoJuryVerdict[];
  /** 'llm' = a provider answered · 'template' = honest zero-adjustment fallback */
  mode: "llm" | "template";
}

const SYSTEM_PROMPT = `You are the conviction jury for an autonomous contrarian trading agent called "Early, Not Wrong" running on RYO-CHAN's market research tools.

The agent's thesis: being early feels like being wrong. It buys quality assets that are DOWN during market fear — never momentum. The expensive mistake is selling winners too early, not buying losers.

Your job: review the agent's top conviction candidates, each with a deterministic score breakdown AND the platform's own deep_analysis evidence (verdict, confluence, risks, catalysts). You can ADJUST each score by -15 to +15 based on what the deterministic scoring cannot capture:
- Whether the deep_analysis verdict and catalysts confirm or contradict the score
- Whether named risks (concentration, liquidity, unlocks) should veto what looks like a dip-buy
- Cross-asset context from the comparison table and the 7-day sentiment shift
- Whether a drawdown is thesis-validating (healthy dip) or thesis-breaking (fundamental deterioration)

You MUST respond as a JSON object with this exact schema:
{
  "marketAssessment": "1-2 sentence overall market view",
  "verdicts": [
    {
      "symbol": "TOKEN",
      "adjustment": -15 to 15 (integer),
      "reasoning": "2-4 sentences citing the specific evidence that drove the adjustment",
      "agreement": "strong-agree" | "agree" | "neutral" | "disagree" | "strong-disagree",
      "keyRisk": "1 sentence describing the biggest risk"
    }
  ]
}

Be calibrated: most adjustments should be small (-5 to +5). Cite the evidence — a verdict that cannot point to a specific field is a coin flip, not a judgement.`;

function buildPrompt(
  candidates: RyoJuryCandidate[],
  compare: unknown,
  sentiment: unknown,
): string {
  const lines: string[] = ["Candidates under review (deterministic score → you adjust):"];
  for (const c of candidates) {
    const s = c.signal;
    const meta = (s.metadata ?? {}) as Record<string, unknown>;
    lines.push("");
    lines.push(`## ${s.symbol} — score ${c.conviction.score}/100`);
    lines.push(`  breakdown: ${c.conviction.breakdown.map((b) => `${b.name}=${b.score}/${b.maxScore}`).join(" ")}`);
    lines.push(`  price $${s.price.toFixed(4)} | 24h ${s.priceChange24hPercent.toFixed(1)}% | 7d ${s.priceChange7dPercent.toFixed(1)}%`);
    if (meta.rsi14 != null) lines.push(`  RSI(14): ${meta.rsi14} · ema_trend: ${meta.emaTrend ?? "n/a"} · ryo verdict: ${meta.verdict ?? "n/a"}`);
    if (Array.isArray(meta.missingFields) && meta.missingFields.length) {
      lines.push(`  ⚠ degraded evidence — missing: ${(meta.missingFields as string[]).join(", ")}`);
    }
    const deep = c.deep as Record<string, unknown> | null;
    if (deep && typeof deep === "object") {
      lines.push(`  deep_analysis (${c.deepStatus ?? "ok"}): ${JSON.stringify(deep).slice(0, 900)}`);
    } else {
      lines.push(`  deep_analysis: unavailable (${c.deepStatus ?? "no data"})`);
    }
  }
  lines.push("");
  lines.push(`compare_tokens evidence: ${JSON.stringify(compare).slice(0, 800)}`);
  lines.push(`7d sentiment shift: ${JSON.stringify(sentiment).slice(0, 500)}`);
  lines.push("");
  lines.push("Provide verdicts as a JSON object.");
  return lines.join("\n");
}

function clampAdj(n: number): number {
  return Math.max(-15, Math.min(15, Math.round(n)));
}

export async function deliberateRyoJury(
  candidates: RyoJuryCandidate[],
  compare: unknown,
  sentiment: unknown,
): Promise<RyoJuryDeliberation> {
  const finalize = (verdicts: Array<Omit<RyoJuryVerdict, "adjustedScore" | "baseScore">>, provider: string, model: string, mode: "llm" | "template", marketAssessment: string): RyoJuryDeliberation => ({
    provider,
    model,
    mode,
    marketAssessment,
    verdicts: verdicts.map((v) => {
      const base = candidates.find((c) => c.signal.symbol.toUpperCase() === v.symbol.toUpperCase())?.conviction.score ?? 0;
      return { ...v, baseScore: base, adjustedScore: Math.max(0, Math.min(100, base + v.adjustment)) };
    }),
  });

  if (process.env.LLM_JURY_DISABLED === "1" || candidates.length === 0) {
    return finalize(candidates.map((c) => ({ symbol: c.signal.symbol, adjustment: 0, agreement: "neutral" as const, reasoning: "jury disabled", keyRisk: "n/a" })), "template", "none", "template", "jury disabled");
  }

  const provider = firstAvailableLlmProvider(JURY_MODELS);
  if (provider) {
    try {
      const result = await chatCompletion({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildPrompt(candidates, compare, sentiment),
        models: JURY_MODELS as Partial<Record<LlmProviderName, (typeof JURY_MODELS)[LlmProviderName]>>,
        maxTokens: 1400,
        temperature: 0.4,
        timeoutMs: 45_000,
        xTitle: "Early Not Wrong — RYO Conviction Jury",
      });
      const raw = parseLenientJson<{
        marketAssessment?: string;
        verdicts?: Array<{ symbol?: string; adjustment?: number; reasoning?: string; agreement?: string; keyRisk?: string }>;
      }>(result?.content ?? "");
      if (raw?.verdicts?.length) {
        const ok = new Set(["strong-agree", "agree", "neutral", "disagree", "strong-disagree"]);
        return finalize(
          raw.verdicts.filter((v) => v.symbol).map((v) => ({
            symbol: String(v.symbol).toUpperCase(),
            adjustment: clampAdj(Number(v.adjustment) || 0),
            agreement: (ok.has(v.agreement ?? "") ? v.agreement : "neutral") as RyoJuryVerdict["agreement"],
            reasoning: v.reasoning ?? "no reasoning provided",
            keyRisk: v.keyRisk ?? "unspecified",
          })),
          result!.provider,
          result!.model,
          "llm",
          raw.marketAssessment ?? "",
        );
      }
    } catch (e) {
      console.warn(`  [ryo-jury] LLM deliberation failed (${e instanceof Error ? e.message : e}) — template fallback`);
    }
  }

  // Template fallback — honest zero-adjustment verdicts, labeled as such.
  return finalize(
    candidates.map((c) => {
      const score = c.conviction.score;
      return {
        symbol: c.signal.symbol,
        adjustment: 0,
        agreement: (score >= 65 ? "agree" : score >= 45 ? "neutral" : "disagree") as RyoJuryVerdict["agreement"],
        reasoning: `template mode — no LLM provider keyed; deterministic score ${score}/100 stands unadjusted`,
        keyRisk: "jury unavailable — score carries no model judgement",
      };
    }),
    "template",
    "none",
    "template",
    "no LLM provider configured — verdicts are deterministic pass-throughs, not model judgements",
  );
}
