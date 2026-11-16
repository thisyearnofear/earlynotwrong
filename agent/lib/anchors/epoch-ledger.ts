/**
 * Epoch ledger — off-chain record batching for registry epoch roots.
 *
 * Casper Mainnet economics don't support one anchor transaction per record,
 * so the v2 ConvictionRegistry anchors a single Merkle root per epoch
 * (`anchor_epoch_root`) while the full records live in this hash-chained
 * local ledger — the same integrity primitive as the RYO reasoning ledger
 * (`agent/lib/adapters/ryo-ledger.ts`), generalized to any record type.
 *
 * Layout under `AGENT_DATA_DIR/registry-epochs/`:
 *   epoch-<id>.jsonl — one hash-chained entry per record in that epoch
 *   state.json       — which epochs have been anchored on-chain (tx receipts)
 *
 * Epoch ids are deterministic time buckets: `floor(tsMs / EPOCH_MS)` — the
 * same epoch boundary is computable by any verifier holding the record set,
 * so the on-chain root, the local ledger, and a third-party recomputation
 * all agree on which records an epoch commits to.
 *
 * Verification story for consumers: recompute each record's `recordHash`,
 * rebuild the Merkle root over the epoch file, compare to `get_epoch_root`
 * on-chain — any inserted/edited/dropped record breaks the proof.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ─── Config ─────────────────────────────────────────────────────────────────

/** Epoch width in ms — 24h by default so each UTC day is one anchorable unit. */
export const EPOCH_MS = Number(process.env.CASPER_EPOCH_MS ?? 86_400_000);

const DATA_DIR = process.env.AGENT_DATA_DIR || join(process.cwd(), "data");
const EPOCH_DIR = join(DATA_DIR, "registry-epochs");
const STATE_PATH = join(EPOCH_DIR, "state.json");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EpochEntry {
  /** Position within the epoch file (0-based). */
  seq: number;
  /** ms timestamp the record was appended. */
  ts: number;
  /** Free-form discriminator, e.g. "conviction" | "claim" | "resolution". */
  recordType: string;
  /** The record being committed — JSON-serializable. */
  payload: Record<string, unknown>;
  /** sha256 of the previous entry's hash (or "GENESIS" for seq 0). */
  prevHash: string;
  /** sha256(prevHash + canonical rest) — the chain link AND the Merkle leaf. */
  recordHash: string;
}

interface AnchoredEpoch {
  epochId: number;
  merkleRoot: string;
  recordCount: number;
  txHash?: string;
  anchoredAt: number;
}

interface EpochState {
  anchoredEpochs: AnchoredEpoch[];
}

// ─── Hashing ────────────────────────────────────────────────────────────────

function sha256hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Binary Merkle root over leaf hex digests: pairwise sha256(left ‖ right),
 * last odd leaf promoted unchanged (standard RFC-6962-style tree). Empty
 * input returns the zero root — callers shouldn't anchor empty epochs.
 */
export function merkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) return "0".repeat(64);
  let level = leafHashes.map((h) => hexToBytes(h));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const pair = new Uint8Array(level[i]!.length + level[i + 1]!.length);
        pair.set(level[i]!);
        pair.set(level[i + 1]!, level[i]!.length);
        next.push(hexToBytes(sha256hex(pair)));
      } else {
        next.push(level[i]!);
      }
    }
    level = next;
  }
  return Array.from(level[0]!).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Inclusion proof for leaf at `index` — sibling hashes bottom-up. */
export function merkleProof(leafHashes: string[], index: number): string[] {
  const proof: string[] = [];
  let level = leafHashes.map((h) => hexToBytes(h));
  let idx = index;
  while (level.length > 1) {
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (sibling < level.length) {
      proof.push(Array.from(level[sibling]!).map((b) => b.toString(16).padStart(2, "0")).join(""));
    }
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const pair = new Uint8Array(64);
        pair.set(level[i]!);
        pair.set(level[i + 1]!, 32);
        next.push(hexToBytes(sha256hex(pair)));
      } else {
        next.push(level[i]!);
      }
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/**
 * Verify a leaf's inclusion against a root. `leafCount` is required because
 * promoted (unpaired) leaves at odd-width levels consume no proof element —
 * only the tree shape tells us which levels paired and which promoted.
 */
export function verifyMerkleProof(
  leafHash: string,
  index: number,
  leafCount: number,
  proof: string[],
  root: string,
): boolean {
  let hash = hexToBytes(leafHash);
  let idx = index;
  let size = leafCount;
  let p = 0;
  while (size > 1) {
    // Paired iff the index is odd (has a left sibling) or a right sibling
    // exists. An even index at the last position promotes unchanged.
    if (idx % 2 === 1 || idx + 1 < size) {
      if (p >= proof.length) return false;
      const sib = hexToBytes(proof[p++]!);
      const pair = new Uint8Array(64);
      if (idx % 2 === 0) {
        pair.set(hash);
        pair.set(sib, 32);
      } else {
        pair.set(sib);
        pair.set(hash, 32);
      }
      hash = hexToBytes(sha256hex(pair));
    }
    idx = Math.floor(idx / 2);
    size = Math.ceil(size / 2);
  }
  if (p !== proof.length) return false;
  const computed = Array.from(hash).map((b) => b.toString(16).padStart(2, "0")).join("");
  return computed === root;
}

// ─── Epoch file I/O ─────────────────────────────────────────────────────────

export function epochIdFor(tsMs: number): number {
  return Math.floor(tsMs / EPOCH_MS);
}

function epochPath(epochId: number): string {
  return join(EPOCH_DIR, `epoch-${epochId}.jsonl`);
}

export function readEpochEntries(epochId: number): EpochEntry[] {
  const path = epochPath(epochId);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EpochEntry);
}

