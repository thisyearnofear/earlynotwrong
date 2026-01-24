/**
 * Notification Queue
 * KV-backed queue for async notification delivery
 */

import { pushToList, getList, setCached, getCached } from "@/lib/kv-cache";
import { sql } from "@vercel/postgres";
import type { NotificationJob, NotificationSubscription, ClusterNotificationPayload } from "./types";
import type { ClusterSignal } from "@/lib/alerts/types";

const QUEUE_KEY = "notifications:queue";
const RATE_LIMIT_PREFIX = "notifications:ratelimit:";

/**
 * Get all active subscribers who should receive a cluster signal
 */
export async function getEligibleSubscribers(
  signal: ClusterSignal
): Promise<NotificationSubscription[]> {
  try {
    const result = await sql`
      SELECT 
        user_address,
        email,
        telegram_chat_id,
        channels,
        min_trust_score,
        min_cluster_size,
        chain_filter,
        token_filter,
        max_alerts_per_hour
      FROM notification_subscriptions
      WHERE is_active = true
        AND min_trust_score <= ${signal.avgTrustScore}
        AND min_cluster_size <= ${signal.clusterSize}
        AND (
          chain_filter IS NULL 
          OR cardinality(chain_filter) = 0 
          OR ${signal.chain} = ANY(chain_filter)
        )
        AND (
          token_filter IS NULL 
          OR cardinality(token_filter) = 0 
          OR ${signal.tokenAddress.toLowerCase()} = ANY(token_filter)
        )
    `;

    return result.rows.map((row) => ({
      userAddress: row.user_address,
      email: row.email || undefined,
      telegramChatId: row.telegram_chat_id || undefined,
      channels: row.channels || ["in_app"],
      minTrustScore: row.min_trust_score,
      minClusterSize: row.min_cluster_size,
      chainFilter: row.chain_filter || [],
      tokenFilter: row.token_filter || [],
      maxAlertsPerHour: row.max_alerts_per_hour,
      isActive: true,
    }));
  } catch (error) {
    console.warn("Failed to fetch notification subscribers:", error);
    return [];
  }
}

/**
 * Check if user is rate limited
 */
async function isRateLimited(
  userAddress: string,
  maxPerHour: number
): Promise<boolean> {
  const key = `${RATE_LIMIT_PREFIX}${userAddress.toLowerCase()}`;
  const count = await getCached<number>(key);
  return (count ?? 0) >= maxPerHour;
}

/**
 * Increment rate limit counter
 */
async function incrementRateLimit(userAddress: string): Promise<void> {
  const key = `${RATE_LIMIT_PREFIX}${userAddress.toLowerCase()}`;
  const current = (await getCached<number>(key)) ?? 0;
  await setCached(key, current + 1, { ttl: 3600 }); // 1 hour TTL
}

/**
 * Enqueue notification jobs for a cluster signal
 */
export async function enqueueClusterNotifications(
  signal: ClusterSignal
): Promise<number> {
  const subscribers = await getEligibleSubscribers(signal);
  let queued = 0;

  const payload: ClusterNotificationPayload = {
    chain: signal.chain,
    tokenAddress: signal.tokenAddress,
    tokenSymbol: signal.tokenSymbol,
    clusterSize: signal.clusterSize,
    avgTrustScore: signal.avgTrustScore,
    traders: signal.uniqueTraders,
  };

  for (const sub of subscribers) {
    // Check rate limit
    if (await isRateLimited(sub.userAddress, sub.maxAlertsPerHour)) {
      continue;
    }

    for (const channel of sub.channels) {
      // Skip channels without config
      if (channel === "email" && !sub.email) continue;
      if (channel === "telegram" && !sub.telegramChatId) continue;

      const job: NotificationJob = {
        id: `${signal.id}:${sub.userAddress}:${channel}`,
        userAddress: sub.userAddress,
        alertId: signal.id,
        channel,
        payload,
        createdAt: Date.now(),
      };

      try {
        await pushToList(QUEUE_KEY, job, 1000);
        await incrementRateLimit(sub.userAddress);
        queued++;
      } catch (error) {
        console.warn(`Failed to queue notification for ${sub.userAddress}:`, error);
      }
    }
  }

  return queued;
}

/**
 * Get pending notification jobs
 */
export async function getPendingJobs(limit: number = 50): Promise<NotificationJob[]> {
  try {
    return await getList<NotificationJob>(QUEUE_KEY, 0, limit - 1);
  } catch {
    return [];
  }
}
