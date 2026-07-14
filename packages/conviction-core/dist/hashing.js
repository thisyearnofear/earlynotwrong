/**
 * Chain-agnostic hashing for conviction records.
 *
 * keccak256 is the canonical hash across all ENW registries. Both the agent
 * and the web app use these helpers so a subject/thesis hash computed on one
 * side matches the other side exactly.
 */
import { keccak_256 as keccak256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
/** keccak256 hash of a UTF-8 string, returned as 0x-prefixed hex. */
export function computeHash(input) {
    const hash = keccak256(new TextEncoder().encode(input));
    return `0x${bytesToHex(hash)}`;
}
/**
 * Deterministic subject hash from a (chain, address) pair.
 * Matches the scheme used by the ENW registries — same input yields the same
 * hash on every consumer.
 */
export function computeSubjectHash(chain, address) {
    return computeHash(`${chain}:${address}`);
}
/**
 * Deterministic thesis hash from a stable analysis payload.
 * Callers must pass an object with deterministic key order; the helper
 * stringifies via JSON.stringify.
 */
export function computeThesisHash(metrics) {
    return computeHash(JSON.stringify(metrics));
}
