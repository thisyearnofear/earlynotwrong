/**
 * SoDEX EIP-712 Signer
 *
 * Builds and signs SoDEX-compatible typed structured data for spot trading
 * on testnet. The signing flow:
 *
 *   1. Build the JSON payload (fields in Go struct order)
 *   2. Compute payloadHash = keccak256(JSON.stringify(payload))
 *   3. EIP-712 sign ExchangeAction{payloadHash, nonce} with the API key
 *   4. Prepend 0x01 byte to the 65-byte signature
 *
 * Testnet chainId: 138565
 * Domain: { name: "spot", chainId: 138565, verifyingContract: "0x00..00" }
 *
 * Reference: sodex.com/documentation/trading-api/trading-api
 */

import { keccak256, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

// =============================================================================
// Constants
// =============================================================================

/** EIP-712 domain for SoDEX spot trading on testnet. */
export const SODEX_SPOT_DOMAIN = {
  name: "spot",
  chainId: 138565,
  verifyingContract: "0x0000000000000000000000000000000000000000" as const,
} as const;

/** EIP-712 type definition for ExchangeAction. */
const EXCHANGE_ACTION_TYPE = [
  { name: "payloadHash", type: "bytes32" },
  { name: "nonce", type: "uint64" },
] as const;

// =============================================================================
// Payload Helpers
// =============================================================================

/**
 * Compute the payloadHash for a SoDEX trading action.
 *
 * payloadHash = keccak256(JSON.stringify(payload))
 *
 * CRITICAL: JSON.stringify output must match Go's json.Marshal exactly:
 *   - No extra whitespace or newlines
 *   - Key order must match the Go struct field order
 *   - DecimalString fields must be string (quoted) values
 *   - omitempty fields must be absent when unset
 *
 * We produce compact JSON via JSON.stringify with sorted-keys OFF so the
 * manual key ordering in the payload objects is preserved.
 */
export function computePayloadHash(payload: Record<string, unknown>): Hex {
  const compact = JSON.stringify(payload);
  const hash = keccak256(toBytes(compact));
  return hash;
}

// =============================================================================
// Order Payload Builders
// =============================================================================

/**
 * Build the payload for a spot market BUY order.
 *
 * Key order matches the Go struct field order. This is critical — the server
 * re-marshals via json.Marshal (which serializes in struct order) and compares
 * the resulting hash. Wrong order = signature verification failure.
 *
 * For a MARKET BUY, `funds` is the quote currency amount to spend (e.g., "10.00"
 * means "spend $10 USDC to buy the base token"). `quantity` is "0" for market
 * buy because the amount is determined by the order book.
 */
export function buildMarketBuyPayload(
  clOrdID: string,
  symbol: string,
  quoteQuantity: string,
): Record<string, unknown> {
  return {
    type: "newOrder",
    clOrdID,
    symbol,
    side: "BUY",
    orderType: "MARKET",
    timeInForce: "IMMEDIATE_OR_CANCEL",
    price: "0",
    quantity: "0",
    funds: quoteQuantity,
  };
}

/**
 * Build the payload for a spot market SELL order.
 *
 * For a MARKET SELL, `quantity` is the base token amount to sell.
 */
export function buildMarketSellPayload(
  clOrdID: string,
  symbol: string,
  baseQuantity: string,
): Record<string, unknown> {
  return {
    type: "newOrder",
    clOrdID,
    symbol,
    side: "SELL",
    orderType: "MARKET",
    timeInForce: "IMMEDIATE_OR_CANCEL",
    price: "0",
    quantity: baseQuantity,
    funds: "0",
  };
}

/**
 * Build the payload for cancelling an order by client order ID.
 */
export function buildCancelPayload(
  clOrdID: string,
  symbol: string,
): Record<string, unknown> {
  return {
    type: "cancelOrder",
    clOrdID,
    symbol,
  };
}

// =============================================================================
// Signing
// =============================================================================

/**
 * Derive the EVM address from a private key.
 * Used as the signing address identifier for nonce tracking.
 */
export function deriveAddress(privateKey: Hex): Hex {
  const account = privateKeyToAccount(privateKey);
  return account.address;
}

/**
 * Sign an ExchangeAction for SoDEX spot trading.
 *
 * Steps:
 *   1. EIP-712 sign { payloadHash, nonce } with the API key's private key
 *   2. Prepend 0x01 byte to produce the SoDEX "typed signature"
 *
 * Returns the full typed signature as a hex string,
 * ready to pass as the X-API-Sign header.
 */
export async function signExchangeAction(
  apiKeyPrivateKey: Hex,
  payloadHash: Hex,
  nonce: bigint,
): Promise<Hex> {
  const account = privateKeyToAccount(apiKeyPrivateKey);

  // Step 1: EIP-712 sign the ExchangeAction struct
  const signature = await account.signTypedData({
    domain: SODEX_SPOT_DOMAIN,
    types: {
      ExchangeAction: EXCHANGE_ACTION_TYPE,
    },
    primaryType: "ExchangeAction",
    message: {
      payloadHash,
      nonce,
    },
  });

  // Step 2: Prepend 0x01 byte for the typed signature prefix
  // signature is 0x + 130 hex chars (65 bytes)
  const typedSignature = `0x01${signature.slice(2)}` as Hex;
  return typedSignature;
}

// =============================================================================
// Nonce Management
// =============================================================================

/**
 * Thread-safe nonce manager for SoDEX trading actions.
 *
 * SoDEX stores the 100 highest nonces per signing address. Every new
 * transaction must have a nonce larger than the smallest in this set
 * and must never have been used before.
 *
 * Nonces must also be within (T - 2 days, T + 1 day) of the block
 * timestamp, where T is the block's Unix millisecond timestamp.
 *
 * We use the current Unix time in milliseconds as the nonce source.
 * Since ms gives 1000 unique values per second and we submit at most
 * 1 order per second from a single process, this is collision-free.
 * If two calls happen in the same millisecond, we increment by 1.
 */
export class SodexNonceManager {
  private lastNonce = 0n;

  /** Reset the nonce counter (e.g., on restart). */
  reset(): void {
    this.lastNonce = 0n;
  }

  /**
   * Generate the next nonce for a SoDEX trading action.
   * Uses current Unix time in milliseconds, ensuring monotonic increase.
   */
  nextNonce(): bigint {
    const now = BigInt(Date.now());
    // Ensure strict monotonic increase within the same ms
    if (now <= this.lastNonce) {
      this.lastNonce = this.lastNonce + 1n;
    } else {
      this.lastNonce = now;
    }
    return this.lastNonce;
  }

  /** Current nonce value (for diagnostics). */
  get currentNonce(): bigint {
    return this.lastNonce;
  }
}

// =============================================================================
// Request Builder
// =============================================================================

/**
 * Build the full HTTP request parameters for a SoDEX trading action.
 *
 * Returns { path, headers, body } for use with fetch().
 */
export async function buildSignedRequest(
  apiKeyName: string,
  apiKeyPrivateKey: Hex,
  nonceManager: SodexNonceManager,
  action: Record<string, unknown>,
  endpoint: string = "",
): Promise<{
  path: string;
  headers: Record<string, string>;
  body: string;
} | { error: string }> {
  const nonce = nonceManager.nextNonce();
  const payloadHash = computePayloadHash(action);

  const signature = await signExchangeAction(
    apiKeyPrivateKey,
    payloadHash,
    nonce,
  );

  return {
    path: endpoint,
    headers: {
      "X-API-Key": apiKeyName,
      "X-API-Sign": signature,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(action),
  };
}
