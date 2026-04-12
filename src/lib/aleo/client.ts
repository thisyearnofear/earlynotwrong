import { APP_CONFIG } from "@/lib/config";

/**
 * Aleo Client Utility for Explorer Interaction
 */

export interface TransactionStatus {
  status: "pending" | "confirmed" | "failed";
  error?: string;
}

/**
 * Checks transaction status by polling the explorer API.
 */
export async function getTransactionStatus(txId: string): Promise<string> {
  // Shield wallet sometimes returns temporary IDs starting with 'shield_'.
  // If the ID isn't a 64-char hex, the explorer API will likely return 404.
  if (txId.startsWith("shield_")) return "pending";

  try {
    // API pattern: {apiUrl}/v1/{network}/transaction/{txId}
    const response = await fetch(`${APP_CONFIG.chains.aleo.apiUrl}/testnet3/transaction/${txId}`);
    if (!response.ok) return "pending";
    const data = await response.json();
    return data.status || "pending";
  } catch {
    return "pending";
  }
}

/**
 * Utility to poll for transaction finalization.
 */
export async function waitForTransaction(txId: string, timeoutMs = 300000): Promise<boolean> {
  // If we receive a shield-prefixed ID, we know we cannot query the explorer.
  // Return 'false' immediately to indicate this ID won't finalize,
  // prompting the hook to handle this as a 'waiting for user action' state.
  if (txId.startsWith("shield_")) {
    console.warn("Received shield_ ID; cannot poll explorer. Returning pending.");
    return false;
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getTransactionStatus(txId);
    if (status === "finalized" || status === "confirmed") return true;
    if (status === "rejected" || status === "failed") return false;
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Poll every 3s
  }
  return false;
}
