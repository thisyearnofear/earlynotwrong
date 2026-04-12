import { Account, Field } from "@provablehq/sdk/testnet.js";

/**
 * Aleo Treasury Service
 * 
 * Securely manages the treasury account used for behavioral rebates and premium features.
 * Now updated to support the 'Pull' (Signed Voucher) model.
 */
export class AleoTreasury {
  private static instance: AleoTreasury;
  private privateKey: string | undefined;

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
   * In the 'Pull' model, the treasury signs an authorization (voucher) 
   * that the user then submits to the smart contract to claim their rebate.
   */
  public async signVoucher(recipient: string, amount: number): Promise<{ nonce: string; signature: string }> {
    const account = this.getAccount();
    
    // 1. Generate a unique nonce for this voucher.
    // In production, this would be a hash of (recipient, amount, server_nonce).
    // For the demo, we use a random field to simplify the ZK-proof verification.
    const randomValue = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString();
    const nonceField = Field.fromString(randomValue);
    const nonce = nonceField.toString(); // e.g. "123field"

    // 2. Sign the nonce bytes.
    // We sign the byte representation of the field to match Leo's signature::verify.
    const signature = account.sign(nonceField.toBytesLe());

    return {
      nonce,
      signature: signature.toString()
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
