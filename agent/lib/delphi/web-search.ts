/**
 * Delphi web search — multi-source market briefings behind a per-cycle
 * budget + cache.
 *
 * Prediction markets about CURRENT events are where an LLM's stale training
 * cutoff costs the most calibration. This module fetches a short, sourced
 * briefing per market question so the forecaster can reconcile its estimate
 * with fresh evidence (verified live: it moved the BTC-$150k estimate from
 * ~0.35 to ~0.02 against a $63k spot).
 *
 * Search rung ladder (first one that answers wins):
 *   1. firecrawl — `POST api.firecrawl.dev/v2/search`, KEYLESS (a free
 *      account key raises the limits when set). Returns ranked results with
 *      query-relevant HIGHLIGHTS already extracted into `description` —
 *      pure retrieval, no synthesis LLM, so it can't die with the gateway
 *      credit. Verified live 2026-08-18 (~1.3s per call).
 *   2. parallel — the free anonymous Parallel Search MCP
 *      (`search.parallel.ai/mcp`, JSON-RPC `tools/call web_search`).
 *      Objective-based search with LLM-excerpted passages; the redundancy
 *      rung if the keyless tiers thin out. Verified live 2026-08-18.
 *   3. exa-gateway — the original design: one Vercel AI Gateway
 *      `generateText` call gives the model the `exa_search` tool to search,
 *      read, and synthesize. Costs gateway credit (the Aug 2026 promo); it
 *      sits LAST now because its credit ran dry on 2026-08-15 and the two
 *      rungs above need no credit at all.
 *
 * Each rung owns a circuit breaker on the shared provider map so a dead
 * source costs one discovery call, not one per market per cycle
 * (production incident 2026-08-18: ~150 dead gateway searches/day).
 *
 * Budget + cache (shared across rungs — they're all free tiers):
 *   - maxCallsPerCycle (default 10): a hard cap on fresh searches per runner
 *     cycle so a 25-market discovery burst can't blow through the free tier.
 *   - cacheTtlMs (default 6h): repeat evaluations of the same market reuse
 *     the briefing — the runner re-evaluates every hour, news moves slower.
 *   - Budget exhaustion and search failures return null (skip context),
 *     never throw: the forecaster works with implied odds alone.
 *
 * The `ai` SDK is lazy-imported so simulator/test environments never load it
 * unless an Exa search actually runs.
 */

import {
  providerCircuitOpen,
  tripProviderCircuit,
  vercelGatewayFreeActive,
} from "../llm-providers.js";

// =============================================================================
// Types
// =============================================================================

/** Which search rung produced a briefing (provenance surfacing). */
export type BriefingSource = "firecrawl" | "parallel" | "exa";

export interface WebSearchBriefing {
  /** Short sourced briefing (2-6 sentences) for prompt injection. */
  text: string;
  /** Source URLs cited by the briefing (best-effort; may be empty). */
  sources: string[];
  /** True when served from cache. */
  cached: boolean;
  /** True when the call was skipped because the per-cycle budget ran out. */
  budgetExhausted: boolean;
  /** Which rung produced this briefing (undefined on legacy cached records). */
  source?: BriefingSource;
  /**
   * Tier 3 — two-source corroboration. True when a SECOND, independent rung
   * was queried for the same question and deterministically agreed (shared
   * source domain OR shared significant content tokens). No LLM involved —
   * pure overlap arithmetic. Undefined when corroboration wasn't attempted
   * (budget exhausted, only one rung eligible, corroboration disabled).
   * The forecaster treats an uncorroborated briefing as ordinary evidence;
   * corroborated evidence gets labeled stronger in the prompt.
   */
  corroborated?: boolean;
  /** Which rung supplied the cross-check (when corroborated was attempted). */
  corroboratedBy?: BriefingSource;
}

