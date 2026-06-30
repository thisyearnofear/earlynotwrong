/**
 * DEX Trading — SoDEX testnet client + EIP-712 signing.
 *
 * Merged from:
 *   - sodex-client.ts  — SoDEX spot REST API client (market orders, balances)
 *   - sodex-signer.ts  — EIP-712 payload builders & signing helpers
 *
 * Exports: SodexClient, sodexClient, SodexNonceManager, deriveAddress,
 *          buildMarketBuyPayload, buildMarketSellPayload, buildCancelPayload,
 *          computePayloadHash, signExchangeAction, buildSignedRequest.
 */

import { keccak256, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

// =============================================================================
// EIP-712 Constants & Types
// =============================================================================

/**
 * EIP-712 domain separator for SoDEX spot trading on testnet.
 * chainId: 138565 (ValueChain testnet).
 */
export const SODEX_SPOT_DOMAIN = {
  name: "spot",
  chainId: 138565,
  verifyingContract: "0x0000000000000000000000000000000000000000" as const,
} as const;

/** EIP-712 type definition for ExchangeAction { payloadHash, nonce }. */
const EXCHANGE_ACTION_TYPE = [
  { name: "payloadHash", type: "bytes32" },
  { name: "nonce", type: "uint64" },
] as const;

// =============================================================================
// Payload Helpers
// =============================================================================

/**
 * Compute the payloadHash for a SoDEX trading action.
 * Hash = keccak256(JSON.stringify(payload)).
 * The JSON must match Go's json.Marshal output exactly — no extra whitespace,
 * keys in Go struct field order.
 */
export function computePayloadHash(payload: Record<string, unknown>): Hex {
  return keccak256(toBytes(JSON.stringify(payload)));
}

/**
 * Build a spot MARKET BUY order payload.
 * @param clOrdID — Client order ID (unique per order).
 * @param symbol — Trading pair, e.g. "BTCUSDC".
 * @param quoteQuantity — Quote currency amount to spend (e.g. "10.00").
 */
export function buildMarketBuyPayload(clOrdID: string, symbol: string, quoteQuantity: string): Record<string, unknown> {
  return { type: "newOrder", clOrdID, symbol, side: "BUY", orderType: "MARKET", timeInForce: "IMMEDIATE_OR_CANCEL", price: "0", quantity: "0", funds: quoteQuantity };
}

/**
 * Build a spot MARKET SELL order payload.
 * @param clOrdID — Client order ID.
 * @param symbol — Trading pair.
 * @param baseQuantity — Amount of base token to sell (e.g. "0.001").
 */
export function buildMarketSellPayload(clOrdID: string, symbol: string, baseQuantity: string): Record<string, unknown> {
  return { type: "newOrder", clOrdID, symbol, side: "SELL", orderType: "MARKET", timeInForce: "IMMEDIATE_OR_CANCEL", price: "0", quantity: baseQuantity, funds: "0" };
}

/**
 * Build a cancel-order payload.
 * @param clOrdID — Client order ID of the order to cancel.
 * @param symbol — Trading pair the order is on.
 */
export function buildCancelPayload(clOrdID: string, symbol: string): Record<string, unknown> {
  return { type: "cancelOrder", clOrdID, symbol };
}

// =============================================================================
// Signing
// =============================================================================

/** Derive the EVM address from a private key (for nonce tracking). */
export function deriveAddress(privateKey: Hex): Hex {
  return privateKeyToAccount(privateKey).address;
}

/**
 * Sign an ExchangeAction for SoDEX spot trading.
 * 1. EIP-712 sign { payloadHash, nonce } with the API key's private key.
 * 2. Prepend 0x01 byte to produce the SoDEX typed signature.
 *
 * Returns the full typed signature as a hex string for X-API-Sign header.
 */
export async function signExchangeAction(apiKeyPrivateKey: Hex, payloadHash: Hex, nonce: bigint): Promise<Hex> {
  const account = privateKeyToAccount(apiKeyPrivateKey);
  const signature = await account.signTypedData({
    domain: SODEX_SPOT_DOMAIN,
    types: { ExchangeAction: EXCHANGE_ACTION_TYPE },
    primaryType: "ExchangeAction",
    message: { payloadHash, nonce },
  });
  return `0x01${signature.slice(2)}` as Hex;
}

// =============================================================================
// Nonce Management
// =============================================================================

/**
 * Thread-safe nonce manager for SoDEX trading actions.
 * Uses current Unix millisecond time as the nonce source, ensuring monotonic
 * increase. If two calls share the same millisecond, the second is incremented
 * by 1 to avoid collisions.
 */
export class SodexNonceManager {
  private lastNonce = 0n;

  /** Reset the nonce counter (e.g., on restart). */
  reset(): void { this.lastNonce = 0n; }

  /** Generate the next monotonically-increasing nonce. */
  nextNonce(): bigint {
    const now = BigInt(Date.now());
    if (now <= this.lastNonce) { this.lastNonce += 1n; } else { this.lastNonce = now; }
    return this.lastNonce;
  }

  /** Current nonce value (for diagnostics). */
  get currentNonce(): bigint { return this.lastNonce; }
}

// =============================================================================
// Request Builder
// =============================================================================

/**
 * Build the full HTTP request parameters for a SoDEX trading action.
 * Returns { path, headers, body } ready for fetch(), or { error } on failure.
 */
export async function buildSignedRequest(
  apiKeyName: string, apiKeyPrivateKey: Hex, nonceManager: SodexNonceManager,
  action: Record<string, unknown>, endpoint: string = "",
): Promise<{ path: string; headers: Record<string, string>; body: string } | { error: string }> {
  const nonce = nonceManager.nextNonce();
  const payloadHash = computePayloadHash(action);
  const signature = await signExchangeAction(apiKeyPrivateKey, payloadHash, nonce);
  return { path: endpoint, headers: { "X-API-Key": apiKeyName, "X-API-Sign": signature, "Content-Type": "application/json" }, body: JSON.stringify(action) };
}

// =============================================================================
// SoDEX Client Types
// =============================================================================

/** Configuration for the SoDEX testnet client. */
export interface SodexConfig {
  /** API key name sent in X-API-Key header. Default "enw-agent". */
  apiKeyName?: string;
  /** API key's private key (32 bytes hex). Required for signing. */
  apiKeyPrivateKey?: string;
  /** SoDEX spot REST base URL. Defaults to testnet. */
  baseUrl?: string;
}

/** Result of placing or cancelling an order on SoDEX. */
export interface OrderResult {
  success: boolean;
  clOrdID: string;
  orderID?: string;
  symbol?: string;
  avgPrice?: string;
  filledQuantity?: string;
  cummulativeQuoteQty?: string;
  status?: string;
  error?: string;
  timestamp: number;
}

/** A single wallet balance entry from SoDEX. */
export interface BalanceEntry {
  coin: string;
  free: string;
  locked: string;
  total: string;
  usdValue?: number;
}

/** Account info from the SoDEX spot API. */
export interface SodexAccountInfo {
  accountId: string;
  canTrade: boolean;
  balances: BalanceEntry[];
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = "https://testnet-gw.sodex.dev/api/v1/spot";
const DEFAULT_API_KEY_NAME = "enw-agent";
const REQUEST_TIMEOUT_MS = 15000;

async function publicGet<T>(path: string, baseUrl: string): Promise<T | null> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) { console.warn(`[SoDEX] GET ${path} → ${response.status}`); return null; }
    return (await response.json()) as T;
  } catch (err) { console.warn(`[SoDEX] GET ${path} failed:`, err); return null; }
}

