/**
 * Email Channel Adapter
 * Uses Resend for transactional emails
 */

import type { ClusterNotificationPayload } from "../types";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "alerts@earlynotwrong.com";

export async function sendEmail(
  to: string,
  payload: ClusterNotificationPayload
): Promise<{ success: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    return { success: false, error: "Resend API key not configured" };
  }

  const tokenDisplay = payload.tokenSymbol || payload.tokenAddress.slice(0, 8) + "...";
  const chainLabel = payload.chain === "solana" ? "Solana" : "Base";

  const subject = `🔔 Cluster Alert: ${payload.clusterSize} high-conviction traders entered ${tokenDisplay}`;
  
  const traderList = payload.traders
    .map((t) => {
      const name = t.traderId || t.walletAddress.slice(0, 8) + "...";
      const score = t.trustScore ? ` (Trust: ${t.trustScore})` : "";
      return `• ${name}${score}`;
    })
    .join("\n");

  const html = `
    <div style="font-family: monospace; background: #0a0a0a; color: #e0e0e0; padding: 24px; border-radius: 8px;">
      <h2 style="color: #00ff88; margin: 0 0 16px 0;">Cluster Signal Detected</h2>
      
      <p style="margin: 0 0 8px 0;">
        <strong>${payload.clusterSize} high-conviction traders</strong> have entered 
        <strong style="color: #00d9ff;">${tokenDisplay}</strong> on ${chainLabel}.
      </p>
      
      <p style="margin: 16px 0 8px 0; color: #888;">Average Trust Score: <strong style="color: #fff;">${payload.avgTrustScore}</strong></p>
      
      <div style="background: #1a1a1a; padding: 12px; border-radius: 4px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; color: #888;">Traders:</p>
        <pre style="margin: 0; color: #ccc;">${traderList}</pre>
      </div>
      
      <p style="margin: 16px 0 0 0; font-size: 12px; color: #666;">
        This is not financial advice. Always DYOR.
      </p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
