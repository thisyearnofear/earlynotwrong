/**
 * Shared domain types for the Early, Not Wrong conviction framework.
 *
 * These types intentionally avoid UI, transport, or chain-specific concerns.
 * They describe the ledger of trades and the metrics derived from it.
 */

/** A single buy or sell event for one token. */
export interface LedgerEntry {
  /** Transaction hash or other unique identifier. */
  hash: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Token contract address. */
  tokenAddress: string;
  /** Human-readable token symbol, if known. */
  tokenSymbol?: string;
  /** "buy" = entry, "sell" = exit. */
  type: "buy" | "sell";
  /** Token amount transacted. */
  amount: number;
  /** Price in USD at the time of the transaction. */
  priceUsd: number;
  /** USD value of the transacted amount. */
  valueUsd: number;
  /** Optional block number or slot for provenance. */
  blockNumber?: number;
}

/** A single token position reconstructed from its entries and exits. */
export interface LedgerPosition {
  tokenAddress: string;
  tokenSymbol?: string;
  entries: LedgerEntry[];
  exits: LedgerEntry[];
  /** Total USD invested across all entries. */
  totalInvested: number;
  /** Total USD realized across all exits. */
  totalRealized: number;
  /** Remaining token balance after exits. */
  remainingBalance: number;
  /** True when the position still has a non-zero balance. */
  isActive: boolean;
}

/** Identifies an analyzed subject (wallet, agent, or other account). */
export interface Subject {
  chain: string;
  address: string;
}

/** A point-in-time price sample used for patience-tax calculations. */
export interface PricePoint {
  timestamp: number;
  price: number;
}

/** Result of a patience-tax calculation. */
export interface PatienceTaxResult {
  /** USD amount left on the table by exiting before the peak. */
  patienceTax: number;
  /** Peak percentage gain within the window relative to the exit price. */
  maxMissedGain: number;
  /** Timestamp of the peak price within the window. */
  maxMissedGainDate: number;
  /** Hypothetical value at the peak price. */
  wouldBeValue: number;
  /** Optional missed gain from current price to peak. */
  currentMissedGain?: number;
}

/** One component of a behavioral score breakdown. */
export interface ScoreComponent {
  /** The raw measured input (0–100 or rate/percentage). */
  value: number;
  /** Points contributed to the final score (may be negative). */
  points: number;
}

/** Exact component contributions behind a behavioral conviction score. */
export interface ScoreBreakdown {
  winRate: ScoreComponent;
  upsideCapture: ScoreComponent;
  earlyExitMitigation: ScoreComponent;
  holdingPeriod: ScoreComponent;
  diamondHands: ScoreComponent;
  consistency: ScoreComponent;
  panicSell: ScoreComponent;
}

export type Archetype =
  | "Iron Pillar"
  | "Profit Phantom"
  | "Exit Voyager"
  | "Diamond Hand";

/** Behavioral measure of how a subject trades, independent of raw P&L. */
export interface BehavioralMetrics {
  /** 0–100 behavioral conviction score. */
  score: number;
  /** Exact components that produced the score. */
  breakdown: ScoreBreakdown;
  /** Total USD left on the table by early exits. */
  patienceTax: number;
  /** Percentage of total potential upside actually captured. */
  upsideCapture: number;
  /** Number of exits that occurred before a subsequent +50% run-up. */
  earlyExits: number;
  /** Number of positions with >50% realized gain. */
  convictionWins: number;
  /** Real cohort rank, null when unavailable. */
  percentile: number | null;
  /** Assigned behavioral archetype. */
  archetype: Archetype;
  /** Total positions analyzed. */
  totalPositions: number;
  /** Average holding period in days. */
  avgHoldingPeriod: number;
  /** Percentage of positions with positive realized P&L. */
  winRate: number;
}

/** The agent's internal market-opportunity score (not a user-facing signal). */
export interface EntrySignal {
  symbol: string;
  /** 0–100 entry-opportunity score. */
  score: number;
  /** Human-readable "why" for logs and dashboards. */
  rationale: string;
}

/** Canonical on-chain conviction record. Used by both agent cycles and wallet analyses. */
export interface ConvictionAnchor {
  /** keccak256(`${chain}:${address}`). */
  subjectHash: `0x${string}`;
  /** keccak256(canonical analysis payload). */
  thesisHash: `0x${string}`;
  /** Distinguishes an agent cycle record from a wallet analysis record. */
  recordType: "agent-cycle" | "wallet-analysis";
  /** Behavioral score for wallets; regime/opportunity score can be attached in metadata. */
  convictionScore: number;
  /** Behavioral or regime archetype label. */
  archetype: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Opaque metadata specific to the record type. */
  metadata: Record<string, unknown>;
}

/** Configuration for behavioral scoring. */
export interface BehavioralWeights {
  winRate: number;
  upsideCapture: number;
  earlyExitMitigation: number;
  holdingPeriod: number;
  diamondHands: number;
  consistency: number;
  panicSell: number;
}

/** Thresholds for assigning archetypes. */
export interface ArchetypeThresholds {
  ironPillar: { minScore: number; maxPatienceTax: number };
  profitPhantom: { minScore: number; minPatienceTax: number };
  exitVoyager: { maxScore: number };
}
