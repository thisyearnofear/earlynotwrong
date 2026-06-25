/**
 * Anchor adapter contract.
 *
 * The agent anchors a conviction record once per cycle. We support multiple
 * destination chains (currently Mantle Sepolia + Casper Testnet) and each chain
 * is encapsulated as an adapter that implements this single interface. The
 * orchestrator in index.ts iterates over enabled adapters and aggregates the
 * results — adding a new chain is one new file, not a refactor of the loop.
 *
 * One record shape, one result shape, one interface — DRY across chains.
 */

/** 0x-prefixed 32-byte hex string (keccak256 digest). */
export type Bytes32Hex = `0x${string}`;

/**
 * The agent's per-cycle anchor payload. Schema parity is intentional across
 * chains: the same `ConvictionRecord` is sent to Mantle and Casper, hashes
 * computed once, so a downstream consumer reading from either chain sees the
 * same canonical record.
 */
export interface ConvictionRecord {
  /** keccak256(`${chain}:${address}`) — identifies the analyzed subject. */
  subjectHash: Bytes32Hex;
  /** keccak256(canonical-JSON of cycle metrics) — proof-of-analysis digest. */
  thesisHash: Bytes32Hex;
  /** 0–100 (clamped at the adapter boundary if necessary). */
  convictionScore: number;
  /** Human-readable regime label, e.g. "DEEP FEAR — PRIME CONTRARIAN". */
  archetype: string;
  /** ms since epoch — set by the agent at submit time. */
  timestamp: number;
}

/** Outcome of an anchor attempt. */
export interface AnchorResult {
  /** Adapter that produced this result — matches AnchorAdapter.name. */
  adapter: string;
  status: "success" | "skipped" | "failed";
  /** Tx hash in adapter-native form (0x-hex for EVM, deploy hash for Casper). */
  txHash?: string;
  /** Block number for EVM chains; era id / height for Casper. */
  blockNumber?: number;
  /** Gas/payment expressed as a decimal string for serialization safety. */
  gasUsed?: string;
  /** Public explorer URL for this transaction. */
  explorerUrl?: string;
  /** Populated when status === "failed". */
  error?: string;
}

/**
 * One chain = one adapter. Implementations are stateless wrappers around a
 * chain-specific SDK; construction takes any required config (RPC, key) at
 * boot and the `anchor` call is what the agent loop invokes per cycle.
 */
export interface AnchorAdapter {
  /** Stable identifier used in logs, config, and AnchorResult.adapter. */
  readonly name: string;
  /** Whether this adapter has the credentials it needs to anchor on-chain. */
  isAvailable(): boolean;
  /** Submit one anchor and wait for confirmation. Never throws — failures
   *  are surfaced via the returned AnchorResult so the orchestrator can
   *  continue to other adapters. */
  anchor(record: ConvictionRecord): Promise<AnchorResult>;
}
