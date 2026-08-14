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
 * Semantics (matching the pre-consolidation behavior of both callers):
 *   - The FIRST provider with an API key configured is used — no cascade
 *     on error. Callers decide their own fallback (template mode for the
 *     jury, null for the Delphi forecaster).
 *   - Returns null when no provider key is set at all.
 *   - Throws on HTTP / network / timeout errors so callers can log + fall
 *     back.
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
  for (const name of PROVIDER_ORDER) {
    if (!process.env[PROVIDER_KEY_ENV[name]]) continue;
    if (models && !models[name]) continue;
    return name;
  }
  return null;
}

/**
 * Send one chat completion to the first available provider in the ladder.
 *
 * Returns null when no provider is configured; throws on transport or API
 * errors (callers catch and apply their own fallback policy).
 */
export async function chatCompletion(req: LlmChatRequest): Promise<LlmChatResult | null> {
  const provider = firstAvailableLlmProvider(req.models);
  if (!provider) return null;

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
      const response = await fetch(VERCEL_GATEWAY_URL, {
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
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
      const response = await fetch("https://api.anthropic.com/v1/messages", {
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
