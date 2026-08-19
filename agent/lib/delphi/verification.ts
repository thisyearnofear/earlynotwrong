/**
 * Delphi Tier 4 — adversarial pre-entry verification.
 *
 * The forecast pipeline up to here has a known failure mode: an ensemble of
 * the SAME model family, fed the SAME briefing, produces three correlated
 * samples — median-combining correlated overconfidence still yields
 * overconfidence. (Production 2026-08: the Typhoon market was estimated
 * 0.95 by the ladder and settled NO.)
 *
 * This tier cross-examines each candidate ENTRY with an adversarial LLM from
 * a DIFFERENT model family, fired only after a signal has cleared every
 * other gate (edge, one-thesis, re-entry cooldown, sizing) — so the cost is
 * one extra LLM call per candidate trade, never one per market per cycle.
 *
 * Flow:
 *   1. The verifier sees the question, the estimate, the implied odds, and
 *      the same evidence the forecaster saw, and is prompted to ATTACK the
 *      thesis ("find the strongest reason this is overconfident").
 *   2. It returns its own calibrated probability + a verdict.
 *   3. `applyVerificationToProbability` (pure, exported for tests) blends
 *      the verifier's number into the estimate ONLY when the verdict is
 *      "overconfident" AND the disagreement exceeds the configured
 *      threshold — small disagreements are confirmation, not correction.
 *   4. The runner re-evaluates the edge gate with the adjusted estimate; if
 *      the edge no longer clears, the entry is skipped (logged + ledgared).
 *
 * Provider selection (cross-family-first):
 *   - `DELPHI_VERIFIER_PROVIDER` (optional) names a ladder provider the
 *     operator dedicates to verification; when it is keyed, it leads the
 *     cascade for this call only.
 *   - Otherwise the ladder order is rearranged to EXCLUDE the model family
 *     that produced the estimate (`crossFamilyOrder`) — a Qwen forecast is
 *     verified by non-Qwen providers and vice versa. Same family = same
 *     blind spots; the point is independent eyes.
 *   - With no alternative family keyed, the verifier degrades to the
 *     ordinary ladder and marks `crossFamily: false` — weaker, but never a
 *     hard blocker.
 */

import {
  chatCompletion,
  parseLenientJson,
  type LlmProviderName,
} from "../llm-providers.js";
import { AGENT_CONFIG } from "../config.js";
import type { ForecasterProvider } from "./probability.js";

// =============================================================================
// Types
// =============================================================================

export interface VerificationInput {
  question: string;
  category?: string;
  closesAt?: string;
  /** Outcome index + label of the candidate BUY. */
  outcomeIdx: number;
  outcomeLabel: string;
  /** The forecaster's probability for that outcome (the claim under attack). */
  estimatedProbability: number;
  /** Market-implied probability for the same outcome. */
  impliedProbability: number;
  /** Same evidence the forecaster saw (briefing text, if any). */
  webEvidenceText?: string;
  /** Authority facts, when a Tier-1 verifier matched. */
  authorityFacts?: string;
  /** Which provider produced the estimate (for cross-family exclusion). */
  estimateProvider?: ForecasterProvider;
  timeoutMs?: number;
}

export type VerificationVerdict = "agree" | "overconfident" | "underconfident";

export interface VerificationResult {
  /** True when a verifier answered (whatever the verdict). False = no LLM
   *  available / parse failure — treat as unverified, never as confirmed. */
  ran: boolean;
  verdict?: VerificationVerdict;
  /** The verifier's own calibrated probability for the outcome. */
  verifierProbability?: number;
  /** One-line reasoning (audit trail). */
  reasoning?: string;
  /** True when the verifying provider is a different model family than the
   *  estimator's — the strong form of cross-examination. */
  crossFamily?: boolean;
  provider?: LlmProviderName;
  model?: string;
}

interface RawVerificationResponse {
  probability?: number;
  verdict?: string;
  reasoning?: string;
}

// =============================================================================
// Cross-family provider ordering
// =============================================================================

/** Model families on the ladder. Same family = shared training blind spots. */
const PROVIDER_FAMILY: Record<LlmProviderName, string> = {
  "vercel-gateway": "glm",
  openrouter: "router",
  "b-ai": "deepseek",
  orcarouter: "deepseek",
  openai: "gpt",
  anthropic: "claude",
};

/** The forecaster's family (injected/unknown estimates can't be excluded). */
function familyOf(provider?: ForecasterProvider): string | null {
  if (!provider || provider === "injected") return null;
  return PROVIDER_FAMILY[provider] ?? null;
}

/**
 * Optional dedicated verifier provider: the operator can point the
 * cross-examination at a specific keyed ladder provider via
 * `DELPHI_VERIFIER_PROVIDER` (value = a LlmProviderName). When set AND
 * different from the estimator's family, it leads the cascade.
 */
