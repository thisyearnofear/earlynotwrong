/**
 * Shared LLM provider ladder — the single source of truth for "ask an LLM".
 *
 * `llm-jury.ts` (token conviction jury) and `delphi/probability.ts`
 * (prediction-market forecaster) need the same plumbing: try the Vercel AI
 * Gateway (free promo models), then OpenRouter, OpenAI, Anthropic, with
 * per-call prompts and chat completions. This module owns that ladder so
 * callers only supply the prompt + decoding parameters and parse the
 * response themselves.
 *
 * Semantics:
 *   - Providers are tried in ladder order. On any error (HTTP status,
 *     network, timeout) the NEXT configured provider is tried — a free-tier
 *     402/429 blip on the gateway must not kill the whole ensemble
 *     (production incident 2026-08-15: gateway 402s dropped cycle
 *     estimates from 13 to 2 because the ladder did not cascade).
 *   - Returns null when no provider key is set at all.
 *   - Throws the LAST provider's error when every configured provider
 *     fails, so callers can log + apply their own fallback policy.
 *
 * Free-first policy: the Vercel AI Gateway sits at the TOP of the ladder.
 * During the Aug 2026 promo `zai/glm-5.2` is free on it; the paid provider
 * keys below are fallbacks, not the default path. Note the gateway rejects
 * `response_format: json_object` (400 Invalid input) — JSON output there is
 * enforced by the system prompt instead.
 */

export type LlmProviderName =
  | "vercel-gateway"
  | "openrouter"
  | "hf-qwen"
  | "orcarouter"
  | "openai"
  | "anthropic";

/** Per-provider model selection: an env override + a default model. */
export interface LlmModelSelection {
  /** Env var that overrides the model for this provider, e.g. "OPENROUTER_JURY_MODEL". */
  envVar: string;
  /** Model used when the override env var is unset. */
  defaultModel: string;
}

export interface LlmChatRequest {
  /** System prompt for the chat completion. */
  systemPrompt: string;
  /** User prompt for the chat completion. */
  userPrompt: string;
  /**
   * Model selection per provider the caller supports. Providers absent from
   * this map are skipped even when their API key is set — e.g. a caller can
   * opt out of the gateway (or Anthropic) by omitting it.
   */
  models: Partial<Record<LlmProviderName, LlmModelSelection>>;
  /** Max tokens in the response. Default: 1200. */
  maxTokens?: number;
  /** Sampling temperature. Default: 0.4. */
  temperature?: number;
  /** Abort timeout (ms). Default: 30_000. */
  timeoutMs?: number;
  /** OpenRouter ranking header (also used as the request identity). */
  xTitle?: string;
  /**
   * Request JSON-mode output. Applied to OpenRouter + OpenAI; Anthropic has
   * no response_format, and the Vercel gateway rejects it (400) — on those
   * two the system prompt carries the schema. Default: true.
   */
  jsonMode?: boolean;
  /**
   * Reasoning effort for the Vercel AI Gateway (its models are reasoning
   * models — without this, reasoning tokens eat the completion budget and
   * `content` comes back empty). Ignored by other providers. Default: "none"
   * for strict-JSON outputs; callers wanting deliberation can raise it.
   */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  /**
   * Override the cascade order for THIS call. Default: PROVIDER_ORDER
   * (free-first). Callers that want a different family first — e.g. the
   * Delphi adversarial verifier, which should cross-examine the Qwen
   * forecaster with a non-Qwen model when one is keyed — pass their own
   * order. Only providers that are ALSO present in `models` and otherwise
   * eligible run.
   */
  providerOrder?: LlmProviderName[];
}

export interface LlmChatResult {
  /** Which provider answered. */
  provider: LlmProviderName;
  /** The model that answered (after env override resolution). */
  model: string;
  /** Raw response text, trimmed. Parsing is the caller's job. */
  content: string;
}

/**
 * Provider priority — free-first:
 *   1. vercel-gateway (promo credit; circuit-breaker skips it when 402s)
 *   2. openrouter (`:free`-pinned model; 50 req/day free quota, resets 00:00 UTC)
 *   3. hf-qwen — public keyless HF Inference endpoint for Qwen3.8-27B
 *      (~30 req/min per IP, fast). The key env var accepts any value,
 *      including "none" — its presence is an explicit opt-in because the
 *      community endpoint is temporary ("retired after the launch buzz").
 *   4. orcarouter — $0 self-hosted Qwen3.8-27B on OrcaRouter infra
 *      (rate-limited, slow: ~10s TTFT, ~18% error rate observed 2026-08-15,
 *      so it sits behind the faster endpoint).
 *   5-6. paid keys (openai, anthropic) — last resort.
 */
