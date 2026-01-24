/**
 * Cluster Detector
 * Detects when multiple high-trust wallets enter the same token
 */

import { getCached, setCached } from "@/lib/kv-cache";
import type {
  TradeEvent,
  ClusterSignal,
  ClusterConfig,
} from "./types";
import { DEFAULT_CLUSTER_CONFIG } from "./types";

// Re-export default config
export { DEFAULT_CLUSTER_CONFIG } from "./types";

interface ClusterBucket {
  wallets: Array<{
    address: string;
    traderId?: string;
    trustScore?: number;
    addedAt: number;
  }>;
  tokenSymbol?: string;
}

function getClusterKey(
  chain: string,
  tokenAddress: string,
  bucketStart: number
): string {
  return `cluster:seen:${chain}:${tokenAddress.toLowerCase()}:${bucketStart}`;
}

function getCooldownKey(chain: string, tokenAddress: string): string {
  return `cluster:emitted:${chain}:${tokenAddress.toLowerCase()}`;
}

function getBucketStart(timestampMs: number, windowMinutes: number): number {
  const windowMs = windowMinutes * 60 * 1000;
  return Math.floor(timestampMs / windowMs) * windowMs;
}

/**
 * Process a trade event and check for cluster formation
 * Returns a ClusterSignal if a new cluster is detected
 */
export async function processTradeEvent(
  event: TradeEvent,
  config: ClusterConfig = DEFAULT_CLUSTER_CONFIG
): Promise<ClusterSignal | null> {
  // Only process buys
  if (event.side !== "buy") {
    return null;
  }

  // Check trust threshold
  const trustScore = event.unifiedTrustScore ?? 0;
  if (trustScore < config.minTrustScore) {
    return null;
  }

  const bucketStart = getBucketStart(event.timestampMs, config.windowMinutes);
  const clusterKey = getClusterKey(event.chain, event.tokenAddress, bucketStart);
  const cooldownKey = getCooldownKey(event.chain, event.tokenAddress);

  // Check if we've already emitted for this token recently
  const alreadyEmitted = await getCached<boolean>(cooldownKey);
  if (alreadyEmitted) {
    return null;
  }

  // Get or create the bucket
  let bucket = await getCached<ClusterBucket>(clusterKey);
  if (!bucket) {
    bucket = { wallets: [], tokenSymbol: event.tokenSymbol };
  }

  // Add wallet if not already in bucket (dedupe)
  const normalizedAddress = event.walletAddress.toLowerCase();
  const exists = bucket.wallets.some(
    (w) => w.address.toLowerCase() === normalizedAddress
  );

  if (!exists) {
    bucket.wallets.push({
      address: event.walletAddress,
      traderId: event.traderId,
      trustScore,
      addedAt: event.timestampMs,
    });

    // Store with TTL of 2x window
    await setCached(clusterKey, bucket, {
      ttl: config.windowMinutes * 2 * 60,
    });
  }

  // Check if we've hit the cluster threshold
  if (bucket.wallets.length >= config.minClusterSize) {
    // Calculate average trust score
    const avgTrustScore =
      bucket.wallets.reduce((sum, w) => sum + (w.trustScore ?? 0), 0) /
      bucket.wallets.length;

    const signal: ClusterSignal = {
      id: `cluster:${event.chain}:${event.tokenAddress.toLowerCase()}:${bucketStart}`,
      kind: "cluster",
      chain: event.chain,
      tokenAddress: event.tokenAddress,
      tokenSymbol: bucket.tokenSymbol || event.tokenSymbol,
      windowMinutes: config.windowMinutes,
      uniqueTraders: bucket.wallets.map((w) => ({
        walletAddress: w.address,
        traderId: w.traderId,
        trustScore: w.trustScore,
      })),
      clusterSize: bucket.wallets.length,
      avgTrustScore: Math.round(avgTrustScore),
      createdAtMs: Date.now(),
    };

    // Set cooldown to prevent duplicate signals
    await setCached(cooldownKey, true, {
      ttl: config.cooldownMinutes * 60,
    });

    return signal;
  }

  return null;
}

/**
 * Get current cluster state for a token (for debugging/display)
 */
export async function getClusterState(
  chain: string,
  tokenAddress: string,
  windowMinutes: number = DEFAULT_CLUSTER_CONFIG.windowMinutes
): Promise<ClusterBucket | null> {
  const bucketStart = getBucketStart(Date.now(), windowMinutes);
  const key = getClusterKey(chain, tokenAddress, bucketStart);
  return getCached<ClusterBucket>(key);
}