export interface DelphiWebSearchConfig {
  /** Gateway API key. Default: VERCEL_AI_GATEWAY_API_KEY env var. */
  apiKey?: string;
  /** Firecrawl API key (optional — keyless tier works without it; a free
   *  account key raises the rate limits). Default: FIRECRAWL_API_KEY env. */
  firecrawlApiKey?: string;
  /** Parallel API key (optional — anonymous tier works without it).
   *  Default: PARALLEL_API_KEY env. */
  parallelApiKey?: string;
  /** Gateway model used to synthesize the Exa briefing. Default: zai/glm-5.2 (free). */
  model?: string;
  /** Max fresh searches per cycle (across all rungs). Default: 10. */
  maxCallsPerCycle?: number;
  /** Briefing cache TTL (ms). Default: 6 hours. */
  cacheTtlMs?: number;
  /** Max results per search. Default: 5. */
  numResults?: number;
  /** Timeout per search call (ms). Default: 60_000. */
  timeoutMs?: number;
  /**
   * Tier 3 — when the primary rung answers, query the NEXT eligible rung for
   * the same question and mark the briefing `corroborated` on deterministic
   * overlap (costs one extra network call from the shared budget). Default:
   * true. Disable in tests / budget-poor environments.
   */
  corroborate?: boolean;
  /** Injectable Firecrawl runner (tests). */
  runFirecrawlSearch?: SearchRunner;
  /** Injectable Parallel runner (tests). */
  runParallelSearch?: SearchRunner;
  /** Injectable gateway/Exa runner (tests). */
  runGatewaySearch?: SearchRunner;
  /**
   * Legacy single-runner injection (tests written before the ladder). When
   * set it REPLACES the whole ladder — first source tried, no rungs after.
   */
  runSearch?: SearchRunner;
}

/** One search attempt against one rung. Returns null to pass to the next rung. */
type SearchRunner = (
  question: string,
  cfg: { model: string; numResults: number; timeoutMs: number },
) => Promise<WebSearchBriefing | null>;

/**
 * The web-search surface the runner depends on, as an interface so tests can
 * inject a no-op without constructing the network-backed class (which would
 * read API keys from the environment and hit the network). `DelphiWebSearch`
 * is the production implementation.
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

/** Extract http(s) URLs cited in a briefing text. */
export function extractSourceUrls(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s)"\]>]+/g) ?? [];
  // Dedupe, strip trailing punctuation, cap at 5.
  return [...new Set(urls.map((u) => u.replace(/[.,;:]+$/, "")))].slice(0, 5);
}

/** Cap injected evidence text so a huge highlight can't crowd the prompt. */
const MAX_BRIEFING_CHARS = 2_500;
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// =============================================================================
// Tier 3 — deterministic two-source corroboration (no LLM)
// =============================================================================
//
// A single search rung can serve a plausible-looking fabrication. Before a
// briefing gets the "corroborated" label, a SECOND independent rung is asked
// the same question and the two answers are compared with pure string/URL
// arithmetic:
//   - Shared source domain (e.g. both cite reuters.com) — different indexes
//     converging on the same primary source.
//   - Shared significant content tokens (numbers + 5+-letter words),
//     Jaccard-ish overlap above a small threshold.
// Zero inference cost; the result is a boolean the forecaster can weigh.

/** The registrable-ish domain of a URL: strip protocol/www/path, keep the
 *  last two labels. Returns null on anything that doesn't parse. */
export function urlDomain(url: string): string | null {
  try {
    const host = url.toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0];
    const labels = host.replace(/^www\./, "").split(".").filter(Boolean);
    if (labels.length < 2) return null;
    return labels.slice(-2).join(".");
  } catch {
    return null;
  }
}

/** Common English stopwords too generic to corroborate anything. */
const STOPWORDS = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which",
  "while", "would", "could", "should", "before", "being", "between",
  "through", "during", "against", "because", "million", "billion", "percent",
  "reported", "according", "including", "since", "still", "where", "other",
  "market", "markets", "price", "prices", "latest", "update", "updated",
  "following", "continued", "announced", "announces", "expected", "expects",
  "source", "sources", "article", "articles", "prediction", "predictions",
  "question", "resolution", "resolves", "forecast", "forecasts",
]);

/**
 * Significant content tokens for overlap comparison: numbers of 3+ digits
 * (thresholds, dates, counts) and lower-cased words of 5+ letters minus
 * stopwords. Deliberately narrow — a few shared significant tokens between
 * two independent retrieval stacks is real agreement; shared "the/and/of"
 * is noise.
 */
