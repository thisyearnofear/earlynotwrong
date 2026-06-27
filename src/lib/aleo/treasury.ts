/**
 * Aleo Treasury Service — thin HMAC-authed client of the VPS sign service.
 *
 * Previously this module held ALEO_PRIVATE_KEY directly and signed vouchers
 * in-process on Vercel. That meant the key was decrypted into every
 * serverless invocation's memory, plus any post-install npm dependency in
 * our Next.js build had access via process.env. We moved the key + signing
 * to the agent on the VPS (one process, file-level perms) and made this
 * module call the VPS over an HMAC-authed channel.
 *
 * Required env on Vercel (caller side):
 *   ALEO_SIGN_SERVICE_URL          — e.g. http://144.202.117.160:31777
 *   ALEO_SIGN_SERVICE_HMAC_SECRET  — shared with the VPS (must match)
 *
 * Required env on VPS (signer side):
 *   ALEO_PRIVATE_KEY               — the treasury wallet's private key
 *   ALEO_SIGN_SERVICE_HMAC_SECRET  — shared with Vercel (must match)
 *
 * The signVoucher() interface is unchanged from the previous in-process
 * implementation — callers (the /api/aleo/rebate route) need no changes.
 */

import { createHmac } from "node:crypto";

interface SignedVoucher {
  nonce: string;
  signature: string;
}

interface SignVoucherResponse extends SignedVoucher {
  signerAddress: string;
}

export class AleoTreasury {
  private static instance: AleoTreasury;

  /** Per-process record of nonces we've handed out, keyed by recipient.
   *  Caught double-issues before the on-chain `used_vouchers` check. Kept
   *  as a defense-in-depth signal even though signing now lives on the VPS
   *  (so this set only sees what flowed THROUGH this Vercel function). */
  private issuedNonces = new Map<string, Set<string>>();

  private constructor() {}

  public static getInstance(): AleoTreasury {
    if (!AleoTreasury.instance) {
      AleoTreasury.instance = new AleoTreasury();
    }
    return AleoTreasury.instance;
  }

  /**
   * Generate a signed voucher by calling the VPS sign service.
   *
   * Auth: HMAC-SHA256 over `${timestamp}.${body}` with the shared secret.
   * The VPS rejects anything outside a 30s replay window. We pass our
   * Date.now() as the timestamp; if the user's Vercel function clock drifts
   * meaningfully from the VPS, that's a config issue worth surfacing.
   */
  public async signVoucher(recipient: string, amount: number): Promise<SignedVoucher> {
    const serviceUrl = process.env.ALEO_SIGN_SERVICE_URL;
    const sharedSecret = process.env.ALEO_SIGN_SERVICE_HMAC_SECRET;
    if (!serviceUrl) {
      throw new Error("ALEO_SIGN_SERVICE_URL is not configured (Vercel env).");
    }
    if (!sharedSecret) {
      throw new Error("ALEO_SIGN_SERVICE_HMAC_SECRET is not configured (Vercel env).");
    }

    const timestamp = Date.now().toString();
    const body = JSON.stringify({ recipient, amount });
    const signature = createHmac("sha256", sharedSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    let res: Response;
    try {
      res = await fetch(`${serviceUrl.replace(/\/$/, "")}/aleo/sign-voucher`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-timestamp": timestamp,
          "x-signature": signature,
        },
        body,
        // Reasonable timeout — the VPS sign call is local SDK work,
        // should be sub-second after first-call WASM warmup.
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`Sign service unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(`Sign service returned ${res.status}: ${errorBody.slice(0, 200)}`);
    }

    const json = (await res.json()) as SignVoucherResponse;
    if (!json.nonce || !json.signature) {
      throw new Error("Sign service returned malformed voucher");
    }

    // Track on the caller side too — catches if our own loop ever asks for
    // the same nonce twice (shouldn't, but cheap to flag).
    const seen = this.issuedNonces.get(recipient) ?? new Set<string>();
    if (seen.has(json.nonce)) {
      throw new Error("Nonce collision (≈ 2^-128 chance — retry the request).");
    }
    seen.add(json.nonce);
    this.issuedNonces.set(recipient, seen);

    return { nonce: json.nonce, signature: json.signature };
  }

  /**
   * Validates if a rebate amount is within the safety limits.
   * Mirrored on the VPS side; both fail-closed.
   */
  public validateRebateAmount(amount: number): boolean {
    const MAX_REBATE_UNITS = 1_000_000; // 1 credit (assuming 6 decimals)
    return amount > 0 && amount <= MAX_REBATE_UNITS;
  }
}

export const treasury = AleoTreasury.getInstance();
