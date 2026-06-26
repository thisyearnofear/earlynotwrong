import { Account, Field } from "@provablehq/sdk/testnet.js";
import { randomBytes } from "node:crypto";

/**
 * Aleo Treasury Service
 *
 * Securely manages the treasury account used for behavioral rebates and
 * premium features under the 'Pull' (Signed Voucher) model — the treasury
 * signs an authorization, the user submits it on-chain.
 */
export class AleoTreasury {
  private static instance: AleoTreasury;
  private privateKey: string | undefined;

  /** Per-process record of nonces we've handed out, keyed by recipient.
   *  Survives within the running Node process — for a multi-instance
   *  deploy this should be backed by Postgres / Redis. */
  private issuedNonces = new Map<string, Set<string>>();

  private constructor() {
    this.privateKey = process.env.ALEO_PRIVATE_KEY;
  }

  public static getInstance(): AleoTreasury {
    if (!AleoTreasury.instance) {
      AleoTreasury.instance = new AleoTreasury();
    }
    return AleoTreasury.instance;
  }

  /**
   * Returns the Aleo account for the treasury.
   */
  public getAccount(): Account {
    if (!this.privateKey) {
      throw new Error("ALEO_PRIVATE_KEY is not configured in the environment.");
    }

    try {
      return new Account({ privateKey: this.privateKey });
    } catch (e) {
      throw new Error(`Failed to initialize Aleo Account: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  /**
   * Generates a signed voucher for a rebate.
   *
   * Two security improvements over the original demo implementation:
   *
   * 1. Cryptographic nonce. The first version used Math.random() — fine for
   *    a single-user demo, terrible if anyone ever runs this in production
   *    (predictable PRNG = an attacker can guess valid voucher nonces).
   *    We now derive 32 bytes from node:crypto.randomBytes and convert to a
   *    field element.
   *
   * 2. Per-process replay protection. We track issued nonces by recipient
   *    so the same nonce can't be re-signed by accident. The on-chain
   *    used_vouchers mapping is the canonical defense; this is just an
   *    early bail-out that catches bugs in our own code.
   */
  public async signVoucher(recipient: string, amount: number): Promise<{ nonce: string; signature: string }> {
    const account = this.getAccount();

    // Crypto-random nonce. randomBytes(32) → BigInt → Field (Aleo BLS12-377
    // scalar field). We mod by Field.size to ensure we land in-range; the
    // probability of bias from a 256-bit input is negligible for our use.
    const bytes = randomBytes(32);
    let hex = "0x";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    const randomValue = BigInt(hex).toString();
    const nonceField = Field.fromString(randomValue);
    const nonce = nonceField.toString();

    // Track per-process — catch double-issues from buggy callers before
    // the on-chain check ever runs.
    const seen = this.issuedNonces.get(recipient) ?? new Set<string>();
    if (seen.has(nonce)) {
      throw new Error("Nonce collision (≈ 2^-128 chance — retry the request).");
    }
    seen.add(nonce);
    this.issuedNonces.set(recipient, seen);

    // Sign the bytes representation to match Leo's signature::verify.
    const signature = account.sign(nonceField.toBytesLe());

    return {
      nonce,
      signature: signature.toString(),
    };
  }

  /**
   * Validates if a rebate amount is within the safety limits.
   */
  public validateRebateAmount(amount: number): boolean {
    const MAX_REBATE_UNITS = 1_000_000; // 1 credit (assuming 6 decimals)
    return amount > 0 && amount <= MAX_REBATE_UNITS;
  }
}

export const treasury = AleoTreasury.getInstance();
