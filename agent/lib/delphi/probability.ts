/**
 * Delphi Probability Estimation — the prediction-market jury.
 *
 * The Delphi analog of agent/lib/llm-jury.ts: where the token jury adjusts a
 * 6-factor conviction score by ±15, this jury *is* the signal — it estimates
 * a probability for each outcome of a binary prediction market, and the edge
 * gate compares that estimate against the market-implied price.
 *
 * Prediction-market edge ≠ token conviction:
 *   - Markets resolve once; there's no "hold through drawdown." The expensive
 *     mistake is buying a mispriced outcome, not selling a winner early.
 *   - Evidence of edge is calibration/Brier across many markets, not Sharpe.
 *     Every estimate we produce is recorded so it can join the ledger.
 *
 * Three modes (provider ladder shared with the token jury via
 * `agent/lib/llm-providers.ts`):
 *   1. LLM mode (OpenRouter > OpenAI > Anthropic) — real probability reasoning
 *   2. Estimator injection — a caller-provided function (used by tests + future
 *      quantitative estimators) that receives the same MarketEstimateInput
 *   3. Unavailable — returns null when no provider and no estimator are set
 *
 * The trade gate is deterministic: a pure function of edge, market mechanics
 * (price validity, slippage budget), and risk policy (bankroll fractions).
 * The LLM influences WHETHER we trade; the gate decides IF we can.
 */

// Re-exported so callers don't have to touch the executor for the market type.
export type { DelphiMarket } from "./executor.js";
import { SHARE_TOKEN_DECIMAL_SCALE } from "./executor.js";

import { AGENT_CONFIG } from "../config.js";
import { chatCompletion, parseLenientJson } from "../llm-providers.js";
import type { WebSearchBriefing } from "./web-search.js";

// =============================================================================
// Types
// =============================================================================

export type ForecasterProvider = "vercel-gateway" | "openrouter" | "hf-qwen" | "orcarouter" | "openai" | "anthropic" | "injected";

/** Per-outcome probability estimate from the jury. */
export interface OutcomeEstimate {
  /** Outcome index in the market's outcome list. */
  outcomeIdx: number;
  /** Estimated true probability, 0-1. Clamped to [0.01, 0.99]. */
  probability: number;
  /** One-sentence rationale for the Brier/calibration audit trail. */
  reasoning: string;
}

/**
 * How this forecast was produced — the visible epistemology of the system.
 * Surfaced on the dashboard card and in Telegram so the method (not just
 * the number) is part of the brand story.
 */
export interface ForecastProvenance {
  /** Which ladder answered ("injected" for estimator/tests). */
  provider: ForecasterProvider;
  /** The model that answered; ensembles carry " ×N median". */
  model: string;
  /** Ensemble samples combined (undefined when not ensembled). */
  samples?: number;
  /** True when an Exa web briefing was injected into the prompt. */
  webEvidence?: boolean;
  /** The blended crypto vol-baseline reference (undefined when none). */
  volAnchor?: number;
}

/** The jury's estimate for a single binary market. */
export interface MarketEstimate {
  marketAddress: string;
  /** The question being priced. */
  question: string;
  /** Market category (crypto/economics/politics/sports/culture/…). Drives
   *  the category-aware edge gate in evaluateProbabilitySignal. */
  category?: string;
  /** Probability estimates per outcome. For binary markets: length 2. */
  outcomes: OutcomeEstimate[];
  provider: ForecasterProvider;
  model: string;
  estimatedAt: number;
  /** Provenance for the audit trail + surfacing. Optional so older
   *  persisted estimates and injected test fixtures stay valid. */
  provenance?: ForecastProvenance;
}

