/**
 * Telegram Channel Adapter
 */

import type { ClusterNotificationPayload } from "../types";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function sendTelegram(
  chatId: string,
  payload: ClusterNotificationPayload
): Promise<{ success: boolean; error?: string }> {
  if (!TELEGRAM_BOT_TOKEN) {
    return { success: false, error: "Telegram bot token not configured" };
  }

  const tokenDisplay = payload.tokenSymbol || payload.tokenAddress.slice(0, 8) + "...";
  const chainLabel = payload.chain === "solana" ? "Solana" : "Base";
  const chainEmoji = payload.chain === "solana" ? "◎" : "🔵";

  const traderList = payload.traders
    .map((t) => {
      const name = t.traderId || t.walletAddress.slice(0, 8) + "...";
      const score = t.trustScore ? ` (${t.trustScore})` : "";
      return `  • ${name}${score}`;
    })
    .join("\n");

  const message = `
🔔 *Cluster Signal Detected*

${chainEmoji} *${payload.clusterSize} traders* entered *${tokenDisplay}* on ${chainLabel}

📊 Avg Trust Score: *${payload.avgTrustScore}*

👥 Traders:
${traderList}

_This is not financial advice._
`.trim();

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
