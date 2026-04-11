import { Account } from "@provablehq/sdk/mainnet.js";

/**
 * Aleo Treasury Service
 * 
 * Securely manages the treasury account used for behavioral rebates and premium features.
 * 
 * SECURITY NOTE:
 * In production environments, relying solely on process.env for private keys is a risk.
 * For high-value treasuries, transition to:
 * 1. Cloud KMS (AWS/GCP) for signing transactions without exposing the key.
 * 2. HashiCorp Vault for dynamic secret injection.
 * 3. Multi-signature governance contracts on Aleo.
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
   * Throws if the private key is missing or invalid.
   */
  public getAccount(): Account {
    if (!this.privateKey) {
      throw new Error("ALEO_PRIVATE_KEY is not configured in the environment.");
    }

    if (!this.privateKey.startsWith("APrivateKey1")) {
      throw new Error("Invalid ALEO_PRIVATE_KEY format. Must be an Aleo Private Key.");
    }

    try {
      return new Account({ privateKey: this.privateKey });
    } catch (e) {
      throw new Error(`Failed to initialize Aleo Account: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates if a rebate amount is within the safety limits.
   * Prevents accidental drain of treasury due to bugs or malicious requests.
   */
  public validateRebateAmount(amount: number): boolean {
    const MAX_REBATE_UNITS = 1_000_000; // 1 USDCx (assuming 6 decimals)
    return amount > 0 && amount <= MAX_REBATE_UNITS;
  }
}

export const treasury = AleoTreasury.getInstance();