const PROVIDER_ORDER: LlmProviderName[] = [
  "vercel-gateway",
  "openrouter",
  "hf-qwen",
  "orcarouter",
  "openai",
  "anthropic",
];

const PROVIDER_KEY_ENV: Record<LlmProviderName, string> = {
  "vercel-gateway": "VERCEL_AI_GATEWAY_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "hf-qwen": "HF_QWEN_API_KEY",
  orcarouter: "ORCAROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/** OpenAI-compatible base URL for the Vercel AI Gateway. */
const VERCEL_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

/** Public keyless HF Inference endpoint (Qwen3.8-27B, community deployment).
 * Resolved lazily: HF_QWEN_ENDPOINT_URL override is read at call time, not
 * module load (env-bootstrap may land after the import). */
function hfQwenUrl(): string {
  return (
    process.env.HF_QWEN_ENDPOINT_URL ??
    "https://g9hnto0u7lvbu837.us-east-2.aws.endpoints.huggingface.cloud/v1/chat/completions"
  );
}

/** OrcaRouter's OpenAI-compatible base URL ($0 free-tier models). */
const ORCAROUTER_URL = "https://api.orcarouter.ai/v1/chat/completions";

const OPENROUTER_REFERER = "https://earlynotwrong.vercel.app";

/**
 * HTTP header values must be ASCII (ByteString). A non-ASCII character
 * (e.g. an em dash in an X-Title) makes fetch throw before the request
 * leaves the process — production incident 2026-08-15: the OpenRouter
 * fallback died this way while cascading off a 402'd gateway. Strip
 * anything above 0x7F defensively.
 */
function asciiHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[^\x00-\x7F]/g, "");
}

/**
 * Temporary per-provider circuit breaker.
 *
 * Free tiers die in two ways observed in production (2026-08-15): the
 * Vercel gateway's promo credit ran dry (every request 402s), and
 * OpenRouter's `:free` daily quota hit 0 (every request 429s, no
 * Retry-After). Without a breaker the cascade pays one failing round-trip
 * per call — and worse, the retry backoffs eat the wall-clock budget the
 * next provider needs. While a provider's breaker is open we skip it
 * entirely. State is process-local; a pm2 restart retries everything.
 */
const BREAKER_MAP_KEY = "__llmProviderBreakerOpenUntil";
const PROVIDER_BREAKER_MS = 30 * 60 * 1000; // 30 minutes

function breakerMap(): Record<string, number> {
  const g = globalThis as Record<string, unknown>;
  if (!g[BREAKER_MAP_KEY] || typeof g[BREAKER_MAP_KEY] !== "object") {
    g[BREAKER_MAP_KEY] = {};
  }
  return g[BREAKER_MAP_KEY] as Record<string, number>;
}

export function providerCircuitOpen(provider: string, now: number = Date.now()): boolean {
  return now < (breakerMap()[provider] ?? 0);
}

export function tripProviderCircuit(provider: string, now: number = Date.now(), windowMs: number = PROVIDER_BREAKER_MS): void {
  breakerMap()[provider] = now + windowMs;
}

/**
 * Next 00:00 UTC as epoch ms — the reset point for daily free quotas
 * (OpenRouter's 50 req/day cap). Exported for tests.
 */
