/**
 * Chain-agnostic hashing for conviction records.
 *
 * keccak256 is the canonical hash across all ENW registries. Both the agent
 * and the web app use these helpers so a subject/thesis hash computed on one
 * side matches the other side exactly.
 */
export type Bytes32Hex = `0x${string}`;
/** keccak256 hash of a UTF-8 string, returned as 0x-prefixed hex. */
export declare function computeHash(input: string): Bytes32Hex;
/**
 * Deterministic subject hash from a (chain, address) pair.
 * Matches the scheme used by the ENW registries — same input yields the same
 * hash on every consumer.
 */
export declare function computeSubjectHash(chain: string, address: string): Bytes32Hex;
/**
 * Deterministic thesis hash from a stable analysis payload.
 * Callers must pass an object with deterministic key order; the helper
 * stringifies via JSON.stringify.
 */
export declare function computeThesisHash(metrics: Record<string, string | number | boolean | null | undefined>): Bytes32Hex;
//# sourceMappingURL=hashing.d.ts.map