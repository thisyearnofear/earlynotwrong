/**
 * LLM Conviction Jury — the 7th scoring factor.
 *
 * The agent's 6-factor scoring engine is deterministic and contrarian by
 * design. The jury adds a reasoning layer: an LLM receives each top
 * candidate's market context, the 6-factor breakdown, the regime, and
 * recent news — then returns a structured conviction adjustment with a
 * human-readable reasoning trace.
 *
 * This is NOT cosmetic. The adjustment (-15 to +15 points) actually moves
 * the conviction score and can change whether a token enters. The reasoning
 * trace is included in the thesis hash, so the AI's deliberation is
 * provably anchored on-chain alongside the score.
 *
 * Three modes:
 *   1. LLM mode (OpenRouter, OpenAI, or Anthropic) — real reasoning, real adjustment
 *   2. Template mode — deterministic fallback when no API key is set
 *   3. Disabled — returns null, scoring proceeds without the 7th factor
 *
 * The jury is called once per cycle for the top-K conviction candidates
 * (after the 6-factor scoring, before entry decisions).
 */

import type { ConvictionSignal, MarketRegime } from "./conviction-signal.js";
import type { TokenQuote } from "./data-providers.js";
import { chatCompletion, firstAvailableLlmProvider } from "./llm-providers.js";

// =============================================================================
// Types
// =============================================================================

export type JuryProvider = "openrouter" | "openai" | "anthropic" | "template";

export type JuryAgreement =
  | "strong-agree"
  | "agree"
  | "neutral"
  | "disagree"
  | "strong-disagree";

/** The jury's verdict on a single token. */
export interface JuryVerdict {
  symbol: string;
  /** Score adjustment applied to the 6-factor score (-15 to +15). */
  adjustment: number;
  /** Final score after adjustment, clamped to [0, 100]. */
  adjustedScore: number;
  /** The jury's reasoning for this token (2-4 sentences). */
  reasoning: string;
  /** Whether the jury agrees with the contrarian thesis for this token. */
  agreement: JuryAgreement;
  /** The key risk the jury identified for this entry. */
  keyRisk: string;
}

/** The full deliberation for a cycle — one verdict per top candidate. */
export interface JuryDeliberation {
  /** ISO timestamp of deliberation. */
  deliberatedAt: string;
  /** Which provider was used. */
  provider: JuryProvider;
  /** Model name (e.g. "gpt-4o-mini", "claude-3-haiku-20240307", "template-v1"). */
  model: string;
  /** Per-token verdicts, sorted by adjusted score descending. */
  verdicts: JuryVerdict[];
  /** Overall market assessment from the jury (1-2 sentences). */
  marketAssessment: string;
  /** Number of tokens the jury evaluated. */
  tokensEvaluated: number;
}

