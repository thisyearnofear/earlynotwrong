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
 * An anchored record once it has settled on-chain. Same shape as the input
 * ConvictionRecord plus chain-side metadata (who anchored it, when it landed).
 * Single source of truth for both write and read paths.
 */
export interface AnchoredRecord extends ConvictionRecord {
  /** Adapter that holds this record ("mantle" | "casper" | …). */
  adapter: string;
  /** Account/wallet that submitted the anchor (hex/0x for EVM, hex for Casper). */
  anchoredBy: string;
  /** Tx/deploy hash if known. Optional because event logs don't always carry it. */
  txHash?: string;
  /** Public explorer URL pointing at the anchor tx or the contract record. */
  explorerUrl?: string;
}

/**
 * One chain = one adapter. Implementations are stateless wrappers around a
 * chain-specific SDK; construction takes any required config (RPC, key) at
 * boot and the `anchor` call is what the agent loop invokes per cycle.
 *
 * The read methods are how the MCP server and any other downstream consumer
 * pulls anchored records back out of the chain — no entry-point gas needed
 * for either Mantle (view functions) or Casper (event/state queries).
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
  /** Read all records anchored for a subject, chronological. Returns empty
   *  array if the subject has no anchors yet. */
  getSubjectHistory(subjectHash: Bytes32Hex): Promise<AnchoredRecord[]>;
  /** Read the most recent record for a subject, or null if none. */
  getLatestConviction(subjectHash: Bytes32Hex): Promise<AnchoredRecord | null>;
  /** Look up a record by its thesis hash, or null if not anchored on this chain. */
  getByThesis(thesisHash: Bytes32Hex): Promise<AnchoredRecord | null>;
}
