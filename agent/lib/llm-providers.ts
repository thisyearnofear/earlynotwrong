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

export type LlmProviderName = "vercel-gateway" | "openrouter" | "openai" | "anthropic";

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
}

export interface LlmChatResult {
  /** Which provider answered. */
  provider: LlmProviderName;
  /** The model that answered (after env override resolution). */
  model: string;
  /** Raw response text, trimmed. Parsing is the caller's job. */
  content: string;
}

/** Provider priority — free-first: Vercel AI Gateway > OpenRouter > OpenAI > Anthropic. */
const PROVIDER_ORDER: LlmProviderName[] = ["vercel-gateway", "openrouter", "openai", "anthropic"];

const PROVIDER_KEY_ENV: Record<LlmProviderName, string> = {
  "vercel-gateway": "VERCEL_AI_GATEWAY_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/** OpenAI-compatible base URL for the Vercel AI Gateway. */
const VERCEL_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

const OPENROUTER_REFERER = "https://earlynotwrong.vercel.app";

/**
 * fetch with bounded backoff retry for rate-limited free tiers.
 *
 * Retries ONLY on 429 (rate limit) and 5xx (server-side), once each, with a
 * growing delay. Other errors (400 bad request, auth) throw immediately —
 * retrying those just burns quota. The caller's AbortSignal still governs
 * total wall time. Exported for tests.
 */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 2_000;
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, init);
    // Retry ONLY explicit rate-limit (429) and server-side (5xx) responses.
    // `status === undefined` (plain-object test mocks) counts as success —
    // never retry an ambiguous response.
    if (!(response.status === 429 || response.status >= 500)) return response;
    lastResponse = response;
    if (attempt === retries) break;
    // Drain the body so the connection can be reused, then back off.
    await response.arrayBuffer().catch(() => undefined);
    const delay = baseDelayMs * 2 ** attempt;
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
 */
export function availableLlmProviders(
  models?: Partial<Record<LlmProviderName, LlmModelSelection>>,
): LlmProviderName[] {
  const out: LlmProviderName[] = [];
  for (const name of PROVIDER_ORDER) {
    if (!process.env[PROVIDER_KEY_ENV[name]]) continue;
    // Free-promo guard: the gateway only leads the ladder while its promo is
    // active (see vercelGatewayFreeActive). Afterwards OpenRouter takes over.
    if (name === "vercel-gateway" && !vercelGatewayFreeActive()) continue;
    if (models && !models[name]) continue;
    out.push(name);
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
      if (!response.ok) throw new Error(`Vercel AI Gateway error: ${response.status}`);
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
          ...(req.xTitle ? { "X-Title": req.xTitle } : {}),
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
      if (!response.ok) throw new Error(`OpenRouter API error: ${response.status}`);
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
      if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return {
        provider: "openai",
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
      if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
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
  const providers = availableLlmProviders(req.models);
  if (providers.length === 0) return null;

  let lastError: unknown = null;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      return await callProvider(provider, req);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i < providers.length - 1) {
        console.warn(
          `  [llm-providers] ${provider} failed (${msg}) — falling through to ${providers[i + 1]}`,
        );
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
