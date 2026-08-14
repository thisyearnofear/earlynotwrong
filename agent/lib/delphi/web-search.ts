/**
 * Delphi web search — Exa-backed market context via the Vercel AI Gateway.
 *
 * Prediction markets about CURRENT events are where an LLM's stale training
 * cutoff costs the most calibration. This module fetches a short, sourced
 * briefing per market question using Exa search, which the Vercel AI Gateway
 * routes natively (free promo through 2026-08-31 — no separate Exa key).
 *
 * Mechanics: a single `generateText` call gives the gateway model the
 * `exa_search` tool; the model searches, reads the results, and returns a
 * concise briefing + sources. This is one gateway request per market
 * (search + synthesis), not two.
 *
 * Budget + cache:
 *   - maxCallsPerCycle (default 10): a hard cap on fresh searches per runner
 *     cycle so a 25-market discovery burst can't blow through the free tier.
 *   - cacheTtlMs (default 6h): repeat evaluations of the same market reuse
 *     the briefing — the runner re-evaluates every hour, news moves slower.
 *   - Budget exhaustion and search failures return null (skip context),
 *     never throw: the forecaster works with implied odds alone.
 *
 * The `ai` SDK is lazy-imported so simulator/test environments never load it
 * unless a search actually runs.
 */

import { vercelGatewayFreeActive } from "../llm-providers.js";

// =============================================================================
// Types
// =============================================================================

export interface WebSearchBriefing {
  /** Short sourced briefing (2-6 sentences) for prompt injection. */
  text: string;
  /** Source URLs the model cited (best-effort; may be empty). */
  sources: string[];
  /** True when served from cache. */
  cached: boolean;
  /** True when the call was skipped because the per-cycle budget ran out. */
  budgetExhausted: boolean;
}

export interface DelphiWebSearchConfig {
  /** Gateway API key. Default: VERCEL_AI_GATEWAY_API_KEY env var. */
  apiKey?: string;
  /** Gateway model used to synthesize the briefing. Default: zai/glm-5.2 (free). */
  model?: string;
  /** Max fresh Exa searches per cycle. Default: 10. */
  maxCallsPerCycle?: number;
  /** Briefing cache TTL (ms). Default: 6 hours. */
  cacheTtlMs?: number;
  /** Max Exa results per search. Default: 5. */
  numResults?: number;
  /** Timeout for the whole generateText loop (ms). Default: 60_000. */
  timeoutMs?: number;
  /** Injectable search runner (tests). */
  runSearch?: (query: string, cfg: Required<Pick<DelphiWebSearchConfig, "model" | "numResults">>) => Promise<WebSearchBriefing | null>;
}

/**
 * The web-search surface the runner depends on, as an interface so tests can
 * inject a no-op without constructing the gateway-backed class (which would
 * read VERCEL_AI_GATEWAY_API_KEY from the environment and hit the network).
 * `DelphiWebSearch` is the production implementation.
 */
export interface WebSearchSource {
  /** Reset the per-cycle budget counter. Call at the start of each cycle. */
  resetCycleBudget(): void;
  /** Get a sourced briefing for a market question, or null to skip context. */
  briefing(question: string): Promise<WebSearchBriefing | null>;
}

// =============================================================================
// Cache + budget state
// =============================================================================

interface CacheEntry {
  briefing: WebSearchBriefing;
  fetchedAt: number;
}

/** Stable cache key — the question text fully determines the briefing. */
function cacheKey(question: string): string {
  return question.trim().toLowerCase();
}

// =============================================================================
// Gateway search (default runSearch)
// =============================================================================

/** Extract http(s) URLs cited in the model's briefing text. */
export function extractSourceUrls(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s)"\]>]+/g) ?? [];
  // Dedupe, strip trailing punctuation, cap at 5.
  return [...new Set(urls.map((u) => u.replace(/[.,;:]+$/, "")))].slice(0, 5);
}