/** Everything the estimator sees for one market. */
export interface MarketEstimateInput {
  marketAddress: string;
  question: string;
  category?: string;
  /** Market-implied probability per outcome (LMSR price), 0-1. */
  impliedProbabilities: number[];
  /** Outcome labels (e.g. ["Yes", "No"]). */
  outcomes: string[];
  /** Market close/settlement time, if known (ISO). */
  closesAt?: string;
  /**
   * Sourced web briefing (Exa via Vercel AI Gateway) for prompt injection.
   * Qualitative alpha the model can't know from stale training data.
   * Optional — the runner skips it when search is unavailable/budgeted out.
   */
  webBriefing?: WebSearchBriefing;
  /**
   * Quantitative reference probability for outcome 0 on crypto threshold
   * markets (driftless log-normal from realized vol — see vol-baseline.ts).
   * NOT shown to the LLM (keeps the samples independent); blended into the
   * final estimate mechanically after sampling.
   */
  volBaselineProbability?: number;
}

/** A caller-provided estimator (tests, quantitative models). */
export type ProbabilityEstimator = (
  input: MarketEstimateInput,
) => Promise<MarketEstimate | null> | MarketEstimate | null;

/** The actionable output: estimate + implied + the reasoned trade call. */
export interface ProbabilitySignal {
  marketAddress: string;
  question: string;
  outcomeIdx: number;
  /** Estimated true probability (0-1). */
  estimatedProbability: number;
  /** Market-implied probability (0-1). */
  impliedProbability: number;
  /** estimatedProbability − impliedProbability. Positive = underpriced. */
  edge: number;
  /** Actionable only when the gate clears. */
  decision: "buy" | "skip";
  /** Human-readable reason for the decision (audit trail). */
  reason: string;
  estimate: MarketEstimate;
}

export interface ProbabilityConfig {
  /**
   * Explicit edge-gate override (tests, kill switch). When unset, the gate
   * is category-aware: AGENT_CONFIG.delphi.categoryEdgeGates[category], or
   * defaultCategoryGate for unknown categories.
   */
  minEdgeToTrade?: number;
  /** Slippage budget consumed from the edge (0-1). Default: delphi.defaultSlippageBps. */
  slippageBudget?: number;
  /** Explicit estimator injection (tests / quant models). Beats LLM providers. */
  estimator?: ProbabilityEstimator;
  /** Timeout for LLM provider calls (ms). Default 45_000. */
  timeoutMs?: number;
  /**
   * Ensemble size: independent LLM samples combined by per-outcome median.
   * Default: AGENT_CONFIG.delphi.ensembleSamples (3). 1 disables ensembling.
   */
  ensembleSamples?: number;
  /**
   * Blend weight for the crypto vol baseline reference (0 = LLM only,
   * 1 = quant only). Default: AGENT_CONFIG.delphi.volBaselineWeight.
   */
  volBaselineWeight?: number;
}

// =============================================================================
// Prompt + Parsing (binary markets)
// =============================================================================

const FORECASTER_SYSTEM_PROMPT = `You are the probability forecaster for an autonomous prediction-market trading agent.

Your job: estimate the TRUE probability of each outcome in a prediction market (usually binary Yes/No, but some markets have 3+ outcomes such as price bands), then compare it to the market-implied probability. You are not picking winners — you are finding mispricings. A market you think is correctly priced is a pass.

Calibration rules:
- Your probabilities must sum to 1.0 across ALL outcomes.
- Return one entry per outcome index — do not omit any outcome.
- Reserve extreme estimates (<0.05 or >0.95) for outcomes you would bet on at those odds.
- If you have no informational edge over the market, your estimate should equal the implied probability and the edge should be ~0. Passing is a valid, often correct, answer.

You MUST respond as a JSON object with this exact schema:
{
  "outcomes": [
    {
      "outcomeIdx": 0,
      "probability": 0.62,
      "reasoning": "one sentence"
    }
  ]
}

Be calibrated: most markets are efficient. Only large, defensible mispricings justify a large edge.`;