function loadState(): EpochState {
  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(STATE_PATH, "utf8")) as EpochState;
    } catch {
      /* fall through */
    }
  }
  return { anchoredEpochs: [] };
}

function saveState(state: EpochState): void {
  mkdirSync(EPOCH_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Append a record to the epoch file for `tsMs` (default: now). Hash-chained
 * exactly like the RYO ledger — `prevHash` links each entry to the previous
 * one so a dropped or reordered record breaks the chain even if every
 * individual hash is recomputed consistently.
 */
export function appendToEpoch(
  recordType: string,
  payload: Record<string, unknown>,
  tsMs = Date.now(),
): EpochEntry {
  mkdirSync(EPOCH_DIR, { recursive: true });
  const epochId = epochIdFor(tsMs);
  const entries = readEpochEntries(epochId);
  const prevHash = entries.length > 0 ? entries[entries.length - 1]!.recordHash : "GENESIS";

  const base = { seq: entries.length, ts: tsMs, recordType, payload, prevHash };
  const recordHash = sha256hex(prevHash + JSON.stringify(base, Object.keys(base).sort()));
  const entry: EpochEntry = { ...base, recordHash };

  appendFileSync(epochPath(epochId), JSON.stringify(entry) + "\n");
  return entry;
}

/** Recompute an epoch's chain — returns the first broken index or null. */
export function verifyEpoch(epochId: number): { ok: boolean; brokenAt?: number; entries: number } {
  const entries = readEpochEntries(epochId);
  let prev = "GENESIS";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.prevHash !== prev) return { ok: false, brokenAt: i, entries: entries.length };
    const { recordHash, ...rest } = e;
    if (sha256hex(prev + JSON.stringify(rest, Object.keys(rest).sort())) !== recordHash) {
      return { ok: false, brokenAt: i, entries: entries.length };
    }
    prev = recordHash;
  }
  return { ok: true, entries: entries.length };
}

/** Merkle root over an epoch's record hashes — what `anchor_epoch_root`
 *  stores on-chain. */
export function computeEpochRoot(epochId: number): { epochId: number; merkleRoot: string; recordCount: number } {
  const entries = readEpochEntries(epochId);
  return {
    epochId,
    merkleRoot: merkleRoot(entries.map((e) => e.recordHash)),
    recordCount: entries.length,
  };
}

/**
 * Epochs that are closed (their time bucket has fully elapsed), contain at
 * least one record, and haven't been anchored yet. These are what the
 * post-anchor step should submit to `anchor_epoch_root`.
 */
export function pendingEpochs(nowMs = Date.now()): number[] {
  const current = epochIdFor(nowMs);
  const anchored = new Set(loadState().anchoredEpochs.map((e) => e.epochId));
  if (!existsSync(EPOCH_DIR)) return [];
  return readdirSync(EPOCH_DIR)
    .map((f) => /^epoch-(\d+)\.jsonl$/.exec(f)?.[1])
    .filter((s): s is string => !!s)
    .map(Number)
    .filter((id) => id < current && !anchored.has(id) && readEpochEntries(id).length > 0)
    .sort((a, b) => a - b);
}

/** Record an epoch as anchored so it isn't re-submitted. */
export function markEpochAnchored(epochId: number, merkleRootHex: string, recordCount: number, txHash?: string): void {
  const state = loadState();
  if (state.anchoredEpochs.some((e) => e.epochId === epochId)) return;
  state.anchoredEpochs.push({ epochId, merkleRoot: merkleRootHex, recordCount, txHash, anchoredAt: Date.now() });
  saveState(state);
}