export function significantTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of text.toLowerCase().match(/\b\d{3,}\b|\b[a-z]{5,}\b/g) ?? []) {
    if (STOPWORDS.has(m)) continue;
    tokens.add(m);
  }
  return tokens;
}

/** Minimum shared significant tokens for content corroboration. */
const MIN_SHARED_TOKENS = 3;

export interface CorroborationResult {
  corroborated: boolean;
  /** "domain" | "content" | "domain+content" — how the two agreed. */
  basis?: string;
}

/**
 * Deterministic overlap test between two briefings of the SAME question.
 * Pure function — exported for tests.
 */
export function corroborationOverlap(
  primary: Pick<WebSearchBriefing, "text" | "sources">,
  cross: Pick<WebSearchBriefing, "text" | "sources">,
): CorroborationResult {
  // Domain agreement: both briefings cite at least one common source domain.
  const domainsA = new Set(primary.sources.map(urlDomain).filter((d): d is string => d !== null));
  let domainMatch = false;
  for (const url of cross.sources) {
    const d = urlDomain(url);
    if (d && domainsA.has(d)) {
      domainMatch = true;
      break;
    }
  }
  // Content agreement: ≥ MIN_SHARED_TOKENS shared significant tokens.
  const tokensA = significantTokens(primary.text);
  const tokensB = significantTokens(cross.text);
  let shared = 0;
  for (const t of tokensB) {
    if (tokensA.has(t) && ++shared >= MIN_SHARED_TOKENS) break;
  }
  const contentMatch = shared >= MIN_SHARED_TOKENS;

  if (domainMatch && contentMatch) return { corroborated: true, basis: "domain+content" };
  if (domainMatch) return { corroborated: true, basis: "domain" };
  if (contentMatch) return { corroborated: true, basis: "content" };
  return { corroborated: false };
}

/**
 * Does this error look like quota/credit exhaustion (not a transient fault)?
 * Used to decide between the 30-min breaker and the daily-reset breaker.
 */
export function isQuotaExhaustionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /credit balance/i.test(msg) ||
    /insufficient (credits|quota)/i.test(msg) ||
    /quota (exceeded|exhausted)/i.test(msg) ||
    /exceeded your current/i.test(msg) ||
    /error: 402/i.test(msg) ||
    /status(?: code)? 402/i.test(msg)
  );
}

/**
 * Trip the right breaker for a rung error: 402/quota exhaustion cannot
 * self-heal before the daily reset (or top-up), so use that window; plain
 * 429s with no Retry-After are treated the same; anything else gets the
 * standard 30-min breaker.
 */
function tripRungBreaker(rung: BriefingSource, err: unknown, providerName: string): void {
  if (isQuotaExhaustionError(err)) {
    const now = Date.now();
    const midnight = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate() + 1,
    );
    tripProviderCircuit(providerName, now, Math.max(midnight - now, 60_000));
    return;
  }
  // Explicit 429s on the keyless tiers are per-IP/per-hour throttles that
  // self-heal within minutes — give them a short breaker (5 min) instead of
  // the standard 30-min window, so the rung comes back as soon as plausible.
  if (/error: 429/i.test(err instanceof Error ? err.message : String(err))) {
    tripProviderCircuit(providerName, Date.now(), 5 * 60 * 1000);
    return;
  }
  tripProviderCircuit(providerName);
  console.warn(
    `  [delphi-search] ${rung} rung unhealthy (${err instanceof Error ? err.message : String(err)}) — breaker open`,
  );
}

// =============================================================================
// Rung 1: Firecrawl /v2/search (keyless, highlights on by default)
// =============================================================================

interface FirecrawlWebResult {
  url?: string;
  title?: string;
  /** Query-relevant highlight passage (or plain description) by default. */
  description?: string;
  position?: number;
}

interface FirecrawlNewsResult {
  url?: string;
  title?: string;
  snippet?: string;
  date?: string;
}

/**
 * Compose a briefing from Firecrawl's ranked results. The highlights model
 * already extracted query-relevant passages — no synthesis LLM needed, so
 * this rung has no inference dependency at all.
 */