export function dedicatedVerifierProvider(): LlmProviderName | null {
  const raw = (process.env.DELPHI_VERIFIER_PROVIDER ?? "").trim().toLowerCase();
  if (!raw) return null;
  const known: LlmProviderName[] = [
    "vercel-gateway",
    "openrouter",
    "b-ai",
    "orcarouter",
    "openai",
    "anthropic",
  ];
  return known.find((k) => k === raw) ?? null;
}

/**
 * The provider cascade order for a verification call: dedicated verifier
 * first (when keyed and cross-family), then every OTHER family, then the
 * estimator's own family last (it still works as a last resort, it just
 * can't lead). Exported for tests.
 */
export function crossFamilyOrder(estimateProvider?: ForecasterProvider): LlmProviderName[] {
  const estFamily = familyOf(estimateProvider);
  const dedicated = dedicatedVerifierProvider();

  const all: LlmProviderName[] = [
    "vercel-gateway",
    "openrouter",
    "b-ai",
    "orcarouter",
    "openai",
    "anthropic",
  ];
  const scored = all
    .map((p) => {
      const sameFamily = estFamily !== null && PROVIDER_FAMILY[p] === estFamily;
      let priority = 1; // default
      // The dedicated verifier leads — but only when it's actually
      // cross-family; a dedicated provider from the estimator's own family
      // has the same blind spots and drops to the back.
      if (dedicated === p) priority = sameFamily ? 2 : 0;
      else if (sameFamily) priority = 2; // same family last
      return { p, priority };
    })
    .sort((a, b) => a.priority - b.priority);
  return scored.map((s) => s.p);
}

// =============================================================================
// Prompt
// =============================================================================

const VERIFIER_SYSTEM_PROMPT = `You are the adversarial verification reviewer for an autonomous prediction-market trading agent. A forecaster just produced an estimate that is about to be traded. Your job is to ATTACK it.

You are not a second opinion — you are a red team. Find the strongest concrete reason the estimate is wrong, overconfident, or ignoring base rates. Consider:
- Base rates: how often do events like this actually happen?
- Timing: is the resolution window too short/long for the claimed probability?
- Evidence quality: does the supplied evidence actually support the estimate, or merely the question's framing?
- Market wisdom: the market-implied odds aggregate many participants — what do they know that the forecaster might not?

You MUST respond as a JSON object with this exact schema:
{
  "probability": 0.42,
  "verdict": "agree" | "overconfident" | "underconfident",
  "reasoning": "one sentence: the strongest attack or confirmation"
}

"probability" is YOUR calibrated probability for the outcome, 0-1.
"verdict": "overconfident" means the forecaster's probability is too extreme (your probability is meaningfully closer to the middle); "underconfident" the reverse; "agree" when you land within ~0.05 of it.
Be calibrated yourself: if the forecaster is right, say so. Agreeing is a valid verdict.`;

function buildVerifierPrompt(input: VerificationInput): string {
  const lines: string[] = [
    `Market question: ${input.question}`,
    `Category: ${input.category ?? "unknown"}`,
    `Closes/settles: ${input.closesAt ?? "unknown"}`,
    "",
    `Candidate trade: BUY outcome ${input.outcomeIdx} ("${input.outcomeLabel}")`,
    `Forecaster's estimate: P(outcome ${input.outcomeIdx}) = ${input.estimatedProbability.toFixed(2)}`,
    `Market-implied price:  P(outcome ${input.outcomeIdx}) = ${input.impliedProbability.toFixed(2)}`,
  ];
  if (input.authorityFacts) {
    lines.push("");
    lines.push("Authority data (the market's source of record):");
    lines.push(input.authorityFacts);
  }
  if (input.webEvidenceText) {
    lines.push("");
    lines.push("Evidence the forecaster saw (web briefing):");
    lines.push(input.webEvidenceText);
  }
  lines.push("");
  lines.push("Attack or confirm. Respond with the JSON object only.");
  return lines.join("\n");
}

// =============================================================================
// Verification call
// =============================================================================

/** Model selection mirrors the forecaster (see probability.ts). */
const VERIFIER_DEFAULT_MODELS = {
  "vercel-gateway": "zai/glm-5.2",
  openrouter: "nvidia/nemotron-3-ultra-550b-a55b:free",
  "b-ai": "deepseek-v4-flash",
  orcarouter: "deepseek/deepseek-v4-flash-free",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-haiku-20240307",
} as const;

/**
 * Run the adversarial verification for one candidate entry. NEVER throws —
 * any failure returns `{ ran: false }` and the entry proceeds unverified
 * (verification is a quality gate, not an availability gate).
 */
