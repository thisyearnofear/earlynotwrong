/**
 * Notification Dispatcher
 * Processes queued notification jobs and delivers via appropriate channels
 */

import { sql } from "@vercel/postgres";
import { getList, removeFromList } from "@/lib/kv-cache";
import { sendEmail } from "./channels/email";
import { sendTelegram } from "./channels/telegram";
import type { NotificationJob } from "./types";

const QUEUE_KEY = "notifications:queue";

interface DeliveryResult {
  jobId: string;
  channel: string;
  success: boolean;
  error?: string;
}

/**
 * Get subscriber contact info
 */
async function getSubscriberContact(
  userAddress: string
): Promise<{ email?: string; telegramChatId?: string } | null> {
  try {
    const result = await sql`
      SELECT email, telegram_chat_id
      FROM notification_subscriptions
      WHERE user_address = ${userAddress.toLowerCase()}
        AND is_active = true
    `;
    
    if (result.rows.length === 0) return null;
    
    return {
      email: result.rows[0].email || undefined,
      telegramChatId: result.rows[0].telegram_chat_id || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Record delivery attempt
 */
async function recordDelivery(
  userAddress: string,
  alertId: string,
  channel: string,
  status: "sent" | "failed" | "rate_limited",
  errorMessage?: string
): Promise<void> {
  try {
    await sql`
      INSERT INTO notification_deliveries (
        user_address, alert_id, channel, status, error_message, sent_at
      ) VALUES (
        ${userAddress.toLowerCase()},
        ${alertId},
        ${channel},
        ${status},
        ${errorMessage || null},
        ${status === "sent" ? new Date().toISOString() : null}
      )
      ON CONFLICT (user_address, alert_id, channel) DO UPDATE SET
        status = EXCLUDED.status,
        error_message = EXCLUDED.error_message,
        sent_at = EXCLUDED.sent_at
    `;
  } catch (error) {
    console.warn("Failed to record delivery:", error);
  }
}

/**
 * Check if already delivered (idempotency)
 */
async function isAlreadyDelivered(
  userAddress: string,
  alertId: string,
  channel: string
): Promise<boolean> {
  try {
    const result = await sql`
      SELECT 1 FROM notification_deliveries
      WHERE user_address = ${userAddress.toLowerCase()}
        AND alert_id = ${alertId}
        AND channel = ${channel}
        AND status = 'sent'
    `;
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Deliver a single notification job
 */
async function deliverJob(job: NotificationJob): Promise<DeliveryResult> {
  const { userAddress, alertId, channel, payload } = job;

  // Idempotency check
  if (await isAlreadyDelivered(userAddress, alertId, channel)) {
    return { jobId: job.id, channel, success: true };
  }

  // Get contact info
  const contact = await getSubscriberContact(userAddress);
  if (!contact) {
    return { jobId: job.id, channel, success: false, error: "Subscriber not found" };
  }

  let result: { success: boolean; error?: string };

  switch (channel) {
    case "email":
      if (!contact.email) {
        result = { success: false, error: "No email configured" };
      } else {
        result = await sendEmail(contact.email, payload);
      }
      break;

    case "telegram":
      if (!contact.telegramChatId) {
        result = { success: false, error: "No Telegram chat ID configured" };
      } else {
        result = await sendTelegram(contact.telegramChatId, payload);
      }
      break;

    case "in_app":
      result = { success: true };
      break;

    default:
      result = { success: false, error: `Unknown channel: ${channel}` };
  }

  // Record the delivery attempt
  await recordDelivery(
    userAddress,
    alertId,
    channel,
    result.success ? "sent" : "failed",
    result.error
  );

  return { jobId: job.id, channel, success: result.success, error: result.error };
}

/**
 * Process pending notification jobs
 * Call this from a cron endpoint
 */
export async function processNotificationQueue(
  batchSize: number = 20
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: DeliveryResult[];
}> {
  const jobs = await getList<NotificationJob>(QUEUE_KEY, 0, batchSize - 1);
  
  if (jobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, results: [] };
  }

  const results: DeliveryResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const result = await deliverJob(job);
    results.push(result);
    
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }

    // Remove from queue after processing (success or fail)
    try {
      await removeFromList(QUEUE_KEY, job);
    } catch {
      // Best effort removal
    }
  }

  return {
    processed: jobs.length,
    succeeded,
    failed,
    results,
  };
}
