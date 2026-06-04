/**
 * Privacy Cash integration (Solana).
 *
 * The `privacycash` SDK depends on Node-only modules (fs, node-localstorage),
 * so we expose a tiny client-safe wrapper that talks to our server-side
 * `/api/privacy/balance` route. The SDK itself is never imported from the
 * browser bundle — see `serverExternalPackages` in next.config.ts.
 */

export interface PrivacyBalance {
  /** SOL balance in lamports */
  solLamports: number;
  /** Formatted SOL amount */
  solFormatted: string;
  /** Whether the balance was successfully fetched */
  ok: boolean;
  /** Error message if ok=false */
  error?: string;
}

/**
 * Client-side call to the privacy-balance API route.
 * The route uses its own RPC + the Privacy Cash SDK on the server.
 */
export async function fetchPrivateBalance(
  publicKey: string,
): Promise<PrivacyBalance> {
  try {
    const res = await fetch(
      `/api/privacy/balance?address=${encodeURIComponent(publicKey)}`,
    );
    const body = await res.json();
    if (!res.ok) {
      return {
        solLamports: 0,
        solFormatted: "0.0000",
        ok: false,
        error: body.error ?? "Failed to read private balance",
      };
    }
    return body as PrivacyBalance;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return {
      solLamports: 0,
      solFormatted: "0.0000",
      ok: false,
      error: msg,
    };
  }
}

/**
 * Returns the Privacy Cash explorer URL for a given public key.
 */
export function privacyCashExplorerUrl(publicKey: string): string {
  return `https://app.privacycash.com/?address=${publicKey}`;
}