/** Input context for the jury — everything it needs to reason about a token. */
export interface JuryTokenContext {
  symbol: string;
  signal: ConvictionSignal;
  quote: TokenQuote;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Run the LLM conviction jury on the top conviction candidates.
 *
 * Returns a JuryDeliberation with per-token verdicts, or null when the jury
 * is disabled (no candidates, or explicitly turned off).
 *
 * The verdicts are sorted by adjusted score so callers can use them
 * directly for entry decisions.
 */
export async function deliberateConviction(
  candidates: JuryTokenContext[],
  regime: MarketRegime,
  newsHeadlines: string[],
): Promise<JuryDeliberation | null> {
  if (candidates.length === 0) return null;

  // Explicit disable switch — lets operators turn off the jury without
  // removing API keys (e.g. to isolate a 6-factor-only run).
  if (process.env.LLM_JURY_DISABLED === "1") return null;

  try {
    const deliberation = await deliberateWithLlm(candidates, regime, newsHeadlines);
    if (deliberation) return deliberation;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [llm-jury] LLM deliberation failed, falling back to template: ${msg}`);
  }

  // Template fallback — deterministic, no API call (also used when no key).
  return templateDeliberation(candidates, regime);
}

/**
 * Apply jury verdicts to conviction signals, returning updated signals with
 * the 7th factor (llmJury) baked into the score and breakdown.
 *
 * Signals without a matching verdict are returned unchanged.
 */
export function applyJuryVerdicts(
  signals: ConvictionSignal[],
  deliberation: JuryDeliberation | null,
): ConvictionSignal[] {
  if (!deliberation) return signals;

  const verdictMap = new Map<string, JuryVerdict>();
  for (const v of deliberation.verdicts) {
    verdictMap.set(v.symbol.toUpperCase(), v);
  }

  return signals.map((s) => {
    const verdict = verdictMap.get(s.symbol.toUpperCase());
    if (!verdict) return s;

    return {
      ...s,
      score: verdict.adjustedScore,
      breakdown: {
        ...s.breakdown,
        llmJury: verdict.adjustment,
      },
      rationale: `${s.rationale} · jury ${verdict.adjustment >= 0 ? "+" : ""}${verdict.adjustment} (${verdict.agreement})`,
      juryReasoning: verdict.reasoning,
      juryAgreement: verdict.agreement,
      juryKeyRisk: verdict.keyRisk,
    } as ConvictionSignal & JurySignalFields;
  });
}

/** Extra fields added to ConvictionSignal when the jury has deliberated. */
export interface JurySignalFields {
  /** The jury's score adjustment (-15 to +15). */
  breakdown: ConvictionSignal["breakdown"] & { llmJury?: number };
  /** The jury's reasoning trace for this token. */
  juryReasoning?: string;
  /** The jury's agreement level with the contrarian thesis. */
  juryAgreement?: JuryAgreement;
  /** The key risk the jury identified. */
  juryKeyRisk?: string;
}

// =============================================================================
// LLM Deliberation — shared provider ladder (llm-providers.ts)
// =============================================================================
//
// Provider priority: OpenRouter > OpenAI > Anthropic > template.
// OpenRouter uses the OpenAI-compatible chat completions API; the default
// model is openrouter/auto — OpenRouter routes to the best available free
// model, maximizing reliability across provider outages.

const JURY_MODELS = {
  openrouter: { envVar: "OPENROUTER_JURY_MODEL", defaultModel: "openrouter/auto" },
  openai: { envVar: "OPENAI_JURY_MODEL", defaultModel: "gpt-4o-mini" },
  anthropic: { envVar: "ANTHROPIC_JURY_MODEL", defaultModel: "claude-3-haiku-20240307" },
} as const;

/** Returns null when no provider key is configured (caller falls to template). */
async function deliberateWithLlm(
  candidates: JuryTokenContext[],
  regime: MarketRegime,
  newsHeadlines: string[],
): Promise<JuryDeliberation | null> {
  const provider = firstAvailableLlmProvider(JURY_MODELS);
  if (!provider) return null;

  const result = await chatCompletion({
    systemPrompt: JURY_SYSTEM_PROMPT,
    userPrompt: buildJuryPrompt(candidates, regime, newsHeadlines),
    models: JURY_MODELS,
    maxTokens: 1200,
    temperature: 0.4,
    timeoutMs: provider === "openrouter" ? 45_000 : 30_000, // free tier can be slower
    xTitle: "Early Not Wrong - Conviction Jury",
  });
  if (!result) return null;
  return parseJuryResponse(result.content, candidates, regime, result.provider, result.model);
}

// =============================================================================
// Prompt Construction
// =============================================================================

const JURY_SYSTEM_PROMPT = `You are the conviction jury for an autonomous contrarian trading agent called "Early, Not Wrong".

The agent's thesis: being early feels like being wrong. It buys quality assets that are DOWN during market fear — never momentum. The expensive mistake is selling winners too early, not buying losers.

Your job: review the agent's top conviction candidates and provide a structured verdict for each. You can ADJUST the score by -15 to +15 points based on factors the deterministic scoring might miss:
- Narrative momentum or regulatory risk not captured in news sentiment
- Token-specific context (team, roadmap, tokenomics) you know about
- Cross-asset correlations that amplify or dampen the contrarian signal
- Whether the drawdown is thesis-validating (healthy dip) or thesis-breaking (project failure)

You MUST respond as a JSON object with this exact schema:
{
  "marketAssessment": "1-2 sentence overall market view",
  "verdicts": [
    {
      "symbol": "TOKEN",
      "adjustment": -15 to 15 (integer),
      "reasoning": "2-4 sentences explaining your adjustment",
      "agreement": "strong-agree" | "agree" | "neutral" | "disagree" | "strong-disagree",
      "keyRisk": "1 sentence describing the biggest risk"
    }
  ]
}

Be calibrated: most adjustments should be small (-5 to +5). Only use large adjustments when you have strong conviction. Never adjust above +15 or below -15.`;

function buildJuryPrompt(
  candidates: JuryTokenContext[],
  regime: MarketRegime,
  newsHeadlines: string[],
): string {
  const lines: string[] = [
    `Market regime: ${regime.label} (contrarian score ${regime.score}/100, FGI ${regime.fearGreedIndex ?? "N/A"})`,
    "",
    "Conviction candidates to evaluate:",
  ];

  for (const c of candidates) {
    const s = c.signal;
    const q = c.quote;
    lines.push("");
    lines.push(`## ${c.symbol} (6-factor score: ${s.score}/100)`);
    lines.push(`  Price: $${q.price?.toFixed(6) ?? "N/A"}`);
    lines.push(`  24h: ${q.percentChange24h >= 0 ? "+" : ""}${q.percentChange24h.toFixed(1)}% | 7d: ${q.percentChange7d >= 0 ? "+" : ""}${q.percentChange7d.toFixed(1)}%`);
    lines.push(`  Market cap: $${(q.marketCap / 1e6).toFixed(1)}M | Volume 24h: $${(q.volume24h / 1e6).toFixed(1)}M`);
    lines.push(`  Breakdown: contrarian ${s.breakdown.contrarian} · rsi ${s.breakdown.rsi} · quality ${s.breakdown.quality} · regime ${s.breakdown.regime} · holders ${s.breakdown.holders} · vol penalty ${s.breakdown.volatilityPenalty} · news ${s.breakdown.news}`);
    lines.push(`  Rationale: ${s.rationale}`);
    if (s.holderCount !== null) {
      lines.push(`  Holders: ${s.holderCount.toLocaleString()} (${s.holderGrowthPercent !== null ? `${s.holderGrowthPercent >= 0 ? "+" : ""}${s.holderGrowthPercent.toFixed(1)}% 7d` : "no history"})`);
    }
  }

  if (newsHeadlines.length > 0) {
    lines.push("");
    lines.push("Recent news headlines:");
    for (const h of newsHeadlines.slice(0, 5)) {
      lines.push(`  - ${h}`);
    }
  }

  lines.push("");
  lines.push("Provide your verdicts as a JSON object.");

  return lines.join("\n");
}

// =============================================================================
// Response Parsing
// =============================================================================

interface RawJuryResponse {
  marketAssessment?: string;
  verdicts?: Array<{
    symbol?: string;
    adjustment?: number;
    reasoning?: string;
    agreement?: string;
    keyRisk?: string;
  }>;
}

function parseJuryResponse(
  content: string,
  candidates: JuryTokenContext[],
  regime: MarketRegime,
  provider: JuryProvider,
  model: string,
): JuryDeliberation {
  let raw: RawJuryResponse;
  try {
    raw = JSON.parse(content) as RawJuryResponse;
  } catch {
    // If the LLM returns non-JSON, fall back to template mode.
    console.warn(`  [llm-jury] Failed to parse LLM response as JSON, using template fallback`);
    return templateDeliberation(candidates, regime);
  }

  const candidateMap = new Map<string, JuryTokenContext>();
  for (const c of candidates) {
    candidateMap.set(c.symbol.toUpperCase(), c);
  }

  const verdicts: JuryVerdict[] = [];
  for (const rv of raw.verdicts ?? []) {
    const sym = (rv.symbol ?? "").toUpperCase();
    const candidate = candidateMap.get(sym);
    if (!candidate) continue;

    const adjustment = clamp(Math.round(rv.adjustment ?? 0), -15, 15);
    const baseScore = candidate.signal.score;
    const adjustedScore = clamp(baseScore + adjustment, 0, 100);
    const agreement = parseAgreement(rv.agreement);

    verdicts.push({
      symbol: candidate.symbol,
      adjustment,
      adjustedScore,
      reasoning: rv.reasoning?.trim() || "No reasoning provided.",
      agreement,
      keyRisk: rv.keyRisk?.trim() || "Unspecified risk.",
    });
  }

  // Fill in any candidates the LLM skipped (shouldn't happen, but be safe).
  for (const c of candidates) {
    if (!verdicts.some((v) => v.symbol.toUpperCase() === c.symbol.toUpperCase())) {
      verdicts.push({
        symbol: c.symbol,
        adjustment: 0,
        adjustedScore: c.signal.score,
        reasoning: "Jury did not evaluate this token.",
        agreement: "neutral",
        keyRisk: "No jury assessment available.",
      });
    }
  }

  verdicts.sort((a, b) => b.adjustedScore - a.adjustedScore);

  return {
    deliberatedAt: new Date().toISOString(),
    provider,
    model,
    verdicts,
    marketAssessment: raw.marketAssessment?.trim() || "No market assessment provided.",
    tokensEvaluated: verdicts.length,
  };
}

function parseAgreement(value: string | undefined): JuryAgreement {
  const v = (value ?? "").toLowerCase().trim();
  if (v === "strong-agree") return "strong-agree";
  if (v === "agree") return "agree";
  if (v === "disagree") return "disagree";
  if (v === "strong-disagree") return "strong-disagree";
  return "neutral";
}

// =============================================================================
// Template Fallback (no API key)
// =============================================================================

/**
 * Deterministic template deliberation — used when no LLM API key is set.
 *
 * Produces zero adjustments (the 6-factor score stands) but still generates
 * a reasoning trace from the signal data, so the dashboard and on-chain
 * anchor always have a deliberation record.
 */
function templateDeliberation(
  candidates: JuryTokenContext[],
  regime: MarketRegime,
): JuryDeliberation {
  const verdicts: JuryVerdict[] = candidates.map((c) => {
    const s = c.signal;
    const q = c.quote;
    const dip = q.percentChange7d;

    const reasoning = buildTemplateReasoning(s, q, regime);
    const agreement = assessAgreement(s, dip);
    const keyRisk = assessKeyRisk(s, q);

    return {
      symbol: c.symbol,
      adjustment: 0,
      adjustedScore: s.score,
      reasoning,
      agreement,
      keyRisk,
    };
  });

  verdicts.sort((a, b) => b.adjustedScore - a.adjustedScore);

  return {
    deliberatedAt: new Date().toISOString(),
    provider: "template",
    model: "template-v1",
    verdicts,
    marketAssessment: `Template mode: regime is ${regime.label.toLowerCase()} with contrarian score ${regime.score}/100. No LLM API key configured — adjustments are zero, reasoning is rule-based.`,
    tokensEvaluated: verdicts.length,
  };
}

function buildTemplateReasoning(
  signal: ConvictionSignal,
  quote: TokenQuote,
  regime: MarketRegime,
): string {
  const parts: string[] = [];
  const dip = quote.percentChange7d;

  if (dip <= -15) {
    parts.push(`${signal.symbol} is down ${Math.abs(dip).toFixed(0)}% over 7d — within the contrarian "early" sweet spot.`);
  } else if (dip < 0) {
    parts.push(`${signal.symbol} shows a mild ${Math.abs(dip).toFixed(0)}% dip — moderate contrarian signal.`);
  } else {
    parts.push(`${signal.symbol} is up ${dip.toFixed(0)}% — outside the contrarian entry zone.`);
  }

  if (signal.breakdown.quality >= 10) {
    parts.push(`Quality is strong (mcap $${(quote.marketCap / 1e6).toFixed(0)}M, healthy turnover).`);
  } else if (signal.breakdown.quality < 5) {
    parts.push(`Liquidity is thin — exit risk if conditions deteriorate.`);
  }

  if (signal.holderGrowthPercent !== null && signal.holderGrowthPercent >= 5) {
    parts.push(`On-chain accumulation is positive (+${signal.holderGrowthPercent.toFixed(1)}% holders).`);
  } else if (signal.holderGrowthPercent !== null && signal.holderGrowthPercent <= -3) {
    parts.push(`Holder base is fading (${signal.holderGrowthPercent.toFixed(1)}%) — distribution signal.`);
  }

  parts.push(`Regime is ${regime.fearLevel.replace("-", " ")} — ${regime.score >= 60 ? "favorable for contrarian entries" : "selective entry conditions"}.`);

  return parts.join(" ");
}

function assessAgreement(signal: ConvictionSignal, dip7d: number): JuryAgreement {
  // Template logic: agree when the signal is strong and the dip is in the sweet spot.
  if (signal.score >= 70 && dip7d <= -15) return "strong-agree";
  if (signal.score >= 58 && dip7d < 0) return "agree";
  if (signal.score >= 45) return "neutral";
  if (dip7d > 25) return "strong-disagree";
  return "disagree";
}

function assessKeyRisk(signal: ConvictionSignal, quote: TokenQuote): string {
  if (signal.breakdown.volatilityPenalty >= 10) {
    return `Erratic price path (volatility penalty ${signal.breakdown.volatilityPenalty}) — the dip may be a falling knife, not a healthy correction.`;
  }
  if (signal.breakdown.quality < 5) {
    return `Thin liquidity ($${(quote.volume24h / 1e6).toFixed(1)}M volume) — exit may be difficult in adverse conditions.`;
  }
  if (signal.holderGrowthPercent !== null && signal.holderGrowthPercent <= -3) {
    return `Holder base declining (${signal.holderGrowthPercent.toFixed(1)}%) — suggests distribution rather than accumulation.`;
  }
  if (quote.percentChange7d <= -50) {
    return `Deep drawdown (${quote.percentChange7d.toFixed(0)}%) — may indicate project-level failure rather than market-wide fear.`;
  }
  return `Standard contrarian risk: the "early" entry may remain "wrong" longer than expected if market fear deepens.`;
}

// =============================================================================
// Helpers
// =============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute a deterministic hash of the deliberation for on-chain anchoring.
 * This is included in the thesis metrics so the AI's reasoning is provably
 * part of the anchored record. The digest is *quantized* — see
 * `quantizeAdjustment` / `bucketAgreement` below — so LLM output jitter
 * doesn't churn the thesis hash and trigger redundant on-chain anchors.
 */
/**
 * Quantize an adjustment to the nearest 5-point bucket. The jury's adjustment
 * range is ±15; LLM output is non-deterministic, so the same market state can
 * yield +4 one cycle and +5 the next. Without quantization that single-bit
 * jitter churns the thesis hash and forces a redundant on-chain anchor (and
 * on Casper, a 50 CSPR payment-cap deploy). Buckets preserve the *meaningful*
 * conviction shift while absorbing LLM noise.
 */
function quantizeAdjustment(adj: number): number {
  return Math.round(adj / 5) * 5;
}

/**
 * Collapse the 5-level agreement scale to a 3-bucket sign. The jury waffling
 * between "agree" and "strong-agree" is not a meaningful thesis change — the
 * adjustment magnitude already encodes conviction. Only a flip between
 * agree / neutral / disagree moves the digest.
 */
function bucketAgreement(ag: JuryAgreement): -1 | 0 | 1 {
  if (ag === "disagree" || ag === "strong-disagree") return -1;
  if (ag === "neutral") return 0;
  return 1;
}

export function computeDeliberationDigest(deliberation: JuryDeliberation): string {
  // Compact, stable representation of the deliberation for hashing. Only
  // *meaningful* verdict shifts move the digest:
  //   - adjustments quantized to 5-point buckets (absorbs ±1-2 LLM jitter)
  //   - agreement collapsed to sign (agree vs strong-agree is not meaningful)
  //   - tokens the jury is neutral on (quantized adjustment 0) are dropped
  //   - verdicts sorted by symbol so token order doesn't move the digest
  // This makes the thesis-hash dedup in `anchorToMantle` actually fire when
  // market state is stable, so anchoring only happens when the jury's
  // *direction* on a token changes — not every cycle on LLM noise.
  const compact = {
    p: deliberation.provider,
    m: deliberation.model,
    v: deliberation.verdicts
      .map((v) => ({
        s: v.symbol,
        a: quantizeAdjustment(v.adjustment),
        ag: bucketAgreement(v.agreement),
      }))
      .filter((v) => v.a !== 0)
      .sort((a, b) => a.s.localeCompare(b.s)),
  };
  return JSON.stringify(compact);
}
