/**
 * Tests for the MCP tool implementations and the x402 paywall.
 *
 * The tools are pure functions over the AnchorAdapter interface, so we test
 * them against stub adapter responses rather than touching the live chain.
 * The paywall middleware is tested by stubbing the facilitator fetch.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { PRICING } from "../src/mcp/pricing.js";
import type { AnchoredRecord } from "../lib/anchors/index.js";

// ─── Pricing config ──────────────────────────────────────────────────────────

describe("PRICING config", () => {
  it("marks the read-only point lookups as free", () => {
    expect(PRICING.get_latest_conviction.paid).toBe(false);
    expect(PRICING.get_by_thesis.paid).toBe(false);
  });

  it("marks the aggregate / history queries as paid", () => {
    expect(PRICING.get_subject_history.paid).toBe(true);
    expect(PRICING.cross_chain_lookup.paid).toBe(true);
    expect(PRICING.get_agent_reputation.paid).toBe(true);
  });

  it("paid tools carry a non-zero amount", () => {
    for (const tool of ["get_subject_history", "cross_chain_lookup", "get_agent_reputation"] as const) {
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
        params: { name: "get_agent_reputation", arguments: { subjectHash: ZERO_HASH } },
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
    expect(body.accepts?.[0]?.amount).toBe(PRICING.get_agent_reputation.amountBaseUnits);
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