export function nextMidnightUtc(now: number = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/**
 * Duration until the next daily-quota reset. Used to size the breaker window
 * for a Retry-After-less 429 (quota exhaustion can't self-heal before then).
 */
function dailyQuotaBreakerMs(now: number = Date.now()): number {
  return Math.max(nextMidnightUtc(now) - now, 60_000);
}

/** Extract an HTTP status from our standardized provider error messages. */
function errorStatus(message: string): number | null {
  const m = message.match(/error: (\d{3})/);
  return m ? Number(m[1]) : null;
}

/**
 * Build our standardized provider error (`"<Label> error: <status>"`) while
 * preserving whether the response advertised a usable Retry-After window.
 * The cascade uses that flag to tell daily-quota exhaustion (no Retry-After,
 * can't self-heal before 00:00 UTC) apart from per-minute throttling
 * (Retry-After present, heals within minutes).
 */
function providerHttpError(label: string, response: Response): Error {
  const retryAfter = Number(response.headers.get("Retry-After"));
  const err = new Error(`${label} error: ${response.status}`) as Error & {
    retryAfterUsable?: boolean;
  };
  err.retryAfterUsable = Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 120;
  return err;
}

/**
 * fetch with bounded backoff retry for rate-limited free tiers.
 *
 * Retries ONLY on 429 (rate limit) and 5xx (server-side), once each, with a
 * growing delay. Other errors (400 bad request, auth) throw immediately —
 * retrying those just burns quota. The caller's AbortSignal still governs
 * total wall time. Exported for tests.
 *
 * Honors the Retry-After header on 429/503 (free-tier endpoints — e.g.
 * OpenRouter's `:free` models at ~20 req/min — advertise exactly when they
 * re-open). Production incident 2026-08-15: the OpenRouter fallback got 429s
 * and estimates dropped to 6/15 because the fixed 2s backoff re-fired too soon.
 *
 * `opts.attemptTimeoutMs` gives EVERY attempt its own timeout. Without it, a
 * caller-supplied `init.signal` spans all attempts + backoff waits, so a
 * provider that burns the budget on retries starves the next rung of the
 * cascade (the exact failure that aborted hf-qwen after OpenRouter's 429
 * retries). When set, each attempt runs against
 * `AbortSignal.any([callerSignal, freshTimeout])`.
 */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  opts: { retries?: number; baseDelayMs?: number; attemptTimeoutMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 2_000;
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const attemptInit =
      opts.attemptTimeoutMs !== undefined
        ? {
            ...init,
            signal: AbortSignal.any(
              [init.signal, AbortSignal.timeout(opts.attemptTimeoutMs)].filter(
                (s): s is AbortSignal => Boolean(s),
              ),
            ),
          }
        : init;
    const response = await fetch(url, attemptInit);
    // Retry ONLY explicit rate-limit (429) and server-side (5xx) responses.
    // `status === undefined` (plain-object test mocks) counts as success —
    // never retry an ambiguous response.
    if (!(response.status === 429 || response.status >= 500)) return response;
    lastResponse = response;
    if (attempt === retries) break;
    // Drain the body so the connection can be reused, then back off.
    await response.arrayBuffer().catch(() => undefined);
    // Retry-After wins over the exponential schedule when present and sane.
    const retryAfter = Number(response.headers.get("Retry-After"));
    const retryAfterUsable = Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 120;
    // A 429 with NO near-term Retry-After is quota exhaustion (e.g.
    // OpenRouter's 50/day free cap — reset is hours away), not transient
    // throttling. Retrying within this window cannot succeed; fail fast so
    // the cascade reaches the next rung, and the breaker skips this
    // provider for subsequent calls.
    if (response.status === 429 && !retryAfterUsable) break;
    const delay = retryAfterUsable ? retryAfter * 1000 : baseDelayMs * 2 ** attempt;
    await new Promise((r) => setTimeout(r, delay));
  }
  return lastResponse!;
}

/**
 * Lenient JSON extraction from an LLM response.
 *
 * Models asked for "a JSON object" still frequently wrap it in Markdown code
 * fences (observed with GLM 5.2 via the Vercel gateway when the prompt
 * includes web evidence), or surround it with prose. This helper tries, in
 * order: direct parse → fenced ```json/``` block → first balanced `{...}`
 * substring. Returns null when nothing parses.
 *
 * Shared by every JSON-producing caller (token jury + Delphi forecaster) —
 * keep fence-stripping logic in one place.
 */
export function parseLenientJson<T = unknown>(content: string): T | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // 1. Direct parse — the well-behaved case.
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }

  // 2. Markdown code fence: ```json ... ``` (with or without the language tag).
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {
      // fall through to brace extraction
    }
  }

  // 3. First balanced { ... } block (handles leading/trailing prose).
  const start = trimmed.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1)) as T;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * The first provider (in ladder order) that has BOTH an API key configured
 * and a model selection in `models`, or null when none qualify.
 */
export function firstAvailableLlmProvider(
  models?: Partial<Record<LlmProviderName, LlmModelSelection>>,
): LlmProviderName | null {
  return availableLlmProviders(models)[0] ?? null;
}

