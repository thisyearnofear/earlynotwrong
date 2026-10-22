/**
 * Conviction Gym — Beam policy.
 *
 * Reflection's Beam (501B MoE, 1M context, agentic-tuned) plays the
 * environment directly: each step it receives the text-rendered observation
 * and returns a JSON action. Failures degrade to `hold` and are recorded in
 * the trace — an LLM agent that can't produce a legal action shouldn't
 * crash the rollout, it should just look bad in the metrics.
 *
 * Endpoint: any OpenAI-compatible chat API.
 *   BEAM_API_BASE  default https://router.huggingface.co/v1
 *                  (Hugging Face Inference Providers — the $25 hackathon
 *                  credits cover Beam here)
 *   BEAM_API_KEY   HF token (or OpenRouter key with the OpenRouter base)
 *   BEAM_MODEL     default reflection/Beam-1.0-501B-A23B
 *   BEAM_REASONING_EFFORT  optional: minimal|low|medium|high …
 */

import type { ConvictionGymEnv } from "./env.js";
import type { Policy } from "./policies.js";
import type { EnvAction, EnvObservation } from "./types.js";

const OPS = ["hold", "enter", "exit_full", "exit_partial"] as const;
const SIZES = ["small", "standard", "max"] as const;

interface BeamConfig {
  apiBase: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

function beamConfigFromEnv(): BeamConfig {
  return {
    apiBase: (process.env.BEAM_API_BASE ?? "https://router.huggingface.co/v1").replace(/\/$/, ""),
    apiKey: process.env.BEAM_API_KEY ?? process.env.HF_TOKEN ?? "",
    model: process.env.BEAM_MODEL ?? "reflection/Beam-1.0-501B-A23B",
    reasoningEffort: process.env.BEAM_REASONING_EFFORT,
    temperature: parseFloat(process.env.BEAM_TEMPERATURE ?? "0.2"),
    maxTokens: parseInt(process.env.BEAM_MAX_TOKENS ?? "1024", 10),
    timeoutMs: parseInt(process.env.BEAM_TIMEOUT_MS ?? "120000", 10),
  };
}

function systemPrompt(env: ConvictionGymEnv): string {
  const K = env.symbols.length;
  return [
    "You are an autonomous trading agent inside Conviction Gym, a replay of real",
    "crypto market history. Each turn you see one market day and must pick ONE",
    "action for that day. The strategy thesis is \"early, not wrong\": buy",
    "quality assets that are DOWN during market fear (contrarian entries), hold",
    "through ordinary drawdown, exit only to cap a broken thesis or to lock",
    "large asymmetric gains — never sell winners early out of jitter.",
    "",
    `Action space — reply with STRICT JSON only, no prose:`,
    `{"symbol_index": <int 0..${K - 1}>, "op": "hold"|"enter"|"exit_full"|"exit_partial",`,
    ` "size": "small"|"standard"|"max", "reasoning": "<1-2 sentences>"}`,
    "",
    "symbol_index refers to the market list order shown each day (0 = first row).",
    "- enter: open a new position in that symbol (needs a free slot + bankroll).",
    "- exit_full / exit_partial: close 100% / 33% of a held position.",
    "- size applies to enter only: fraction of the max allowed entry.",
    "- hold: take no action (symbol_index/size ignored).",
    "",
    "Fees + slippage are real; pointless churn loses money. Long-horizon",
    "thinking beats daily noise.",
  ].join("\n");
}

function extractJson(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function beamPolicy(overrides: Partial<BeamConfig> = {}): Policy {
  const cfg = { ...beamConfigFromEnv(), ...overrides };
  const history: string[] = [];
  const policy: Policy = {
    name: `beam:${cfg.model.split("/").pop()}`,
    lastReasoning: undefined,
    async act(obs: EnvObservation, env: ConvictionGymEnv): Promise<EnvAction> {
      policy.lastReasoning = undefined;
      policy.lastUsage = undefined;
      if (!cfg.apiKey) {
        policy.lastReasoning = "BEAM_API_KEY unset — forced hold";
        return { symbolIndex: 0, op: "hold", size: "standard" };
      }

      const obsText = env.render(obs);
      const recent = history.slice(-5);
      const userMsg =
        obsText +
        (recent.length
          ? `\n\nYour last ${recent.length} action(s):\n` + recent.map((h) => `  ${h}`).join("\n")
          : "") +
        `\n\nReply with the JSON action only.`;

      try {
        const t0 = Date.now();
        const res = await fetch(`${cfg.apiBase}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: "system", content: systemPrompt(env) },
              { role: "user", content: userMsg },
            ],
            temperature: cfg.temperature,
            max_tokens: cfg.maxTokens,
            ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
          }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        if (!res.ok) {
          policy.lastReasoning = `Beam HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
          return { symbolIndex: 0, op: "hold", size: "standard" };
        }
        const data = await res.json();
        policy.lastUsage = {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          reasoningTokens:
            data.usage?.completion_tokens_details?.reasoning_tokens ??
            data.usage?.reasoning_tokens,
          latencyMs: Date.now() - t0,
        };
        const text: string = data.choices?.[0]?.message?.content ?? "";
        const finishReason: string | undefined = data.choices?.[0]?.finish_reason;
        const parsed = extractJson(text);
        if (!parsed) {
          // finish_reason="length" + empty content is the documented Beam
          // budget trap: reasoning consumed the whole completion budget.
          policy.lastReasoning =
            finishReason === "length"
              ? `TRUNCATED: finish_reason=length (reasoning consumed the completion budget)`
              : `unparseable response: ${text.slice(0, 200)}`;
          return { symbolIndex: 0, op: "hold", size: "standard" };
        }
        policy.lastReasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : text.slice(0, 300);

        const symbolIndex = Number.isInteger(parsed.symbol_index)
          ? Math.max(0, Math.min(env.symbols.length - 1, parsed.symbol_index))
          : 0;
        const op = (OPS as readonly string[]).includes(parsed.op) ? parsed.op : "hold";
        const size = (SIZES as readonly string[]).includes(parsed.size) ? parsed.size : "standard";
        const action: EnvAction = { symbolIndex, op, size };

        // Map the rendered-market index to the env's canonical symbol index —
        // obs.tokens is conviction-sorted, env.symbols is the universe order.
        if (op !== "hold") {
          const renderedSymbol = obs.tokens[symbolIndex]?.symbol;
          const canonical = env.symbols.findIndex(
            (s) => s.toUpperCase() === renderedSymbol,
          );
          if (canonical < 0) {
            policy.lastReasoning = `symbol_index ${symbolIndex} resolved to unknown symbol`;
            return { symbolIndex: 0, op: "hold", size: "standard" };
          }
          action.symbolIndex = canonical;
        }

        history.push(
          `${obs.date}: ${action.op}${action.op === "hold" ? "" : ` ${obs.tokens[symbolIndex]?.symbol ?? "?"}`}`,
        );
        return action;
      } catch (e) {
        policy.lastReasoning = `Beam call failed: ${(e as Error).message.slice(0, 200)}`;
        return { symbolIndex: 0, op: "hold", size: "standard" };
      }
    },
  };
  return policy;
}