// =============================================================================
// SoDEX Client
// =============================================================================

/**
 * SoDEX spot trading client for ValueChain testnet.
 *
 * Provides market order execution via the SoDEX REST API with EIP-712 signing.
 * Used alongside TWAK as an alternative execution venue — the agent prefers
 * SoDEX for new entries and falls back to TWAK on failure.
 */
export class SodexClient {
  private config: Required<Omit<SodexConfig, "apiKeyPrivateKey">> & { apiKeyPrivateKey: Hex };
  private nonceManager = new SodexNonceManager();
  private signingAddress: Hex;
  private accountId: string | null = null;

  /**
   * @param config.apiKeyPrivateKey — 32-byte hex private key. Falls back to SODEX_API_KEY_PRIVATE env var.
   * @param config.apiKeyName — API key name header value. Default "enw-agent".
   * @param config.baseUrl — SoDEX REST base URL. Defaults to testnet.
   */
  constructor(config: SodexConfig = {}) {
    const pk = config.apiKeyPrivateKey || process.env.SODEX_API_KEY_PRIVATE || "";
    const hexPk = pk.startsWith("0x") ? (pk as Hex) : (`0x${pk}` as Hex);
    this.config = { apiKeyName: config.apiKeyName || process.env.SODEX_API_KEY_NAME || DEFAULT_API_KEY_NAME, apiKeyPrivateKey: hexPk, baseUrl: config.baseUrl || process.env.SODEX_BASE_URL || DEFAULT_BASE_URL };
    this.signingAddress = hexPk !== "0x" ? deriveAddress(hexPk) : "0x";
  }

  /** Returns true when API credentials are configured. */
  isAvailable(): boolean { return this.config.apiKeyPrivateKey !== "0x"; }

  /** Place a market buy order. Falls back to TWAK on failure. */
  async placeMarketBuy(symbol: string, quoteQuantity: string): Promise<OrderResult> {
    const clOrdID = this.generateClOrdId("buy");
    return this.submitOrder(buildMarketBuyPayload(clOrdID, symbol, quoteQuantity), clOrdID);
  }

