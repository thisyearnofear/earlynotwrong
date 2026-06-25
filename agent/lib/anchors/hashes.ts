/**
 * Chain-agnostic hashing for anchor records.
 *
 * keccak256 is the canonical hash across all our adapters. Mantle (Ethereum)
 * uses it natively for bytes32 storage; for Casper we encode the same 32-byte
 * digests as `Bytes` so the same hash identifies the same subject/thesis on
 * either chain.
 *
 * Lives outside `mantle.ts` (where it used to be) so it can be the single
 * source of truth — all adapters import from here, no chain re-implements.
 */

import { keccak_256 as _keccak256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Bytes32Hex } from "./types.js";

/** keccak256 hash of a UTF-8 string, returned as 0x-prefixed hex. */
function keccak256(input: string): Bytes32Hex {
  const hash = _keccak256(new TextEncoder().encode(input));
  return `0x${bytesToHex(hash)}`;
}

/**
 * Deterministic subject hash from a (chain, address) pair.
 * Matches the scheme used by the ENW web app — same input = same hash on
 * every consumer of the registries.
 */
export function computeSubjectHash(chain: string, address: string): Bytes32Hex {
  return keccak256(`${chain}:${address}`);
}

/**
 * Deterministic thesis hash from canonical analysis metrics.
 * Inputs are stringified via `JSON.stringify` with no sorting — callers are
 * expected to provide a stable key order. This matches the existing Mantle
 * implementation; changing it would invalidate prior on-chain references.
 */
export function computeThesisHash(
  metrics: Record<string, string | number | boolean | null>,
): Bytes32Hex {
  return keccak256(JSON.stringify(metrics));
}