/**
 * Every provider (in ladder order) eligible for this request: key set,
 * promo gate passed, and a model selection present. The cascade in
 * chatCompletion walks this list in order.
 *
 * `order` optionally overrides the ladder order for one call (see
 * LlmChatRequest.providerOrder). Providers absent from `order` are still
 * appended in default order so a partial override can't starve the
 * cascade; if nothing eligible results, the override is ignored.
 */
export function availableLlmProviders(
  models?: Partial<Record<LlmProviderName, LlmModelSelection>>,
  order?: LlmProviderName[],
): LlmProviderName[] {
  const eligible = new Set<LlmProviderName>();
  for (const name of PROVIDER_ORDER) {
    if (!process.env[PROVIDER_KEY_ENV[name]]) continue;
    // Free-promo guard: the gateway only leads the ladder while its promo is
    // active (see vercelGatewayFreeActive). Afterwards OpenRouter takes over.
    if (name === "vercel-gateway" && !vercelGatewayFreeActive()) continue;
    // Quota-exhaustion guard: while a provider's breaker is open (persistent
    // 402/429), skip it entirely instead of paying failing round-trips.
    if (providerCircuitOpen(name)) continue;
    if (models && !models[name]) continue;
    eligible.add(name);
  }
  if (!order || order.length === 0) return [...eligible];
  const out: LlmProviderName[] = [];
  for (const name of order) {
    if (eligible.has(name) && !out.includes(name)) out.push(name);
  }
  for (const name of PROVIDER_ORDER) {
    if (eligible.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Free-promo guard for the Vercel AI Gateway.
 *
 * The Aug 2026 promo (GLM 5.2 free through 2026-08-27, Exa search through
 * 2026-08-31) is why the gateway leads the ladder and powers web briefings.
 * When it ends the gateway may start billing or rejecting, so we drop it
 * automatically: the forecaster/jury ladder falls through to OpenRouter
 * (pinned to an explicit `:free` model — the OpenRouter account has paid
 * credits, so `openrouter/auto` would silently bill), and web briefings are
 * skipped (briefing() returns null — the forecaster still works on implied
 * odds).
 *
 * Config: VERCEL_GATEWAY_PROMO_ENDS=YYYY-MM-DD is the first UTC day the
 * gateway is no longer free (default 2026-08-28 — the day after the GLM
 * promo ends). Set to "never" to disable the guard entirely. Exported so
 * web-search.ts applies the same gate to Exa briefings.
 */
export function vercelGatewayFreeActive(now: number = Date.now()): boolean {
  const ends = process.env.VERCEL_GATEWAY_PROMO_ENDS ?? "2026-08-28";
  if (ends.toLowerCase() === "never") return true;
  const cutoff = Date.parse(`${ends}T00:00:00Z`);
  if (!Number.isFinite(cutoff)) return true; // bad date → fail open (gateway key present)
  return now < cutoff;
}

/**
 * Chat completion against ONE provider (no cascade). Throws on transport or
 * API errors; the cascade in chatCompletion() walks providers in order.
 */
async function callProvider(provider: LlmProviderName, req: LlmChatRequest): Promise<LlmChatResult> {
  const selection = req.models[provider]!;
  const model = process.env[selection.envVar] || selection.defaultModel;
  const maxTokens = req.maxTokens ?? 1200;
  const temperature = req.temperature ?? 0.4;
  const timeoutMs = req.timeoutMs ?? 30_000;
  const jsonMode = req.jsonMode ?? true;

  switch (provider) {
    case "vercel-gateway": {
      // The gateway rejects response_format (verified: 400 Invalid input),
      // so JSON output is enforced purely by the system prompt. GLM 5.2 is a
      // reasoning model: without an explicit effort cap, reasoning tokens
      // consume the completion budget and `content` comes back empty — so we
      // always send a reasoning object (default "none" for strict JSON).
      const reasoningEffort = req.reasoningEffort ?? "none";
      const response = await fetchWithBackoff(VERCEL_GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.VERCEL_AI_GATEWAY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
          reasoning: { effort: reasoningEffort },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw providerHttpError("Vercel AI Gateway", response);
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return {
        provider: "vercel-gateway",
        model,
        content: json.choices?.[0]?.message?.content?.trim() ?? "",
      };
    }
    case "openrouter": {
      const response = await fetchWithBackoff("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          // Optional headers for OpenRouter rankings.
          "HTTP-Referer": OPENROUTER_REFERER,
          ...(req.xTitle ? { "X-Title": asciiHeader(req.xTitle) } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw providerHttpError("OpenRouter API", response);
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return {
        provider: "openrouter",
        model,
        content: json.choices?.[0]?.message?.content?.trim() ?? "",
      };
    }
    case "openai": {
      const response = await fetchWithBackoff("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw providerHttpError("OpenAI API", response);
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return {
        provider: "openai",
        model,
        content: json.choices?.[0]?.message?.content?.trim() ?? "",
      };
    }
    case "hf-qwen": {
      // Keyless community endpoint — any string works as the bearer. The
      // model id is the Hub id, not a routing slug. Thinking is ON by
      // default and eats the completion budget, so reasoning_effort is
      // always sent (verified 2026-08-15: "none" → clean JSON content).
      const response = await fetchWithBackoff(hfQwenUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HF_QWEN_API_KEY || "none"}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
          reasoning_effort: req.reasoningEffort ?? "none",
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw providerHttpError("HF Qwen endpoint", response);
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return {
        provider: "hf-qwen",
        model,
        content: json.choices?.[0]?.message?.content?.trim() ?? "",
      };
    }
    case "orcarouter": {
      // OpenRouter-shaped free tier ($0, rate-limited). Verified 2026-08-15:
      // `include_reasoning: false` hung; `reasoning_effort: "none"` returns
      // clean content fast. response_format is not in their verified param
      // list — JSON is enforced by the system prompt (same as the gateway).
      const response = await fetchWithBackoff(ORCAROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.ORCAROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
          reasoning_effort: req.reasoningEffort ?? "none",
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw providerHttpError("OrcaRouter", response);
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return {
        provider: "orcarouter",
        model,
        content: json.choices?.[0]?.message?.content?.trim() ?? "",
      };
    }
    case "anthropic": {
      const response = await fetchWithBackoff("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: req.systemPrompt,
          messages: [{ role: "user", content: req.userPrompt }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw providerHttpError("Anthropic API", response);
      const json = (await response.json()) as {
        content?: Array<{ text?: string }>;
      };
      return {
        provider: "anthropic",
        model,
        content: json.content?.[0]?.text?.trim() ?? "",
      };
    }
  }
}

/**
 * Send one chat completion, cascading through the ladder on error.
 *
 * Returns null when no provider is configured. When a provider fails
 * (HTTP status, network, timeout) the next eligible provider is tried —
 * a free-tier 402/429 blip on the gateway must not kill the whole
 * ensemble. Throws the last provider's error when every eligible provider
 * fails, so callers can log + apply their own fallback policy.
 */
export async function chatCompletion(req: LlmChatRequest): Promise<LlmChatResult | null> {
  const providers = availableLlmProviders(req.models, req.providerOrder);
  if (providers.length === 0) return null;

  let lastError: unknown = null;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      return await callProvider(provider, req);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // 402 = billing/credit exhaustion — permanent until topped up, so trip
      // a 30-min breaker per provider (observed: Vercel gateway promo credit
      // running dry mid-promo).
      //
      // 429 = two distinct cases (observed 2026-08-15/18):
      //   (a) Retry-After present → per-minute throttle; self-heals within
      //       minutes, so do NOT breaker it — fetchWithBackoff already
      //       honored the header on the way in.
      //   (b) No usable Retry-After → daily-quota exhaustion (OpenRouter's
      //       50 req/day free cap). Cannot self-heal before the next 00:00
      //       UTC reset, so trip a breaker sized to that reset — otherwise
      //       every ensemble sample pays one doomed round-trip (~270 wasted
      //       requests/day observed on the VPS).
      if (errorStatus(msg) === 402) {
        tripProviderCircuit(provider);
      } else if (errorStatus(msg) === 429 && !(err as { retryAfterUsable?: boolean }).retryAfterUsable) {
        tripProviderCircuit(provider, Date.now(), dailyQuotaBreakerMs());
      }
      if (i < providers.length - 1) {
        console.warn(
          `  [llm-providers] ${provider} failed (${msg}) — falling through to ${providers[i + 1]}`,
        );
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