export function firecrawlResultsToBriefing(
  web: FirecrawlWebResult[],
  news: FirecrawlNewsResult[],
  cap = MAX_BRIEFING_CHARS,
): { text: string; sources: string[] } | null {
  const lines: string[] = [];
  const sources: string[] = [];
  for (const r of web.slice(0, 5)) {
    const passage = (r.description ?? "").trim();
    if (!passage) continue;
    lines.push(`- ${passage}${r.url ? ` (${r.url})` : ""}`);
    if (r.url) sources.push(r.url);
  }
  for (const r of news.slice(0, 3)) {
    const snippet = (r.snippet ?? r.title ?? "").trim();
    if (!snippet) continue;
    lines.push(`- [news] ${snippet}${r.url ? ` (${r.url})` : ""}`);
    if (r.url) sources.push(r.url);
  }
  if (lines.length === 0) return null;
  let text = lines.join("\n");
  if (text.length > cap) text = `${text.slice(0, cap)}…`;
  return { text, sources: [...new Set(sources)].slice(0, 5) };
}

async function runFirecrawlSearch(
  question: string,
  cfg: { apiKey?: string; numResults: number; timeoutMs: number },
): Promise<WebSearchBriefing | null> {
  const response = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      query: question,
      limit: cfg.numResults,
      sources: ["web", "news"],
      // Most competition markets resolve within days — the past-week window
      // keeps the evidence current without over-constraining.
      tbs: "qdr:w",
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Firecrawl search error: ${response.status}${body ? ` — ${body.slice(0, 120)}` : ""}`);
  }
  const json = (await response.json()) as {
    success?: boolean;
    data?: { web?: FirecrawlWebResult[]; news?: FirecrawlNewsResult[] };
  };
  if (json.success === false) throw new Error("Firecrawl search error: success=false");
  const composed = firecrawlResultsToBriefing(json.data?.web ?? [], json.data?.news ?? []);
  if (!composed) return null;
  return { text: composed.text, sources: composed.sources, cached: false, budgetExhausted: false, source: "firecrawl" };
}

// =============================================================================
// Rung 2: Parallel Search MCP (free anonymous, objective-based)
// =============================================================================

interface ParallelExcerpt {
  url?: string;
  title?: string;
  excerpts?: string[];
  publish_date?: string | null;
}

/**
 * Compose a briefing from Parallel's excerpted results. Excerpts are already
 * LLM-extracted passages relevant to the objective; keep at most two per
 * result and cite the URL.
 */
export function parallelResultsToBriefing(results: ParallelExcerpt[]): { text: string; sources: string[] } | null {
  const lines: string[] = [];
  const sources: string[] = [];
  for (const r of results.slice(0, 5)) {
    const excerpt = (r.excerpts ?? []).slice(0, 2).join(" ").replace(/\s+/g, " ").trim();
    if (!excerpt) continue;
    lines.push(`- ${truncate(excerpt, 400)}${r.url ? ` (${r.url})` : ""}`);
    if (r.url) sources.push(r.url);
  }
  if (lines.length === 0) return null;
  return { text: truncate(lines.join("\n"), MAX_BRIEFING_CHARS), sources: [...new Set(sources)].slice(0, 5) };
}

/**
 * Parse a Streamable-HTTP MCP response body — the server may answer with
 * plain JSON or an SSE-framed stream depending on the Accept negotiation.
 */
export function parseMcpTextResult(body: string): string | null {
  const raw = body.includes("data:")
    ? body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n")
    : body;
  if (!raw.trim()) return null;
  try {
    const envelope = JSON.parse(raw) as {
      result?: { content?: Array<{ type?: string; text?: string }> };
      error?: { message?: string };
    };
    if (envelope.error) throw new Error(`Parallel MCP error: ${envelope.error.message ?? "unknown"}`);
    const textBlock = envelope.result?.content?.find((c) => c.type === "text");
    return textBlock?.text ?? null;
  } catch (err) {
    if (err instanceof SyntaxError) return null; // unparseable — treat as no result
    throw err;
  }
}

async function runParallelSearch(
  question: string,
  cfg: { apiKey?: string; numResults: number; timeoutMs: number },
): Promise<WebSearchBriefing | null> {
  const response = await fetch("https://search.parallel.ai/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "web_search",
        arguments: {
          objective:
            `Find recent, verifiable facts relevant to resolving this ` +
            `prediction market question (prefer the last few days): "${question}"`,
          // The tool wants 3-6 word keyword queries; the question itself
          // plus a date-scoped variant cover both angles.
          search_queries: [question.slice(0, 120), `latest ${question.slice(0, 100)}`],
        },
      },
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Parallel search error: ${response.status}${body ? ` — ${body.slice(0, 120)}` : ""}`);
  }
  const text = parseMcpTextResult(await response.text());
  if (!text) return null;
  const payload = JSON.parse(text) as { results?: ParallelExcerpt[] };
  const composed = parallelResultsToBriefing(payload.results ?? []);
  if (!composed) return null;
  return { text: composed.text, sources: composed.sources, cached: false, budgetExhausted: false, source: "parallel" };
}

