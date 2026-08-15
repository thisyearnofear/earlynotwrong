/**
 * Tests for the shared LLM ladder plumbing:
 *   - fetchWithBackoff (429/5xx retry, fail-fast on 4xx, retry cap)
 *   - vercelGatewayFreeActive (promo expiry guard)
 *   - firstAvailableLlmProvider (ladder order + promo gate + model filter)
 *
 * No real network calls: fetch is stubbed globally per test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchWithBackoff,
  vercelGatewayFreeActive,
  firstAvailableLlmProvider,
  chatCompletion,
} from "../lib/llm-providers.js";

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({ ok: true }), { status });
}

describe("fetchWithBackoff", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("returns immediately on a 200 without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await fetchWithBackoff("https://example.test", { method: "POST" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast on 400/401 — no retries (would just burn quota)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400))
      .mockResolvedValueOnce(jsonResponse(200));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await fetchWithBackoff("https://example.test", {});
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After on a 429 instead of the fixed backoff", async () => {
    // Free-tier endpoints advertise exactly when they re-open via Retry-After;
    // re-firing on the fixed 2s schedule just earns another 429 (incident
    // 2026-08-15: OpenRouter :free at ~20 req/min).
    const retryAfterRes = new Response("{}", {
      status: 429,
      headers: { "Retry-After": "3" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(retryAfterRes)
      .mockResolvedValueOnce(jsonResponse(200));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithBackoff("https://example.test", {}, { baseDelayMs: 100 });
    // baseDelayMs is 100ms but Retry-After says 3s — advance past the header.
    await vi.advanceTimersByTimeAsync(3_000);
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transient 429 (with Retry-After) with backoff then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(jsonResponse(200));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithBackoff("https://example.test", {}, { baseDelayMs: 100 });
    // Retry-After (1s) wins over the 100ms base delay.
    await vi.advanceTimersByTimeAsync(1_000);
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast on a 429 WITHOUT Retry-After — quota exhaustion, not throttling", async () => {
    // OpenRouter's 50/day free cap returns 429 with no Retry-After (reset is
    // hours away). Retrying inside fetchWithBackoff cannot succeed and burns
    // the wall-clock budget the next cascade rung needs.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await fetchWithBackoff("https://example.test", {});
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retries
  });

  it("retries 5xx and gives up after the retry budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithBackoff(
      "https://example.test",
      {},
      { retries: 2, baseDelayMs: 50 },
    );
    await vi.advanceTimersByTimeAsync(60); // 50ms
    await vi.advanceTimersByTimeAsync(120); // 100ms
    const res = await promise;

    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});

describe("vercelGatewayFreeActive", () => {
  const original = process.env.VERCEL_GATEWAY_PROMO_ENDS;

  afterEach(() => {
    if (original === undefined) delete process.env.VERCEL_GATEWAY_PROMO_ENDS;
    else process.env.VERCEL_GATEWAY_PROMO_ENDS = original;
  });

  const duringPromo = Date.parse("2026-08-14T12:00:00Z");
  const afterPromo = Date.parse("2026-08-28T12:00:00Z");

  it("is active during the default promo window (through 2026-08-27 UTC)", () => {
    delete process.env.VERCEL_GATEWAY_PROMO_ENDS;
    expect(vercelGatewayFreeActive(duringPromo)).toBe(true);
  });

  it("is inactive the day after the promo ends", () => {
    delete process.env.VERCEL_GATEWAY_PROMO_ENDS;
    expect(vercelGatewayFreeActive(afterPromo)).toBe(false);
  });

  it("honors an explicit end date override", () => {
    process.env.VERCEL_GATEWAY_PROMO_ENDS = "2026-08-15";
    expect(vercelGatewayFreeActive(duringPromo)).toBe(true);
    expect(vercelGatewayFreeActive(afterPromo)).toBe(false);
  });

  it("'never' disables the guard entirely", () => {
    process.env.VERCEL_GATEWAY_PROMO_ENDS = "never";
    expect(vercelGatewayFreeActive(afterPromo)).toBe(true);
  });

  it("fails open on an unparsable date (gateway key is configured → use it)", () => {
    process.env.VERCEL_GATEWAY_PROMO_ENDS = "not-a-date";
    expect(vercelGatewayFreeActive(afterPromo)).toBe(true);
  });
});

describe("firstAvailableLlmProvider", () => {
  const KEYS = [
    "VERCEL_AI_GATEWAY_API_KEY",
    "OPENROUTER_API_KEY",
    "HF_QWEN_API_KEY",
    "ORCAROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete process.env.VERCEL_GATEWAY_PROMO_ENDS;
  });

  const models = {
    "vercel-gateway": { envVar: "X", defaultModel: "m" },
    openrouter: { envVar: "Y", defaultModel: "m" },
  } as const;

  it("prefers the gateway while its promo is active", () => {
    process.env.VERCEL_AI_GATEWAY_API_KEY = "gw";
    process.env.OPENROUTER_API_KEY = "or";
    process.env.VERCEL_GATEWAY_PROMO_ENDS = "2026-12-31";
    expect(firstAvailableLlmProvider(models)).toBe("vercel-gateway");
  });

  it("falls through to OpenRouter when the promo has expired", () => {
    process.env.VERCEL_AI_GATEWAY_API_KEY = "gw";
    process.env.OPENROUTER_API_KEY = "or";
    process.env.VERCEL_GATEWAY_PROMO_ENDS = "2026-08-01";
    expect(firstAvailableLlmProvider(models)).toBe("openrouter");
  });

  it("returns null when no provider has a key", () => {
    expect(firstAvailableLlmProvider(models)).toBeNull();
  });

  it("skips providers without a model selection even when keyed", () => {
    process.env.VERCEL_AI_GATEWAY_API_KEY = "gw";
    expect(firstAvailableLlmProvider({ openrouter: models.openrouter })).toBeNull();
  });
});

describe("chatCompletion — provider cascade on error", () => {
  const originalFetch = globalThis.fetch;
  const KEYS = [
    "VERCEL_AI_GATEWAY_API_KEY",
    "OPENROUTER_API_KEY",
    "HF_QWEN_API_KEY",
    "ORCAROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  const models = {
    "vercel-gateway": { envVar: "X", defaultModel: "gw-model" },
    openrouter: { envVar: "Y", defaultModel: "or-model" },
    "hf-qwen": { envVar: "HF_QWEN_DELPHI_MODEL", defaultModel: "Qwen/Qwen3.8-27B" },
    orcarouter: { envVar: "ORCAROUTER_DELPHI_MODEL", defaultModel: "qwen/qwen3.8-27b-free" },
  } as const;

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.VERCEL_GATEWAY_PROMO_ENDS = "never"; // keep the gateway eligible
    // Reset the provider circuit breakers between tests (they live on globalThis).
    delete (globalThis as Record<string, unknown>)["__llmProviderBreakerOpenUntil"];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete process.env.VERCEL_GATEWAY_PROMO_ENDS;
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  function chatResponse(providerContent: string): Response {
    return new Response(
      JSON.stringify({ choices: [{ message: { content: providerContent } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  it("falls through to the next provider when the gateway 402s", async () => {
    // Production incident 2026-08-15: a free-tier 402 on the gateway killed
    // every estimate because the ladder did not cascade.
    process.env.VERCEL_AI_GATEWAY_API_KEY = "gw";
    process.env.OPENROUTER_API_KEY = "or";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 402 })) // gateway: payment required
      .mockResolvedValueOnce(chatResponse("openrouter answer")) as unknown as typeof fetch;

    const result = await chatCompletion({ systemPrompt: "s", userPrompt: "u", models });
    expect(result?.provider).toBe("openrouter");
    expect(result?.content).toBe("openrouter answer");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns the first provider's answer when it succeeds (no extra calls)", async () => {
    process.env.VERCEL_AI_GATEWAY_API_KEY = "gw";
    process.env.OPENROUTER_API_KEY = "or";
    globalThis.fetch = vi.fn().mockResolvedValue(chatResponse("gw answer")) as unknown as typeof fetch;

    const result = await chatCompletion({ systemPrompt: "s", userPrompt: "u", models });
    expect(result?.provider).toBe("vercel-gateway");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws the last error when every provider fails", async () => {
    process.env.VERCEL_AI_GATEWAY_API_KEY = "gw";
    process.env.OPENROUTER_API_KEY = "or";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 402 })) as unknown as typeof fetch;

    await expect(
      chatCompletion({ systemPrompt: "s", userPrompt: "u", models }),
    ).rejects.toThrow(/OpenRouter API error: 402/);
  });

  it("trips a 30-min circuit breaker on a gateway 402 so later calls skip it", async () => {
    // The gateway's free credit can run dry mid-promo (observed 2026-08-15);
    // paying one failing round-trip per LLM call is pure waste.
    process.env.VERCEL_AI_GATEWAY_API_KEY = "gw";
    process.env.OPENROUTER_API_KEY = "or";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 402 })) // gateway fails
      // Fresh Response per call — a body can only be read once.
      .mockImplementation(() => chatResponse("or")) as unknown as typeof fetch; // openrouter succeeds
    globalThis.fetch = fetchMock;

    const first = await chatCompletion({ systemPrompt: "s", userPrompt: "u", models });
    expect(first?.provider).toBe("openrouter");
    // First call: gateway attempt (402) + OpenRouter fallthrough = 2 fetches.
    const callsAfterFirst = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBe(2);

    // Second call: the gateway is skipped outright — exactly one more fetch
    // (direct to OpenRouter), not two.
    const second = await chatCompletion({ systemPrompt: "s", userPrompt: "u", models });
    expect(second?.provider).toBe("openrouter");
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst + 1);
  });

  it("falls through an exhausted OpenRouter daily quota to the keyless HF endpoint", async () => {
    // Production 2026-08-15: OpenRouter :free is 50 req/day. When the quota
    // hits 0, every call 429s with no near-term Retry-After — fail fast (no
    // retries to burn the budget) and cascade to the keyless Qwen3.8-27B HF
    // endpoint (verified live, clean JSON). The 429 does NOT trip a breaker:
    // transient throttles self-heal, so quota-dead providers cost one cheap
    // failed request per call until the ladder moves on.
    process.env.OPENROUTER_API_KEY = "or";
    process.env.HF_QWEN_API_KEY = "none";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429 })) // OpenRouter: quota exhausted
      .mockImplementation(() => chatResponse("hf answer")) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const result = await chatCompletion({ systemPrompt: "s", userPrompt: "u", models });
    expect(result?.provider).toBe("hf-qwen");
    expect(result?.content).toBe("hf answer");
    // One failed OpenRouter request, then HF — no retry storm.
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("falls through the HF endpoint to OrcaRouter when the community deployment is retired", async () => {
    // The HF community endpoint is temporary by its own docs ("retired after
    // the launch buzz") — a retired endpoint 404s, and OrcaRouter's $0
    // self-hosted Qwen is the safety net.
    process.env.HF_QWEN_API_KEY = "none";
    process.env.ORCAROUTER_API_KEY = "orca";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockImplementation(() => chatResponse("orca answer")) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const result = await chatCompletion({ systemPrompt: "s", userPrompt: "u", models });
    expect(result?.provider).toBe("orcarouter");
    expect(result?.content).toBe("orca answer");
  });

  it("returns null when no provider is configured", async () => {
    const result = await chatCompletion({ systemPrompt: "s", userPrompt: "u", models });
    expect(result).toBeNull();
  });

  it("strips non-ASCII characters from the OpenRouter X-Title header", async () => {
    // Production incident 2026-08-15: an em dash (U+2014) in xTitle made
    // fetch throw "Cannot convert argument to a ByteString" before the
    // request left the process, killing the cascade fallback.
    process.env.OPENROUTER_API_KEY = "or";
    const fetchMock = vi.fn().mockResolvedValue(chatResponse("or answer"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await chatCompletion({
      systemPrompt: "s",
      userPrompt: "u",
      models: { openrouter: models.openrouter },
      xTitle: "Early Not Wrong — Delphi Forecaster",
    });
    expect(result?.provider).toBe("openrouter");
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Title"]).toBe("Early Not Wrong  Delphi Forecaster");
    expect(/[^\x00-\x7F]/.test(headers["X-Title"])).toBe(false);
  });
});