  /** Place a market sell order. */
  async placeMarketSell(symbol: string, baseQuantity: string): Promise<OrderResult> {
    const clOrdID = this.generateClOrdId("sell");
    return this.submitOrder(buildMarketSellPayload(clOrdID, symbol, baseQuantity), clOrdID);
  }

  /** Cancel an open order by client order ID. Returns false on failure. */
  async cancelOrder(clOrdID: string, symbol: string): Promise<boolean> {
    const payload = buildCancelPayload(clOrdID, symbol);
    const nonce = this.nonceManager.nextNonce();
    const signature = await signExchangeAction(this.config.apiKeyPrivateKey, computePayloadHash(payload), nonce);
    try {
      const response = await fetch(`${this.config.baseUrl}/order/cancel`, {
        method: "DELETE", headers: { "X-API-Key": this.config.apiKeyName, "X-API-Sign": signature, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response.ok;
    } catch (err) { console.warn(`[SoDEX] Cancel failed for ${clOrdID}:`, err); return false; }
  }

  /**
   * Fetch the account ID for the configured signing address.
   * Cached after first successful fetch.
   */
  async getAccountId(): Promise<string | null> {
    if (this.accountId) return this.accountId;
    if (this.signingAddress === "0x" || this.signingAddress.length < 10) return null;
    try {
      const info = await publicGet<{ aid?: string; accountID?: string }>(`/user/${this.signingAddress}`, this.config.baseUrl);
      const id = info?.aid ?? info?.accountID ?? null;
      if (id) this.accountId = id;
      return id;
    } catch { return null; }
  }

  /** Fetch all account balances from SoDEX spot. */
  async getBalances(): Promise<BalanceEntry[]> {
    const accountId = await this.getAccountId();
    if (!accountId) return [];
    try {
      const result = await publicGet<{ balances?: BalanceEntry[] }>(`/account/${accountId}/balance`, this.config.baseUrl);
      return result?.balances ?? [];
    } catch { return []; }
  }

  /** Get the USDC balance available for trading on SoDEX. */
  async getUsdcBalance(): Promise<number> {
    const balances = await this.getBalances();
    const usdc = balances.find((b) => b.coin.toUpperCase() === "USDC");
    return parseFloat(usdc?.free ?? "0");
  }

  /** Verify SoDEX testnet connectivity and credentials. */
  async healthCheck(): Promise<boolean> {
    if (!this.isAvailable()) { console.log("[SoDEX] Not configured — set SODEX_API_KEY_PRIVATE to enable"); return false; }
    try {
      const symbols = await publicGet<{ symbols?: unknown[] }>("/exchange/symbols", this.config.baseUrl);
      if (symbols) { console.log(`[SoDEX] Connected to testnet — ${symbols.symbols?.length ?? "?"} symbols`); return true; }
      return false;
    } catch { return false; }
  }

  /** Generate a unique client order ID: `enw-{side}-{timestamp}-{random}`. */
  private generateClOrdId(side: string): string {
    return `enw-${side}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  /** Sign and submit a trading action to SoDEX. Handles HTTP errors gracefully. */
  private async submitOrder(payload: Record<string, unknown>, clOrdID: string): Promise<OrderResult> {
    const nonce = this.nonceManager.nextNonce();
    const signature = await signExchangeAction(this.config.apiKeyPrivateKey, computePayloadHash(payload), nonce);
    const ts = Date.now();
    try {
      const response = await fetch(`${this.config.baseUrl}/order`, {
        method: "POST", headers: { "X-API-Key": this.config.apiKeyName, "X-API-Sign": signature, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) return { success: false, clOrdID, error: `HTTP ${response.status}: ${responseBody.msg ?? responseBody.error ?? response.statusText}`, timestamp: ts };
      return { success: true, clOrdID, orderID: String(responseBody.orderID ?? responseBody.orderId ?? ""), symbol: String(responseBody.symbol ?? payload.symbol ?? ""), avgPrice: String(responseBody.avgPrice ?? responseBody.avg_price ?? ""), filledQuantity: String(responseBody.executedQty ?? responseBody.filledQuantity ?? ""), cummulativeQuoteQty: String(responseBody.cummulativeQuoteQty ?? responseBody.funds ?? ""), status: String(responseBody.status ?? responseBody.orderStatus ?? "NEW"), timestamp: ts };
    } catch (err) { return { success: false, clOrdID, error: err instanceof Error ? err.message : String(err), timestamp: ts }; }
  }
}

/** Singleton SoDEX client instance. Reads SODEX_API_KEY_PRIVATE from the environment. */
export const sodexClient = new SodexClient();