// =============================================================================
// Rung 3: Exa via the Vercel AI Gateway (the original design; needs credit)
// =============================================================================

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
    text: truncate(briefing, MAX_BRIEFING_CHARS),
    sources: usedSearch ? extractSourceUrls(briefing) : [],
    cached: false,
    budgetExhausted: false,
    source: "exa",
  };
}

// =============================================================================
// Public API
// =============================================================================

/** A rung in the briefing ladder: a breaker-gated search runner. */
interface SearchRung {
  source: BriefingSource;
  /** Breaker name on the shared provider map. */
  breaker: string;
  run: SearchRunner;
  /** Extra eligibility beyond the breaker (e.g. the gateway promo gate). */
  eligible?: () => boolean;
}

export class DelphiWebSearch implements WebSearchSource {
  private readonly apiKey?: string;
  private readonly firecrawlApiKey?: string;
  private readonly parallelApiKey?: string;
  private readonly model: string;
  private readonly maxCallsPerCycle: number;
  private readonly cacheTtlMs: number;
  private readonly numResults: number;
  private readonly timeoutMs: number;
  private readonly corroborate: boolean;
  private readonly rungs: SearchRung[];
  private readonly cache = new Map<string, CacheEntry>();
  private callsThisCycle = 0;

  constructor(config: DelphiWebSearchConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.VERCEL_AI_GATEWAY_API_KEY;
    this.firecrawlApiKey = config.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY;
    this.parallelApiKey = config.parallelApiKey ?? process.env.PARALLEL_API_KEY;
    this.model = config.model ?? process.env.VERCEL_GATEWAY_DELPHI_MODEL ?? "zai/glm-5.2";
    this.maxCallsPerCycle = config.maxCallsPerCycle ?? 10;
    this.cacheTtlMs = config.cacheTtlMs ?? 6 * 60 * 60 * 1000;
    this.numResults = config.numResults ?? 5;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.corroborate = config.corroborate ?? true;

    const searchCfg = () => ({ model: this.model, numResults: this.numResults, timeoutMs: this.timeoutMs });

    if (config.runSearch) {
      // Legacy single-runner mode (older tests): one rung, no ladder.
      this.rungs = [{ source: "firecrawl", breaker: "firecrawl", run: config.runSearch }];
    } else {
      this.rungs = [
        {
          source: "firecrawl",
          breaker: "firecrawl",
          run: config.runFirecrawlSearch ?? ((q) => runFirecrawlSearch(q, { apiKey: this.firecrawlApiKey, ...searchCfg() })),
        },
        {
          source: "parallel",
          breaker: "parallel",
          run: config.runParallelSearch ?? ((q) => runParallelSearch(q, { apiKey: this.parallelApiKey, ...searchCfg() })),
        },
        {
          source: "exa",
          breaker: "vercel-gateway",
          // The Exa briefing is a gateway promo feature — it costs credit, so
          // it gates on the same promo window as the LLM ladder (after which
          // the forecaster still works on implied odds alone).
          eligible: () => Boolean(this.apiKey) && vercelGatewayFreeActive(),
          run: config.runGatewaySearch ?? ((q) => runGatewaySearch(q, { apiKey: this.apiKey ?? "", ...searchCfg() })),
        },
      ];
    }
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
   * Returns null when: the per-cycle budget is exhausted (and nothing is
   * cached), every eligible rung is breaker-open, or every rung failed for
   * this question. Never throws.
   *
   * Rung failures trip the rung's breaker on quota/credit exhaustion
   * (daily-reset window) so a dead source costs one discovery call, not one
   * per market per cycle. Cache hits cost nothing and always serve —
   * including while breakers are open.
   */
  async briefing(question: string): Promise<WebSearchBriefing | null> {
    const key = cacheKey(question);

    // Cache hit (TTL-agnostic of budget — a cached briefing costs nothing).
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < this.cacheTtlMs) {
      return { ...hit.briefing, cached: true, budgetExhausted: false };
    }

    for (let i = 0; i < this.rungs.length; i++) {
      const rung = this.rungs[i];
      if (rung.eligible && !rung.eligible()) continue;
      if (providerCircuitOpen(rung.breaker)) continue;
      // Budget counts NETWORK CALLS, not briefing attempts: a cascade through
      // three failing rungs must not triple the free-tier spend per market.
      if (this.callsThisCycle >= this.maxCallsPerCycle) {
        return null;
      }
      this.callsThisCycle++;
      try {
        const briefing = await rung.run(question, {
          model: this.model,
          numResults: this.numResults,
          timeoutMs: this.timeoutMs,
        });
        if (briefing) {
          // Tier 3 — two-source corroboration (best-effort, budget-permitting):
          // ask the next eligible rung the same question and compare the two
          // answers with pure overlap arithmetic. Never gates the primary —
          // corroborated=undefined means the check wasn't attempted.
          if (this.corroborate) {
            const cross = await this.crossCheckRung(question, i + 1, briefing);
            if (cross) {
              briefing.corroborated = cross.corroborated;
              if (cross.corroborated) briefing.corroboratedBy = cross.by;
            }
          }
          this.cache.set(key, { briefing, fetchedAt: Date.now() });
          return briefing;
        }
        // null = this rung answered with nothing relevant — try the next.
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        tripRungBreaker(rung.source, err, rung.breaker);
        console.warn(
          `  [delphi-search] ${rung.source} search failed for "${question.slice(0, 60)}": ${msg}`,
        );
      }
    }
    return null;
  }