async function runGatewaySearch(
  question: string,
  cfg: { apiKey: string; model: string; numResults: number; timeoutMs: number },
): Promise<WebSearchBriefing | null> {
  // Lazy import — the `ai` SDK is only needed when a real search runs.
  const { createGateway, generateText, stepCountIs } = await import("ai");
  const gateway = createGateway({ apiKey: cfg.apiKey });

  const { text, steps } = await generateText({
    model: gateway.languageModel(cfg.model),
    prompt:
      `Search the web for current information relevant to this prediction market question:\n\n` +
      `"${question}"\n\n` +
      `Then write a briefing of 2-6 sentences summarizing ONLY verifiable, ` +
      `recent facts relevant to how the question will resolve. Cite source ` +
      `URLs inline. Do not speculate; if you find nothing recent, say so.`,
    tools: { exa_search: gateway.tools.exaSearch({ numResults: cfg.numResults }) },
    stopWhen: stepCountIs(4),
    abortSignal: AbortSignal.timeout(cfg.timeoutMs),
  });

  const usedSearch = steps.some((s) => (s.toolCalls?.length ?? 0) > 0);
  const briefing = (text ?? "").trim();
  if (!briefing) return null;
  return {
    text: briefing,
    sources: usedSearch ? extractSourceUrls(briefing) : [],
    cached: false,
    budgetExhausted: false,
  };
}

// =============================================================================
// Public API
// =============================================================================

export class DelphiWebSearch implements WebSearchSource {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly maxCallsPerCycle: number;
  private readonly cacheTtlMs: number;
  private readonly numResults: number;
  private readonly timeoutMs: number;
  private readonly runSearch: NonNullable<DelphiWebSearchConfig["runSearch"]>;
  private readonly cache = new Map<string, CacheEntry>();
  private callsThisCycle = 0;

  constructor(config: DelphiWebSearchConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.VERCEL_AI_GATEWAY_API_KEY;
    this.model = config.model ?? process.env.VERCEL_GATEWAY_DELPHI_MODEL ?? "zai/glm-5.2";
    this.maxCallsPerCycle = config.maxCallsPerCycle ?? 10;
    this.cacheTtlMs = config.cacheTtlMs ?? 6 * 60 * 60 * 1000;
    this.numResults = config.numResults ?? 5;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.runSearch =
      config.runSearch ??
      ((question, cfg) =>
        runGatewaySearch(question, {
          apiKey: this.apiKey ?? "",
          model: cfg.model,
          numResults: cfg.numResults,
          timeoutMs: this.timeoutMs,
        }));
  }

  /** Reset the per-cycle budget counter. Call at the start of each cycle. */
  resetCycleBudget(): void {
    this.callsThisCycle = 0;
  }

  /** Fresh searches used this cycle (observability). */
  get cycleCalls(): number {
    return this.callsThisCycle;
  }

  /**
   * Get a sourced briefing for a market question.
   *
   * Returns null when: no gateway key is configured, the gateway's free
   * promo has expired (see vercelGatewayFreeActive — briefings are an Exa
   * promo feature, so they switch off with it rather than start billing),
   * the per-cycle budget is exhausted (and nothing is cached), or the search
   * fails. Never throws.
   */
  async briefing(question: string): Promise<WebSearchBriefing | null> {
    if (!this.apiKey) return null;
    if (!vercelGatewayFreeActive()) return null;
    const key = cacheKey(question);

    // Cache hit (TTL-agnostic of budget — a cached briefing costs nothing).
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < this.cacheTtlMs) {
      return { ...hit.briefing, cached: true, budgetExhausted: false };
    }

    if (this.callsThisCycle >= this.maxCallsPerCycle) {
      return null;
    }
    this.callsThisCycle++;

    try {
      const briefing = await this.runSearch(question, {
        model: this.model,
        numResults: this.numResults,
      });
      if (briefing) {
        this.cache.set(key, { briefing, fetchedAt: Date.now() });
      }
      return briefing;
    } catch (err) {
      console.warn(
        `  [delphi-search] web search failed for "${question.slice(0, 60)}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
