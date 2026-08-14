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

import { chatCompletion } from "../llm-providers.js";

// =============================================================================
// Types
// =============================================================================

export type ForecasterProvider = "openrouter" | "openai" | "anthropic" | "injected";

/** Per-outcome probability estimate from the jury. */
export interface OutcomeEstimate {
  /** Outcome index in the market's outcome list. */
  outcomeIdx: number;
  /** Estimated true probability, 0-1. Clamped to [0.01, 0.99]. */
  probability: number;
  /** One-sentence rationale for the Brier/calibration audit trail. */
  reasoning: string;
}

/** The jury's estimate for a single binary market. */
export interface MarketEstimate {
  marketAddress: string;
  /** The question being priced. */
  question: string;
  /** Probability estimates per outcome. For binary markets: length 2. */
  outcomes: OutcomeEstimate[];
  provider: ForecasterProvider;
  model: string;
  estimatedAt: number;
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
  /** Minimum |edge| to consider a trade. Default: AGENT_CONFIG.delphi.minEdgeToTrade = 0.08. */
  minEdgeToTrade?: number;
  /** Slippage budget consumed from the edge (0-1). Default: delphi.defaultSlippageBps. */
  slippageBudget?: number;
  /** Explicit estimator injection (tests / quant models). Beats LLM providers. */
  estimator?: ProbabilityEstimator;
  /** Timeout for LLM provider calls (ms). Default 45_000. */
  timeoutMs?: number;
}

// =============================================================================
// Prompt + Parsing (binary markets)
// =============================================================================

const FORECASTER_SYSTEM_PROMPT = `You are the probability forecaster for an autonomous prediction-market trading agent.

Your job: estimate the TRUE probability of each outcome in a binary prediction market, then compare it to the market-implied probability. You are not picking winners — you are finding mispricings. A market you think is correctly priced is a pass.

Calibration rules:
- Your probabilities must sum to 1.0 across outcomes.
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
    "",
    "Outcomes (index · label · market-implied probability):",
  ];
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

function parseForecasterResponse(
  content: string,
  input: MarketEstimateInput,
  provider: ForecasterProvider,
  model: string,
): MarketEstimate | null {
  let raw: RawForecasterResponse;
  try {
    raw = JSON.parse(content) as RawForecasterResponse;
  } catch {
    return null;
  }
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
    outcomes,
    provider,
    model,
    estimatedAt: Date.now(),
  });
}

// =============================================================================
// LLM estimate (shared provider ladder — llm-providers.ts)
// =============================================================================

/** Default model per provider for the Delphi forecaster. */
const FORECASTER_DEFAULT_MODELS = {
  openrouter: "openrouter/auto",
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
      openrouter: { envVar: "OPENROUTER_DELPHI_MODEL", defaultModel: FORECASTER_DEFAULT_MODELS.openrouter },
      openai: { envVar: "OPENAI_DELPHI_MODEL", defaultModel: FORECASTER_DEFAULT_MODELS.openai },
      anthropic: { envVar: "ANTHROPIC_DELPHI_MODEL", defaultModel: FORECASTER_DEFAULT_MODELS.anthropic },
    },
    maxTokens: 800,
    temperature: 0.2, // lower temp than the token jury — calibration, not creativity
    timeoutMs,
    xTitle: "Early Not Wrong — Delphi Probability Forecaster",
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
 * Priority: injected estimator > OpenRouter > OpenAI > Anthropic > null.
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
      return raw ? normalizeEstimate(raw) : null;
    } catch (err) {
      console.warn(
        `  [delphi-probability] injected estimator failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  const timeoutMs = config.timeoutMs ?? 45_000;
  try {
    return await fetchLlmEstimate(input, timeoutMs);
  } catch (err) {
    console.warn(
      `  [delphi-probability] LLM estimate failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Deterministic trade gate: decide whether an estimate justifies a trade.
 *
 * Pure function. The gate consumes edge (|estimate − implied|), market
 * mechanics (valid price, slippage budget), and risk policy. The LLM
 * influences the estimate; only the gate decides whether to trade.
 */
export function evaluateProbabilitySignal(
  estimate: MarketEstimate,
  impliedProbabilities: number[],
  config: ProbabilityConfig = {},
): ProbabilitySignal[] {
  const minEdge = config.minEdgeToTrade ?? 0.08;
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
  // shares = budget / price; keep 18-dec precision by scaling before dividing.
  const scaled = tokensBudget * 1_000_000n;
  const priceScaled = BigInt(Math.round(pricePerShare * 1e6));
  if (priceScaled <= 0n) return 0n;
  return scaled / priceScaled;
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
