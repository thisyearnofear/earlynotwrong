/**
 * Shared LLM provider ladder — the single source of truth for "ask an LLM".
 *
 * Both `llm-jury.ts` (token conviction jury) and `delphi/probability.ts`
 * (prediction-market forecaster) need the same plumbing: try OpenRouter,
 * then OpenAI, then Anthropic, with per-call prompts and JSON-mode chat
 * completions. This module owns that ladder so callers only supply the
 * prompt + decoding parameters and parse the response themselves.
 *
 * Semantics (matching the pre-consolidation behavior of both callers):
 *   - The FIRST provider with an API key configured is used — no cascade
 *     on error. Callers decide their own fallback (template mode for the
 *     jury, null for the Delphi forecaster).
 *   - Returns null when no provider key is set at all.
 *   - Throws on HTTP / network / timeout errors so callers can log + fall
 *     back.
 */

export type LlmProviderName = "openrouter" | "openai" | "anthropic";

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
   * this map are skipped even when their API key is set — e.g. the Delphi
   * forecaster can opt out of Anthropic by omitting it.
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
   * Request JSON-mode output. Applied to OpenRouter + OpenAI (Anthropic has
   * no response_format; the system prompt must carry the schema). Default: true.
   */
  jsonMode?: boolean;
}

export interface LlmChatResult {
  /** Which provider answered. */
  provider: LlmProviderName;
  /** The model that answered (after env override resolution). */
  model: string;
  /** Raw response text, trimmed. Parsing is the caller's job. */
  content: string;
}

/** Provider priority — OpenRouter > OpenAI > Anthropic (matches both callers). */
const PROVIDER_ORDER: LlmProviderName[] = ["openrouter", "openai", "anthropic"];

const PROVIDER_KEY_ENV: Record<LlmProviderName, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const OPENROUTER_REFERER = "https://earlynotwrong.vercel.app";

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