function buildForecasterPrompt(input: MarketEstimateInput): string {
  const lines: string[] = [
    `Question: ${input.question}`,
    `Category: ${input.category ?? "unknown"}`,
    `Closes/settles: ${input.closesAt ?? "unknown"}`,
  ];

  // Context injection: a sourced web briefing, when available. Presented as
  // evidence, not instruction — the model must still reconcile it with the
  // market-implied odds. Vol baseline is deliberately NOT shown here: it
  // blends mechanically after sampling so the LLM samples stay independent.
  if (input.webBriefing?.text) {
    lines.push("");
    lines.push("Recent evidence (web search — cite only when relevant):");
    lines.push(input.webBriefing.text);
  }

  lines.push("");
  lines.push("Outcomes (index · label · market-implied probability):");
  input.outcomes.forEach((label, i) => {
    lines.push(`  ${i} · ${label} · ${(input.impliedProbabilities[i] ?? 0).toFixed(2)}`);
  });
  lines.push("");
  lines.push("Estimate true probabilities as a JSON object. Probabilities must sum to 1.0.");
  return lines.join("\n");
}

interface RawForecasterResponse {
  outcomes?: Array<{
    outcomeIdx?: number;
    probability?: number;
    reasoning?: string;
  }>;
}

/**
 * Clamp + normalize an estimate's probabilities: every value into (0.01,
 * 0.99), then scaled so the outcomes sum to 1.0. Applied on BOTH the LLM
 * parse path and the injected-estimator path so downstream gate math can
 * rely on the invariant.
 *
 * Exported for tests + future quantitative estimators.
 */