export async function runAdversarialVerification(
  input: VerificationInput,
): Promise<VerificationResult> {
  try {
    const result = await chatCompletion({
      systemPrompt: VERIFIER_SYSTEM_PROMPT,
      userPrompt: buildVerifierPrompt(input),
      models: {
        "vercel-gateway": { envVar: "VERCEL_GATEWAY_DELPHI_MODEL", defaultModel: VERIFIER_DEFAULT_MODELS["vercel-gateway"] },
        openrouter: { envVar: "OPENROUTER_DELPHI_MODEL", defaultModel: VERIFIER_DEFAULT_MODELS.openrouter },
        "b-ai": { envVar: "BAI_DELPHI_MODEL", defaultModel: VERIFIER_DEFAULT_MODELS["b-ai"] },
        orcarouter: { envVar: "ORCAROUTER_DELPHI_MODEL", defaultModel: VERIFIER_DEFAULT_MODELS.orcarouter },
        openai: { envVar: "OPENAI_DELPHI_MODEL", defaultModel: VERIFIER_DEFAULT_MODELS.openai },
        anthropic: { envVar: "ANTHROPIC_DELPHI_MODEL", defaultModel: VERIFIER_DEFAULT_MODELS.anthropic },
      },
      providerOrder: crossFamilyOrder(input.estimateProvider),
      maxTokens: 800,
      temperature: 0.3, // a touch of adversarial variety, still disciplined
      timeoutMs: input.timeoutMs ?? 45_000,
      xTitle: "Early Not Wrong - Delphi Adversarial Verifier",
    });
    if (!result) return { ran: false };

    const raw = parseLenientJson<RawVerificationResponse>(result.content);
    if (!raw || typeof raw.probability !== "number") return { ran: false, provider: result.provider, model: result.model };
    const verifierProbability = Math.min(0.99, Math.max(0.01, raw.probability));
    const verdict: VerificationVerdict =
      raw.verdict === "overconfident" || raw.verdict === "underconfident" || raw.verdict === "agree"
        ? raw.verdict
        : Math.abs(verifierProbability - input.estimatedProbability) <= 0.05
          ? "agree"
          : verifierProbability < input.estimatedProbability
            ? "overconfident"
            : "underconfident";

    const estFamily = familyOf(input.estimateProvider);
    const verFamily = PROVIDER_FAMILY[result.provider];
    return {
      ran: true,
      verdict,
      verifierProbability,
      reasoning: typeof raw.reasoning === "string" ? raw.reasoning : undefined,
      crossFamily: estFamily === null || verFamily !== estFamily,
      provider: result.provider,
      model: result.model,
    };
  } catch (err) {
    console.warn(
      `  [delphi-verify] verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ran: false };
  }
}

// =============================================================================
// Deterministic adjustment (pure)
// =============================================================================

export interface VerificationAdjustment {
  /** The adjusted probability for the candidate outcome (unchanged when no
   *  meaningful disagreement). */
  probability: number;
  /** True when the verifier's number was blended in. */
  adjusted: boolean;
  /** Why (audit trail — appears in the skip reason when edge collapses). */
  reason: string;
}

/**
 * Blend the verifier's probability into the estimate, but ONLY on a flagged
 * disagreement:
 *   - verdict "overconfident" and |est − ver| ≥ threshold →
 *     adjusted = (1 − w)·est + w·ver  (discount toward the verifier)
 *   - verdict "underconfident" and the same gap → symmetric nudge TOWARD
 *     the verifier (a genuinely stronger view can widen the edge)
 *   - "agree" or sub-threshold gap → return est unchanged (confirmed).
 *
 * Pure function of (estimate, verifier, verdict, weights) — exported for
 * tests. Defaults come from AGENT_CONFIG.delphi.
 */
export function applyVerificationToProbability(
  estimatedProbability: number,
  verification: Pick<VerificationResult, "ran" | "verdict" | "verifierProbability">,
  config: {
    weight?: number;
    disagreementThreshold?: number;
  } = {},
): VerificationAdjustment {
  if (!verification.ran || verification.verifierProbability === undefined || !verification.verdict) {
    return {
      probability: estimatedProbability,
      adjusted: false,
      reason: verification.ran ? "verifier answered without a usable probability" : "verification unavailable",
    };
  }
  const weight = config.weight ?? AGENT_CONFIG.delphi.verificationWeight;
  const threshold = config.disagreementThreshold ?? AGENT_CONFIG.delphi.verificationDisagreementThreshold;
  const ver = verification.verifierProbability;
  const gap = Math.abs(estimatedProbability - ver);

  if (verification.verdict === "agree" || gap < threshold) {
    return {
      probability: estimatedProbability,
      adjusted: false,
      reason: `verifier ${verification.verdict} (gap ${gap.toFixed(2)} < ${threshold})`,
    };
  }
  const adjusted = Math.min(0.99, Math.max(0.01, (1 - weight) * estimatedProbability + weight * ver));
  return {
    probability: adjusted,
    adjusted: true,
    reason: `verifier flagged ${verification.verdict}: est ${estimatedProbability.toFixed(2)} → ${adjusted.toFixed(2)} (w=${weight}, verifier ${ver.toFixed(2)})`,
  };
}
