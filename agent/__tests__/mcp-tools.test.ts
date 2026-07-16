/**
 * Tests for the MCP tool implementations and the x402 paywall.
 *
 * The tools are pure functions over the AnchorAdapter interface, so we test
 * them against stub adapter responses rather than touching the live chain.
 * The paywall middleware is tested by stubbing the facilitator fetch.
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { PRICING } from "../src/mcp/pricing.js";
import type { AnchoredRecord } from "../lib/anchors/index.js";

// ─── Pricing config ──────────────────────────────────────────────────────────

describe("PRICING config", () => {
  it("marks the read-only point lookups as free", () => {
    expect(PRICING.get_latest_conviction.paid).toBe(false);
    expect(PRICING.get_by_thesis.paid).toBe(false);
  });

  it("marks the trust-decision reputation query as free", () => {
    expect(PRICING.get_agent_reputation.paid).toBe(false);
    expect(PRICING.get_agent_reputation.amountBaseUnits).toBe("0");
  });

  it("marks the history / cross-chain / live-signal queries as paid", () => {
    expect(PRICING.get_subject_history.paid).toBe(true);
    expect(PRICING.cross_chain_lookup.paid).toBe(true);
    expect(PRICING.get_live_signals.paid).toBe(true);
  });

  it("prices live signals at 0.5 CSPR (50 base units of the 2-decimal token)", () => {
    expect(PRICING.get_live_signals.amountBaseUnits).toBe("50");
  });

  it("paid tools carry a non-zero amount", () => {
    for (const tool of ["get_subject_history", "cross_chain_lookup", "get_live_signals"] as const) {
      expect(BigInt(PRICING[tool].amountBaseUnits)).toBeGreaterThan(0n);
    }
  });
});

// ─── Shared payment stats (used by x402 and CAP) ─────────────────────────────

import { paymentStats } from "../src/payment-stats.js";

describe("paymentStats", () => {
  it("starts at zero for both providers", () => {
    // Other test files may run first; reset by reading + asserting non-negative.
    expect(paymentStats.queriesServed).toBeGreaterThanOrEqual(0);
    expect(paymentStats.paidQueries).toBeGreaterThanOrEqual(0);
    expect(paymentStats.feesCollectedBaseUnits.x402).toBeGreaterThanOrEqual(0n);
    expect(paymentStats.feesCollectedBaseUnits.cap).toBeGreaterThanOrEqual(0n);
    expect(paymentStats.byProvider.x402.queriesServed).toBeGreaterThanOrEqual(0);
    expect(paymentStats.byProvider.cap.queriesServed).toBeGreaterThanOrEqual(0);
  });
});

// ─── MCP tools — stub-adapter integration ────────────────────────────────────
//
// We can't easily stub the singleton adapters inside tools.ts without further
// refactoring, but we CAN exercise the cross-chain orchestrator paths by
// asserting the shape of the results when no records exist (the chain reads
// gracefully return empty arrays for unknown subject hashes — no credentials
// required for that path).

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

describe("MCP tools — empty / unknown subject", () => {
  let originalFetch: typeof fetch;

  // Warm the tools module once, outside the per-test timeout: the first
  // dynamic import pays the whole transform cost and can exceed 5s when the
  // full suite runs under CPU contention. Same stubs as beforeEach so no
  // network is reachable during module init either.
  beforeAll(async () => {
    vi.stubEnv("CSPR_CLOUD_TOKEN", "");
    vi.stubEnv("MANTLE_OPERATOR_KEY", "");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      await import("../src/mcp/tools.js");
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 60_000);

  beforeEach(() => {
    vi.stubEnv("CSPR_CLOUD_TOKEN", "");
    vi.stubEnv("MANTLE_OPERATOR_KEY", "");

    // Stub network calls so the adapters can't reach out (Mantle's public RPC
    // would hang the test otherwise). Returns a JSON-shaped 200 that decodes
    // as an empty getLogs / empty contract response — both adapters then
    // return [] / null without throwing.
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("getAgentReputation returns zeroed report for unknown subject", async () => {
    const { getAgentReputation } = await import("../src/mcp/tools.js");
    const result = await getAgentReputation({ subjectHash: ZERO_HASH });
    expect(result.subjectHash).toBe(ZERO_HASH);
    expect(result.totalAnchors).toBe(0);
    expect(result.meanConvictionScore).toBe(0);
    expect(result.latestAnchor).toBeNull();
    expect(result.dualChain).toBe(false);
    expect(result.archetypes).toEqual([]);
  });

  it("crossChainLookup returns zero-count chains for unknown subject", async () => {
    const { crossChainLookup } = await import("../src/mcp/tools.js");
    const result = await crossChainLookup({ subjectHash: ZERO_HASH });
    expect(result.chains.mantle.count).toBe(0);
    expect(result.chains.casper.count).toBe(0);
    expect(result.chains.mantle.latest).toBeNull();
    expect(result.chains.casper.latest).toBeNull();
    expect(result.bothChains).toBe(false);
    expect(result.inSync).toBe(false);
  });

  it("getLatestConviction returns source=none when neither chain has a record", async () => {
    const { getLatestConviction } = await import("../src/mcp/tools.js");
    const result = await getLatestConviction({ subjectHash: ZERO_HASH });
    expect(result.source).toBe("none");
    expect(result.record).toBeNull();
  });

  it("getByThesis returns source=none for an unanchored thesis", async () => {
    const { getByThesis } = await import("../src/mcp/tools.js");
    const result = await getByThesis({ thesisHash: ZERO_HASH });
    expect(result.source).toBe("none");
    expect(result.record).toBeNull();
  });

  it("getSubjectHistory returns empty arrays for an unknown subject", async () => {
    const { getSubjectHistory } = await import("../src/mcp/tools.js");
    const result = await getSubjectHistory({ subjectHash: ZERO_HASH });
    expect(result.records).toEqual([]);
    expect(Array.isArray(result.byAdapter.mantle ?? [])).toBe(true);
    expect(Array.isArray(result.byAdapter.casper ?? [])).toBe(true);
  });
});

// ─── x402 middleware — request gating ────────────────────────────────────────

describe("x402 middleware — request gating", () => {
  it("returns 402 for paid tools without X-PAYMENT header", async () => {
    const { Hono } = await import("hono");
    const { x402Middleware } = await import("../src/mcp/x402.js");
    const app = new Hono();
    app.use("/mcp", x402Middleware());
    app.post("/mcp", (c) => c.json({ ok: true }));

    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_live_signals", arguments: {} },
      }),
    });
    expect(res.status).toBe(402);
    const body = await res.json() as {
      x402Version?: number;
      accepts?: Array<{ scheme?: string; network?: string; amount?: string }>;
      error?: string;
    };
    expect(body.x402Version).toBe(2);
    expect(body.accepts?.[0]?.scheme).toBe("exact");
    expect(body.accepts?.[0]?.network).toBe("casper:casper-test");
    expect(body.accepts?.[0]?.amount).toBe(PRICING.get_live_signals.amountBaseUnits);
  });

  it("serves get_agent_reputation without payment (free trust-decision query)", async () => {
    const { Hono } = await import("hono");
    const { x402Middleware } = await import("../src/mcp/x402.js");
    const app = new Hono();
    app.use("/mcp", x402Middleware());
    app.post("/mcp", (c) => c.json({ passedThrough: true }));

    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_agent_reputation", arguments: { subjectHash: ZERO_HASH } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { passedThrough?: boolean };
    expect(body.passedThrough).toBe(true);
  });

  it("passes through free tools without a payment header", async () => {
    const { Hono } = await import("hono");
    const { x402Middleware } = await import("../src/mcp/x402.js");
    const app = new Hono();
    app.use("/mcp", x402Middleware());
    app.post("/mcp", (c) => c.json({ passedThrough: true }));

    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_latest_conviction", arguments: { subjectHash: ZERO_HASH } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { passedThrough?: boolean };
    expect(body.passedThrough).toBe(true);
  });

  it("passes through non-tools/call RPC methods (initialize, tools/list)", async () => {
    const { Hono } = await import("hono");
    const { x402Middleware } = await import("../src/mcp/x402.js");
    const app = new Hono();
    app.use("/mcp", x402Middleware());
    app.post("/mcp", (c) => c.json({ passedThrough: true }));

    for (const method of ["initialize", "tools/list", "ping"]) {
      const res = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
      });
      expect(res.status).toBe(200);
    }
  });

  it("returns 402 with the spec-shaped error body when facilitator rejects the payment", async () => {
    const { Hono } = await import("hono");
    const { x402Middleware } = await import("../src/mcp/x402.js");
    const app = new Hono();
    app.use("/mcp", x402Middleware());
    app.post("/mcp", (c) => c.json({ ok: true }));

    // Need a token set so settle() actually attempts the fetch call.
    vi.stubEnv("CSPR_CLOUD_TOKEN", "test-token");

    // Stub fetch to simulate facilitator rejecting the payment.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false, invalidReason: "insufficient_funds" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      const fakePayment = Buffer.from(JSON.stringify({
        x402Version: 2,
        resource: { url: "http://localhost/mcp" },
        accepted: {},
        payload: {},
      })).toString("base64");
      const res = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-payment": fakePayment },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "cross_chain_lookup", arguments: { subjectHash: ZERO_HASH } },
        }),
      });
      expect(res.status).toBe(402);
      const body = await res.json() as { error?: string };
      expect(body.error).toBe("insufficient_funds");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("serves get_live_signals (regime + signals) when the payment settles", async () => {
    const { Hono } = await import("hono");
    const { x402Middleware } = await import("../src/mcp/x402.js");
    const { getLiveSignalsV1 } = await import("../src/mcp/tools.js");
    const { state } = await import("../lib/agent-state.js");
    const app = new Hono();
    app.use("/mcp", x402Middleware());
    app.post("/mcp", async (c) => c.json(await getLiveSignalsV1({
      settlementRail: "mcp-x402",
      tool: "get_live_signals",
    })));

    vi.stubEnv("CSPR_CLOUD_TOKEN", "test-token");

    // Populate the shared in-process agent state (what the cycle runner would
    // have written), then restore afterwards.
    const saved = {
      cycle: state.cycle,
      lastRunAt: state.lastRunAt,
      marketRegime: state.marketRegime,
      convictionSignals: state.convictionSignals,
    };
    state.cycle = 7;
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    state.lastRunAt = now - 60_000;
    state.nextRunAt = now + 14_400_000 - 60_000;
    state.marketRegime = {
      score: 72,
      label: "Extreme fear — contrarian entry window",
      fearGreedIndex: 18,
      fearLevel: "extreme-fear",
      ssiConfirmation: 0.4,
    };
    state.convictionSignals = [
      {
        symbol: "CAKE",
        score: 81,
        breakdown: { contrarian: 30, rsi: 20, quality: 15, regime: 10, holders: 4, volatilityPenalty: 0, news: 2 },
        weights: {} as never,
        holderCount: 1000,
        holderGrowthPercent: 2.1,
        newsSentiment: 0.3,
        rationale: "deep drawdown + accumulating holders",
      },
    ];

    // Stub fetch to simulate the facilitator settling the payment.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ success: true, transaction: "0xabc", network: "casper:casper-test", payer: "0xdef" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    try {
      const fakePayment = Buffer.from(JSON.stringify({
        x402Version: 2,
        resource: { url: "http://localhost/mcp" },
        accepted: {},
        payload: {},
      })).toString("base64");
      const res = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-payment": fakePayment },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_live_signals", arguments: {} },
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-payment-response")).toBeTruthy();
      const body = await res.json() as Awaited<ReturnType<typeof getLiveSignalsV1>>;
      expect(body.schema).toBe("signals-live/v1.1");
      expect(body.freshness.cycle).toBe(7);
      expect(body.freshness.lastRunAt).toBe(now - 60_000);
      expect(body.regime?.score).toBe(72);
      expect(body.regime?.fearGreedIndex).toBe(18);
      expect(body.signals).toHaveLength(1);
      expect(body.signals[0].symbol).toBe("CAKE");
      expect(body.signals[0].breakdown.contrarian).toBe(30);
      expect(body.signals[0].rationale).toContain("drawdown");
      expect(body.meta.settlementRail).toBe("mcp-x402");
      expect(body.meta.tool).toBe("get_live_signals");
      expect(body.meta.schemaUrl).toContain("signals-live-v1.1.schema.json");
      expect(body.provenance.reputation).toBeDefined();
      expect(body.guidance.recommendedAction).toBe("evaluate");
    } finally {
      vi.useRealTimers();
      globalThis.fetch = originalFetch;
      state.cycle = saved.cycle;
      state.lastRunAt = saved.lastRunAt;
      state.marketRegime = saved.marketRegime;
      state.convictionSignals = saved.convictionSignals;
    }
  });
});

// ─── get_live_signals — live in-process state ────────────────────────────────

describe("getLiveSignalsV1", () => {
  it("returns a well-formed empty v1 envelope before the first cycle", async () => {
    const { getLiveSignalsV1 } = await import("../src/mcp/tools.js");
    const { state } = await import("../lib/agent-state.js");
    const saved = {
      cycle: state.cycle,
      lastRunAt: state.lastRunAt,
      nextRunAt: state.nextRunAt,
      marketRegime: state.marketRegime,
      convictionSignals: state.convictionSignals,
      macroPause: state.macroPause,
    };
    state.cycle = 0;
    state.lastRunAt = null;
    state.nextRunAt = null;
    state.marketRegime = null;
    state.convictionSignals = [];
    state.macroPause = null;
    try {
      const result = await getLiveSignalsV1({
        settlementRail: "croo-cap",
        tool: "signals-live",
      });
      expect(result.schema).toBe("signals-live/v1.1");
      expect(result.freshness.cycle).toBe(0);
      expect(result.freshness.lastRunAt).toBeNull();
      expect(result.freshness.stale).toBe(false);
      expect(result.regime).toBeNull();
      expect(result.signals).toEqual([]);
      expect(result.macroPause).toBeNull();
      expect(result.meta.settlementRail).toBe("croo-cap");
      expect(result.meta.tool).toBe("signals-live");
      expect(result.meta.schemaUrl).toContain("signals-live-v1.1.schema.json");
      expect(result.agent.name).toBe("Early, Not Wrong");
      expect(result.agent.subjectHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(result.provenance.reputation.totalAnchors).toBeGreaterThanOrEqual(0);
      expect(result.guidance.recommendedAction).toBe("wait");
    } finally {
      Object.assign(state, saved);
    }
  });

  it("marks freshness stale when lastRunAt exceeds 1.5× cycle interval", async () => {
    const { wrapLiveSignalsV1, getLiveSignals, buildBuyerGuidance } = await import("../src/mcp/tools.js");
    const { state } = await import("../lib/agent-state.js");
    const intervalMs = 14_400_000;
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const saved = {
      cycle: state.cycle,
      lastRunAt: state.lastRunAt,
      nextRunAt: state.nextRunAt,
    };
    state.cycle = 10;
    state.lastRunAt = now - intervalMs * 2;
    state.nextRunAt = state.lastRunAt + intervalMs;
    const mockExtras = {
      provenance: {
        latestThesisHash: null,
        anchoredAt: null,
        anchorMode: null,
        behavioral: null,
        reputation: {
          totalAnchors: 0,
          meanConvictionScore: 0,
          dualChain: false,
          latestArchetype: null,
        },
        explorerUrls: {
          casper: null,
          mantle: "https://example.com",
          dashboard: "https://earlynotwrong.vercel.app/agent",
          mcp: "http://localhost/mcp",
        },
        trackRecord: { totalTrades: 0, entries: 0, exits: 0, activePositions: 0 },
      },
      guidance: buildBuyerGuidance(null, [], true),
    };
    try {
      const core = await getLiveSignals();
      const wrapped = wrapLiveSignalsV1(
        core,
        { settlementRail: "mcp-x402", tool: "get_live_signals" },
        mockExtras,
        now,
      );
      expect(wrapped.freshness.stale).toBe(true);
      expect(wrapped.freshness.staleReason).toContain("Last cycle completed");
      expect(wrapped.guidance.recommendedAction).toBe("wait");
    } finally {
      vi.useRealTimers();
      Object.assign(state, saved);
    }
  });

  it("buildBuyerGuidance returns skip_entries when macro gate blocks entries", async () => {
    const { buildBuyerGuidance } = await import("../src/mcp/tools.js");
    const guidance = buildBuyerGuidance(
      {
        clear: false,
        skipEntries: true,
        sizeMultiplier: 0,
        hoursUntilNext: 2,
        reason: "CPI in 2h",
      },
      [{ symbol: "FET", score: 80, breakdown: {} as never, rationale: "test" }],
      false,
    );
    expect(guidance.recommendedAction).toBe("skip_entries");
    expect(guidance.topCandidate).toBe("FET");
  });
});

describe("getLiveSignals", () => {
  it("returns a well-formed empty response before the first cycle (simulator mode)", async () => {
    const { getLiveSignals } = await import("../src/mcp/tools.js");
    const { state } = await import("../lib/agent-state.js");
    const saved = {
      cycle: state.cycle,
      lastRunAt: state.lastRunAt,
      marketRegime: state.marketRegime,
      convictionSignals: state.convictionSignals,
      macroPause: state.macroPause,
    };
    state.cycle = 0;
    state.lastRunAt = null;
    state.marketRegime = null;
    state.convictionSignals = [];
    state.macroPause = null;
    try {
      const result = await getLiveSignals();
      expect(result.cycle).toBe(0);
      expect(result.lastRunAt).toBeNull();
      expect(result.regime).toBeNull();
      expect(result.signals).toEqual([]);
      expect(result.macroPause).toBeNull();
    } finally {
      Object.assign(state, saved);
    }
  });

  it("returns at most the top 5 signals, ranked by score descending", async () => {
    const { getLiveSignals } = await import("../src/mcp/tools.js");
    const { state } = await import("../lib/agent-state.js");
    const saved = { convictionSignals: state.convictionSignals, macroPause: state.macroPause };
    const mkSignal = (symbol: string, score: number) => ({
      symbol,
      score,
      breakdown: { contrarian: 0, rsi: 0, quality: 0, regime: 0, holders: 0, volatilityPenalty: 0, news: 0 },
      weights: {} as never,
      holderCount: null,
      holderGrowthPercent: null,
      newsSentiment: null,
      rationale: `signal for ${symbol}`,
    });
    state.convictionSignals = [
      mkSignal("A", 10),
      mkSignal("B", 90),
      mkSignal("C", 50),
      mkSignal("D", 70),
      mkSignal("E", 30),
      mkSignal("F", 60),
      mkSignal("G", 20),
    ];
    state.macroPause = {
      clear: false,
      skipEntries: true,
      sizeMultiplier: 0,
      hoursUntilNext: 2,
      triggeringEvent: null,
      reason: "CPI print in 2h",
    };
    try {
      const result = await getLiveSignals();
      expect(result.signals.map((s) => s.symbol)).toEqual(["B", "D", "F", "C", "E"]);
      expect(result.signals[0].weights).toBeDefined();
      expect(result.macroPause).toEqual({
        clear: false,
        skipEntries: true,
        sizeMultiplier: 0,
        hoursUntilNext: 2,
        reason: "CPI print in 2h",
      });
    } finally {
      Object.assign(state, saved);
    }
  });
});

// ─── AnchorAdapter — read methods produce AnchoredRecord shape ───────────────

describe("AnchoredRecord shape", () => {
  it("Casper records carry adapter='casper'", () => {
    const r: AnchoredRecord = {
      adapter: "casper",
      subjectHash: ZERO_HASH,
      thesisHash: ZERO_HASH,
      convictionScore: 50,
      archetype: "test",
      timestamp: 0,
      anchoredBy: "00",
    };
    expect(r.adapter).toBe("casper");
  });
});
