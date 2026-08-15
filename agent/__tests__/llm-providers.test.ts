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

  it("retries a 429 with backoff then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithBackoff("https://example.test", {}, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(150); // first backoff 100ms
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  const models = {
    "vercel-gateway": { envVar: "X", defaultModel: "gw-model" },
    openrouter: { envVar: "Y", defaultModel: "or-model" },
  } as const;

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.VERCEL_GATEWAY_PROMO_ENDS = "never"; // keep the gateway eligible
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete process.env.VERCEL_GATEWAY_PROMO_ENDS;
    globalThis.fetch = originalFetch;
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

  it("returns null when no provider is configured", async () => {
    const result = await chatCompletion({ systemPrompt: "s", userPrompt: "u", models });
    expect(result).toBeNull();
  });
});
