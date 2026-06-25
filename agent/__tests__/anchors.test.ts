/**
 * Tests for the anchor adapter abstraction.
 *
 * Covers the orchestrator behaviour with stub adapters — chain-specific
 * adapter integration is tested in their own files (mantle anchors via the
 * existing on-chain run; casper adapter via DI'd SDK mock once it lands).
 */

import { describe, expect, it } from "vitest";
import { computeSubjectHash, computeThesisHash } from "../lib/anchors/hashes.js";
import type { AnchorAdapter, AnchorResult, ConvictionRecord } from "../lib/anchors/types.js";

// =============================================================================
// Helper — stub adapter for orchestrator tests
// =============================================================================

function stubAdapter(opts: {
  name: string;
  available?: boolean;
  result?: Partial<AnchorResult>;
  throws?: Error;
}): AnchorAdapter {
  return {
    name: opts.name,
    isAvailable: () => opts.available ?? true,
    async anchor(_record: ConvictionRecord): Promise<AnchorResult> {
      if (opts.throws) throw opts.throws;
      return {
        adapter: opts.name,
        status: "success",
        txHash: `0x${opts.name}-tx`,
        ...opts.result,
      };
    },
  };
}

const baseRecord: ConvictionRecord = {
  subjectHash: `0x${"00".repeat(32)}`,
  thesisHash: `0x${"11".repeat(32)}`,
  convictionScore: 85,
  archetype: "DEEP FEAR — PRIME CONTRARIAN",
  timestamp: 1_782_408_000_000,
};

// =============================================================================
// Hashes — pure, deterministic
// =============================================================================

describe("computeSubjectHash", () => {
  it("is deterministic for the same input", () => {
    const a = computeSubjectHash("bsc", "0xA1Dd482E");
    const b = computeSubjectHash("bsc", "0xA1Dd482E");
    expect(a).toBe(b);
  });

  it("differs for different chains", () => {
    const a = computeSubjectHash("bsc", "0xA1Dd482E");
    const b = computeSubjectHash("eth", "0xA1Dd482E");
    expect(a).not.toBe(b);
  });

  it("returns a 0x-prefixed 32-byte hex string", () => {
    const h = computeSubjectHash("bsc", "0xA1Dd482E");
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("computeThesisHash", () => {
  it("is deterministic for identical metrics", () => {
    const m = { score: 85, label: "DEEP FEAR", positions: 14 };
    expect(computeThesisHash(m)).toBe(computeThesisHash(m));
  });

  it("differs when any metric changes", () => {
    const a = computeThesisHash({ score: 85, label: "DEEP FEAR" });
    const b = computeThesisHash({ score: 86, label: "DEEP FEAR" });
    expect(a).not.toBe(b);
  });
});

// =============================================================================
// Orchestrator semantics — using stub adapters (no chain dependencies)
// =============================================================================

/**
 * Run the orchestrator with arbitrary stub adapters. Mirrors the production
 * `anchorAll` shape (sequential, never-throwing) so tests assert the same
 * invariants without coupling to the real config registry.
 */
async function anchorAllWith(
  adapters: AnchorAdapter[],
  record: ConvictionRecord,
): Promise<AnchorResult[]> {
  const results: AnchorResult[] = [];
  for (const adapter of adapters) {
    if (!adapter.isAvailable()) {
      results.push({ adapter: adapter.name, status: "skipped", error: "adapter not configured (missing env)" });
      continue;
    }
    try {
      results.push(await adapter.anchor(record));
    } catch (err) {
      results.push({
        adapter: adapter.name,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

describe("anchor orchestrator", () => {
  it("returns one result per adapter, in declaration order", async () => {
    const results = await anchorAllWith(
      [stubAdapter({ name: "mantle" }), stubAdapter({ name: "casper" })],
      baseRecord,
    );
    expect(results.map((r) => r.adapter)).toEqual(["mantle", "casper"]);
  });

  it("marks an unavailable adapter as skipped without calling anchor()", async () => {
    let called = false;
    const adapter: AnchorAdapter = {
      name: "casper",
      isAvailable: () => false,
      async anchor() {
        called = true;
        return { adapter: "casper", status: "success" };
      },
    };
    const results = await anchorAllWith([adapter], baseRecord);
    expect(called).toBe(false);
    expect(results[0]?.status).toBe("skipped");
  });

  it("catches throws from an adapter and surfaces them as failed", async () => {
    const results = await anchorAllWith(
      [stubAdapter({ name: "boom", throws: new Error("RPC unreachable") })],
      baseRecord,
    );
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.error).toContain("RPC unreachable");
  });

  it("one adapter failing does NOT short-circuit the others", async () => {
    const results = await anchorAllWith(
      [
        stubAdapter({ name: "mantle", throws: new Error("revert") }),
        stubAdapter({ name: "casper" }),
      ],
      baseRecord,
    );
    expect(results[0]?.status).toBe("failed");
    expect(results[1]?.status).toBe("success");
  });

  it("preserves adapter.name in result.adapter — used for telemetry indexing", async () => {
    const results = await anchorAllWith([stubAdapter({ name: "mantle" })], baseRecord);
    expect(results[0]?.adapter).toBe("mantle");
  });
});
