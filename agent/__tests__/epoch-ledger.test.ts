/**
 * Tests for agent/lib/anchors/epoch-ledger.ts — the off-chain hash-chained
 * ledger whose Merkle roots get anchored via `anchor_epoch_root`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const sha256hex = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

let dir: string;
let ledger: typeof import("../lib/anchors/epoch-ledger.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "epoch-ledger-"));
  process.env.AGENT_DATA_DIR = dir;
  ledger = await import("../lib/anchors/epoch-ledger.js");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.AGENT_DATA_DIR;
});

describe("merkleRoot", () => {
  it("returns the leaf itself for a single-element tree", () => {
    const leaf = sha256hex("a");
    expect(ledger.merkleRoot([leaf])).toBe(leaf);
  });

  it("computes pairwise sha256 for two leaves", () => {
    const a = sha256hex("a");
    const b = sha256hex("b");
    const pair = new Uint8Array(64);
    pair.set(Buffer.from(a, "hex"));
    pair.set(Buffer.from(b, "hex"), 32);
    expect(ledger.merkleRoot([a, b])).toBe(sha256hex(pair));
  });

  it("promotes the odd leaf unchanged", () => {
    const a = sha256hex("a");
    const b = sha256hex("b");
    const c = sha256hex("c");
    const pair = new Uint8Array(64);
    pair.set(Buffer.from(a, "hex"));
    pair.set(Buffer.from(b, "hex"), 32);
    const ab = sha256hex(pair);
    const top = new Uint8Array(64);
    top.set(Buffer.from(ab, "hex"));
    top.set(Buffer.from(c, "hex"), 32);
    expect(ledger.merkleRoot([a, b, c])).toBe(sha256hex(top));
  });
});

describe("merkleProof / verifyMerkleProof", () => {
  it("proves every leaf in a 7-leaf tree", () => {
    const leaves = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"].map(sha256hex);
    const root = ledger.merkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const proof = ledger.merkleProof(leaves, i);
      expect(ledger.verifyMerkleProof(leaves[i]!, i, leaves.length, proof, root)).toBe(true);
    }
  });

  it("rejects a tampered leaf", () => {
    const leaves = ["r1", "r2", "r3"].map(sha256hex);
    const root = ledger.merkleRoot(leaves);
    const proof = ledger.merkleProof(leaves, 0);
    expect(ledger.verifyMerkleProof(sha256hex("tampered"), 0, leaves.length, proof, root)).toBe(false);
  });
});

describe("appendToEpoch / verifyEpoch / pendingEpochs", () => {
  it("appends hash-chained entries and verifies the chain", () => {
    // Two records in the same (current) epoch.
    const now = Date.now();
    const e1 = ledger.appendToEpoch("conviction", { a: 1 }, now);
    const e2 = ledger.appendToEpoch("conviction", { a: 2 }, now + 1000);
    expect(e1.prevHash).toBe("GENESIS");
    expect(e2.prevHash).toBe(e1.recordHash);

    const epochId = ledger.epochIdFor(now);
    const res = ledger.verifyEpoch(epochId);
    expect(res.ok).toBe(true);
    expect(res.entries).toBe(2);

    const root = ledger.computeEpochRoot(epochId);
    expect(root.recordCount).toBe(2);
    expect(root.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it("current epochs are not pending; past epochs are, until marked anchored", () => {
    const old = Date.now() - 2 * ledger.EPOCH_MS;
    ledger.appendToEpoch("conviction", { old: true }, old);
    const oldEpoch = ledger.epochIdFor(old);

    const pending = ledger.pendingEpochs();
    expect(pending).toContain(oldEpoch);
    expect(pending).not.toContain(ledger.epochIdFor(Date.now()));

    ledger.markEpochAnchored(oldEpoch, "ab".repeat(32), 1, "tx123");
    expect(ledger.pendingEpochs()).not.toContain(oldEpoch);
  });
});
