/**
 * Alert Types
 * Canonical models for trade events and derived signals
 */

export type Chain = "solana" | "base";
export type TradeSide = "buy" | "sell";

/**
 * Normalized trade event from any chain
 */
export interface TradeEvent {
  id: string;
  chain: Chain;
  walletAddress: string;
  traderId?: string;
  timestampMs: number;

  tokenAddress: string;
  tokenSymbol?: string;

  side: TradeSide;
  amount?: number;
  valueUsd?: number;

  txHash: string;

  // Trust context (attached after resolution)
  unifiedTrustScore?: number;
  unifiedTrustTier?: string;
}

/**
 * Cluster signal - derived when multiple high-trust wallets enter same token
 */
export interface ClusterSignal {
  id: string;
  kind: "cluster";
  chain: Chain;
  tokenAddress: string;
  tokenSymbol?: string;
  windowMinutes: number;
  uniqueTraders: Array<{
    walletAddress: string;
    traderId?: string;
    trustScore?: number;
  }>;
  clusterSize: number;
  avgTrustScore: number;
  createdAtMs: number;
}

/**
 * Unified alert type (can be trade or cluster)
 */
export type Alert = (TradeEvent & { kind: "trade" }) | ClusterSignal;

/**
 * Cluster detection configuration
 */
export interface ClusterConfig {
  windowMinutes: number;
  minClusterSize: number;
  minTrustScore: number;
  cooldownMinutes: number;
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  windowMinutes: 15,
  minClusterSize: 3,
  minTrustScore: 65,
  cooldownMinutes: 30,
};