  /**
   * Tier 3 cross-check: query the next eligible rung (from `startIdx` onward)
   * for the SAME question and deterministically compare answers
   * (`corroborationOverlap` — shared source domain or shared significant
   * tokens, no LLM). Costs one network call from the shared budget.
   *
   * Returns null when no cross-check ran (no eligible rung, budget out,
   * cross rung produced nothing, or it errored) — the caller leaves
   * `corroborated` undefined in that case. A failed cross rung trips its own
   * breaker but NEVER blocks the primary briefing.
   */
  private async crossCheckRung(
    question: string,
    startIdx: number,
    primary: WebSearchBriefing,
  ): Promise<{ corroborated: boolean; by: BriefingSource } | null> {
    for (let i = startIdx; i < this.rungs.length; i++) {
      const rung = this.rungs[i];
      if (rung.eligible && !rung.eligible()) continue;
      if (providerCircuitOpen(rung.breaker)) continue;
      if (this.callsThisCycle >= this.maxCallsPerCycle) return null;
      this.callsThisCycle++;
      try {
        const cross = await rung.run(question, {
          model: this.model,
          numResults: this.numResults,
          timeoutMs: this.timeoutMs,
        });
        if (!cross) return null; // cross-check answered nothing
        const overlap = corroborationOverlap(primary, cross);
        console.log(
          `  [delphi-search] corroboration (${primary.source ?? "?"} vs ${rung.source}): ` +
            `${overlap.corroborated ? `AGREED (${overlap.basis})` : "no overlap"}`,
        );
        return { corroborated: overlap.corroborated, by: rung.source };
      } catch (err) {
        tripRungBreaker(rung.source, err, rung.breaker);
        console.warn(
          `  [delphi-search] corroboration via ${rung.source} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }
    return null;
  }
}