export function normalizeEstimate(estimate: MarketEstimate): MarketEstimate {
  const clamped = estimate.outcomes.map((o) => ({
    ...o,
    probability: Math.min(0.99, Math.max(0.01, o.probability)),
  }));
  const sum = clamped.reduce((acc, o) => acc + o.probability, 0);
  if (sum <= 0) return estimate;
  return {
    ...estimate,
    outcomes: clamped.map((o) => ({ ...o, probability: o.probability / sum })),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// =============================================================================
// Ensemble forecasting + vol-baseline blend (pure, testable)
// =============================================================================

/** Median of a numeric list (returns the mean for even-length lists). */
function median(values: number[]): number {
  if (values.length === 0) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Combine N valid market estimates into one by per-outcome median.
 *
 * Why median instead of mean: a single overconfident outlier sample (a known
 * LLM failure mode — "this is obviously 0.95") shouldn't drag the ensemble.
 * All inputs must have the same outcome layout; mismatched estimates are
 * dropped, and null is returned when nothing valid remains.
 *
 * Exported for tests.
 */
export function combineEstimates(estimates: MarketEstimate[]): MarketEstimate | null {
  const valid = estimates.filter((e) => e && e.outcomes.length >= 1);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const outcomeCount = valid[0].outcomes.length;
  if (valid.some((e) => e.outcomes.length !== outcomeCount)) return null;

  const outcomes: OutcomeEstimate[] = [];
  for (let idx = 0; idx < outcomeCount; idx++) {
    const samples = valid.map((e) => e.outcomes[idx].probability);
    const reasonings = valid.map((e) => e.outcomes[idx].reasoning).filter((r) => r.trim().length > 0);
    outcomes.push({
      outcomeIdx: idx,
      probability: median(samples),
      // Keep the median sample's rationale; the ensemble's spread is logged
      // by the caller, not stuffed into every reasoning string.
      reasoning: reasonings[Math.floor(reasonings.length / 2)] ?? "",
    });
  }

  return normalizeEstimate({
    marketAddress: valid[0].marketAddress,
    question: valid[0].question,
    category: valid[0].category,
    outcomes,
    provider: valid[0].provider,
    model: `${valid[0].model} ×${valid.length} median`,
    estimatedAt: Date.now(),
  });
}

/**
 * Blend an LLM estimate with the crypto vol-baseline reference probability.
 *
 * final₀ = (1 − w) · llm₀ + w · quant, final₁ = 1 − final₀. The quant
 * reference is a driftless log-normal P(close > threshold) computed from
 * realized volatility — it's not an opinion, it's arithmetic, so it anchors
 * the LLM against its well-documented bias toward round-number overconfidence
 * on threshold markets.
 *
 * Returns the input untouched when there's no reference, no weight, or a
 * wrong outcome layout. Exported for tests.
 */
export function blendVolBaseline(estimate: MarketEstimate, volBaseline: number | undefined, weight: number): MarketEstimate {
  if (volBaseline === undefined || volBaseline === null) return estimate;
  if (weight <= 0) return estimate;
  if (estimate.outcomes.length !== 2) return estimate;
  const w = Math.min(1, Math.max(0, weight));
  const blended0 = clamp((1 - w) * estimate.outcomes[0].probability + w * volBaseline, 0.01, 0.99);
  const blended1 = clamp(1 - blended0, 0.01, 0.99);
  return {
    ...estimate,
    outcomes: [
      {
        ...estimate.outcomes[0],
        probability: blended0,
        reasoning: `${estimate.outcomes[0].reasoning} [vol-baseline anchor ${volBaseline.toFixed(2)}, w=${w.toFixed(2)}]`,
      },
      { ...estimate.outcomes[1], probability: blended1 },
    ],
  };
}

// =============================================================================
// Category-aware edge gate
// =============================================================================

/**
 * The edge required before a trade is actionable, per market category.
 * Crypto threshold markets have a computed vol baseline, so they get the
 * standard gate; categories with no quantitative anchor (politics, culture)
 * demand more edge — the LLM estimate alone is a weaker signal.
 *
 * Exported for tests.
 */
export function minEdgeForCategory(category: string | undefined): number {
  const gates = AGENT_CONFIG.delphi.categoryEdgeGates as Record<string, number>;
  const key = (category ?? "").trim().toLowerCase();
  return gates[key] ?? AGENT_CONFIG.delphi.defaultCategoryGate;
}

// =============================================================================
// Sell-into-convergence exit policy (pure, testable)
// =============================================================================

/** Inputs for deciding whether an open position should be exited early. */
export interface ConvergenceExitInput {
  /** Estimated true probability at entry (our forecast for the held outcome). */
  forecast: number;
  /** Market price (implied probability of held outcome) at entry. */
  entryPrice: number;
  /** Current market price (implied probability) of the held outcome. */
  currentPrice: number;
  /** Take profit when price reaches within `tolerance` of forecast. */
  tolerance?: number;
  /** Stop when price falls this far below the entry price. */
  stopEdge?: number;
}

export type ConvergenceExitAction = "sell-convergence" | "sell-stop" | "hold";

export interface ConvergenceExit {
  action: ConvergenceExitAction;
  reason: string;
}

/**
 * Decide whether to exit an open position before settlement.
 *
 * The strategy is "sell into convergence": we bought an outcome because our
 * forecast was above the market price. If the price rises to converge with
 * our forecast, the edge we paid for is realized — sell and redeploy rather
 * than hold to settlement for a 1/0 payoff. If the price instead falls a
 * full `stopEdge` below our entry, the market is telling us the thesis is
 * wrong — cut the loss.
 *
 * Pure function of (forecast, entryPrice, currentPrice) + policy thresholds.
 * Defaults come from AGENT_CONFIG.delphi. Exported for tests.
 */
export function evaluateConvergenceExit(input: ConvergenceExitInput): ConvergenceExit {
  const tolerance = input.tolerance ?? AGENT_CONFIG.delphi.convergenceTolerance;
  const stopEdge = input.stopEdge ?? AGENT_CONFIG.delphi.thesisStopEdge;
  const { forecast, entryPrice, currentPrice } = input;
  // Float guard: 0.6 − 0.02 is 0.5800000000000001 in IEEE754 — an exact
  // boundary price must still trigger the exit it's meant to trigger.
  const EPS = 1e-9;

  if (!(currentPrice > 0 && currentPrice < 1)) {
    return { action: "hold", reason: "current price out of (0,1) bounds — cannot evaluate exit" };
  }

  // Take profit: price converged to within tolerance of our forecast.
  if (currentPrice >= forecast - tolerance - EPS) {
    return {
      action: "sell-convergence",
      reason: `converged: price ${currentPrice.toFixed(2)} ≥ forecast ${forecast.toFixed(2)} − tol ${tolerance}`,
    };
  }
  // Stop loss: price fell stopEdge below entry (moved against the thesis).
  if (currentPrice <= entryPrice - stopEdge + EPS) {
    return {
      action: "sell-stop",
      reason: `stopped: price ${currentPrice.toFixed(2)} ≤ entry ${entryPrice.toFixed(2)} − stop ${stopEdge}`,
    };
  }
  return { action: "hold", reason: "within thesis band" };
}

function parseForecasterResponse(
  content: string,
  input: MarketEstimateInput,
  provider: ForecasterProvider,
  model: string,
): MarketEstimate | null {
  // Lenient: GLM 5.2 wraps JSON in Markdown fences when the prompt includes
  // web evidence; openrouter/auto models vary too. See parseLenientJson.
  const raw = parseLenientJson<RawForecasterResponse>(content);
  if (!raw) return null;
  const outcomes: OutcomeEstimate[] = [];
  for (const o of raw.outcomes ?? []) {
    const idx = typeof o.outcomeIdx === "number" ? o.outcomeIdx : -1;
    if (idx < 0 || idx >= input.outcomes.length) continue;
    outcomes.push({
      outcomeIdx: idx,
      probability: clamp(o.probability ?? 0.5, 0.01, 0.99),
      reasoning: o.reasoning ?? "",
    });
  }
  if (outcomes.length !== input.outcomes.length) return null; // need every outcome
  return normalizeEstimate({
    marketAddress: input.marketAddress,
    question: input.question,
    category: input.category,
    outcomes,
    provider,
    model,
    estimatedAt: Date.now(),
  });
}

// =============================================================================
// LLM estimate (shared provider ladder — llm-providers.ts)
// =============================================================================

/** Default model per provider for the Delphi forecaster. Free-first: the
 *  Vercel AI Gateway's GLM 5.2 (free during the Aug 2026 promo) leads the
 *  ladder when its key is set. The OpenRouter default is an explicit `:free`
 *  model — NEVER `openrouter/auto` here: the OpenRouter account carries paid
 *  credits, and `auto` on a credited account routes to paid models.
 *  hf-qwen and orcarouter are $0 Qwen3.8-27B endpoints (verified live
 *  2026-08-15) that carry the load when the quota-limited tiers run dry. */
const FORECASTER_DEFAULT_MODELS = {
  "vercel-gateway": "zai/glm-5.2",
  openrouter: "nvidia/nemotron-3-ultra-550b-a55b:free",
  "hf-qwen": "Qwen/Qwen3.8-27B",
  orcarouter: "qwen/qwen3.8-27b-free",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-haiku-20240307",
} as const;

async function fetchLlmEstimate(
  input: MarketEstimateInput,
  timeoutMs: number,
): Promise<MarketEstimate | null> {
  const result = await chatCompletion({
    systemPrompt: FORECASTER_SYSTEM_PROMPT,
    userPrompt: buildForecasterPrompt(input),
    models: {
      "vercel-gateway": { envVar: "VERCEL_GATEWAY_DELPHI_MODEL", defaultModel: FORECASTER_DEFAULT_MODELS["vercel-gateway"] },
      openrouter: { envVar: "OPENROUTER_DELPHI_MODEL", defaultModel: FORECASTER_DEFAULT_MODELS.openrouter },
      "hf-qwen": { envVar: "HF_QWEN_DELPHI_MODEL", defaultModel: FORECASTER_DEFAULT_MODELS["hf-qwen"] },
      orcarouter: { envVar: "ORCAROUTER_DELPHI_MODEL", defaultModel: FORECASTER_DEFAULT_MODELS.orcarouter },
      openai: { envVar: "OPENAI_DELPHI_MODEL", defaultModel: FORECASTER_DEFAULT_MODELS.openai },
      anthropic: { envVar: "ANTHROPIC_DELPHI_MODEL", defaultModel: FORECASTER_DEFAULT_MODELS.anthropic },
    },
    maxTokens: 1600, // headroom for longer reasoning when web briefing context is injected
    temperature: 0.2, // lower temp than the token jury — calibration, not creativity
    timeoutMs,
    xTitle: "Early Not Wrong - Delphi Probability Forecaster",
  });
  if (!result) return null;
  return parseForecasterResponse(result.content, input, result.provider, result.model);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Estimate probabilities for one binary market.
 *
 * Priority: injected estimator > LLM ladder (Vercel gateway > OpenRouter >
 * OpenAI > Anthropic) > null.
 *
 * The LLM path is an ENSEMBLE: `ensembleSamples` independent estimates are
 * taken and combined by per-outcome median (kills single-sample
 * overconfidence). When the input carries a crypto vol-baseline reference
 * probability, the ensemble is blended toward it by `volBaselineWeight`.
 *
 * Returns null when no provider is configured or the estimate can't be
 * formed (provider error, malformed response, non-binary market).
 */
export async function estimateProbability(
  input: MarketEstimateInput,
  config: ProbabilityConfig = {},
): Promise<MarketEstimate | null> {
  // Binary only for now — multi-outcome LMSR needs a different sizing model.
  if (input.outcomes.length !== 2) return null;

  if (config.estimator) {
    try {
      const raw = await config.estimator(input);
      if (!raw) return null;
      // Injected estimators may omit category; inherit from the input so the
      // downstream category-aware gate always has it.
      const weight = config.volBaselineWeight ?? AGENT_CONFIG.delphi.volBaselineWeight;
      const estimate: MarketEstimate = {
        ...raw,
        category: raw.category ?? input.category,
        provenance: raw.provenance ?? {
          provider: raw.provider,
          model: raw.model,
          webEvidence: Boolean(input.webBriefing?.text),
          volAnchor: weight > 0 ? input.volBaselineProbability : undefined,
        },
      };
      // Apply the same mechanical blend to injected estimates so quant +
      // LLM paths share one post-processing pipeline (and so tests can
      // exercise blending without a provider).
      return blendVolBaseline(normalizeEstimate(estimate), input.volBaselineProbability, weight);
    } catch (err) {
      console.warn(
        `  [delphi-probability] injected estimator failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  const timeoutMs = config.timeoutMs ?? 45_000;
  const samples = Math.max(1, config.ensembleSamples ?? AGENT_CONFIG.delphi.ensembleSamples);

  // Independent samples. Run sequentially: free-tier rate limits punish
  // bursts, and 3 × ~3s is still a small fraction of the hourly cycle.
  const estimates: MarketEstimate[] = [];
  for (let i = 0; i < samples; i++) {
    try {
      const est = await fetchLlmEstimate(input, timeoutMs);
      if (est) estimates.push(est);
    } catch (err) {
      console.warn(
        `  [delphi-probability] LLM sample ${i + 1}/${samples} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (estimates.length === 0) return null;

  const combined = combineEstimates(estimates);
  if (!combined) return null;

  const weight = config.volBaselineWeight ?? AGENT_CONFIG.delphi.volBaselineWeight;
  const blended = blendVolBaseline(combined, input.volBaselineProbability, weight);

  if (estimates.length < samples) {
    console.warn(
      `  [delphi-probability] ensemble degraded: ${estimates.length}/${samples} samples for "${input.question.slice(0, 50)}"`,
    );
  }

  // Provenance for the audit trail + dashboard/Telegram surfacing.
  return {
    ...blended,
    provenance: {
      provider: combined.provider,
      model: combined.model,
      samples: estimates.length > 1 ? estimates.length : undefined,
      webEvidence: Boolean(input.webBriefing?.text),
      volAnchor: weight > 0 ? input.volBaselineProbability : undefined,
    },
  };
}

/**
 * Deterministic trade gate: decide whether an estimate justifies a trade.
 *
 * Pure function. The gate consumes edge (|estimate − implied|), market
 * mechanics (valid price, slippage budget), and risk policy. The LLM
 * influences the estimate; only the gate decides whether to trade.
 *
 * The edge threshold is category-aware (minEdgeForCategory) unless
 * config.minEdgeToTrade is set explicitly.
 */
export function evaluateProbabilitySignal(
  estimate: MarketEstimate,
  impliedProbabilities: number[],
  config: ProbabilityConfig = {},
): ProbabilitySignal[] {
  const minEdge = config.minEdgeToTrade ?? minEdgeForCategory(estimate.category);
  const slippageBudget = config.slippageBudget ?? 0.03;
  const signals: ProbabilitySignal[] = [];

  for (const outcome of estimate.outcomes) {
    const implied = impliedProbabilities[outcome.outcomeIdx] ?? 0;
    const edge = outcome.probability - implied;
    const absEdge = Math.abs(edge);

    let decision: "buy" | "skip" = "skip";
    let reason = "edge below threshold";

    if (implied <= 0 || implied >= 1) {
      reason = "implied probability out of (0,1) bounds — market mispriced at extremes";
    } else if (absEdge < minEdge) {
      reason = `edge ${absEdge.toFixed(3)} < minEdgeToTrade ${minEdge}`;
    } else if (absEdge - slippageBudget <= 0) {
      reason = `edge ${absEdge.toFixed(3)} consumed by slippage budget ${slippageBudget}`;
    } else if (edge > 0) {
      decision = "buy";
      reason = `underpriced: est ${outcome.probability.toFixed(2)} vs implied ${implied.toFixed(2)} (edge ${edge.toFixed(3)})`;
    } else {
      // edge < 0: overpriced — we don't short in this scaffold (would require
      // selling shares we don't hold). The runner can extend to sells later.
      reason = `overpriced by ${absEdge.toFixed(3)} — shorting not implemented in scaffold`;
    }

    signals.push({
      marketAddress: estimate.marketAddress,
      question: estimate.question,
      outcomeIdx: outcome.outcomeIdx,
      estimatedProbability: outcome.probability,
      impliedProbability: implied,
      edge,
      decision,
      reason,
      estimate,
    });
  }
  return signals;
}

// =============================================================================
// Sizing — bankroll fraction → shares, concentration caps
// =============================================================================

/**
 * Pure sizing function for LMSR entries.
 *
 * Given a token budget and a price per share, return the number of shares
 * (18-dec bigint) the budget buys. Returns 0n (no trade) when the budget is
 * too small to buy even a fraction of a share, or when price is out of
 * (0, 1) bounds.
 *
 * This is deliberately not in the executor: it's a policy function, pure and
 * chain-free, so it can be unit-tested against integer-overflow edge cases.
 */
export function sizeSharesBudget(tokensBudget: bigint, pricePerShare: number): bigint {
  if (tokensBudget <= 0n) return 0n;
  if (pricePerShare <= 0 || pricePerShare >= 1) return 0n;
  // shares(18-dec) = tokensBudget(6-dec TST) / price, bridged by 10^12:
  // budget × 1e6 × 10^12 / priceScaled. (Dividing by the scale instead —
  // the production incident 2026-08-15 — collapses every buy to 0 shares.)
  const scaled = tokensBudget * 1_000_000n;
  const priceScaled = BigInt(Math.round(pricePerShare * 1e6));
  if (priceScaled <= 0n) return 0n;
  return (scaled * SHARE_TOKEN_DECIMAL_SCALE) / priceScaled;
}

/**
 * Kelly-lite per-trade budget: never risk more than maxPositionFraction of
 * the bankroll in a single position, and never concentrate more than
 * maxMarketFraction of the bankroll in a single market.
 *
 * Both inputs are in the same token units (18-dec bigint). Returns the
 * allowed spend for THIS entry.
 */
export function perTradeBudget(params: {
  bankrollTokens: bigint;
  existingExposureTokens: bigint;
  marketExposureTokens: bigint;
  maxPositionFraction: number;
  maxMarketFraction: number;
}): bigint {
  const {
    bankrollTokens, existingExposureTokens, marketExposureTokens,
    maxPositionFraction, maxMarketFraction,
  } = params;
  if (bankrollTokens <= 0n) return 0n;

  const byPosition = BigInt(Math.floor(Number(bankrollTokens) * maxPositionFraction));
  const byMarketLimit = BigInt(Math.floor(Number(bankrollTokens) * maxMarketFraction)) - marketExposureTokens;
  const byPortfolio = bankrollTokens - existingExposureTokens;

  // The strictest cap wins. Never negative.
  const budget = [byPosition, byMarketLimit, byPortfolio].reduce((a, b) => (a < b ? a : b));
  return budget > 0n ? budget : 0n;
}
