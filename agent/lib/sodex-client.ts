/**
 * SoDEX Testnet Client
 *
 * SoDEX spot trading on ValueChain testnet. Provides market order execution
 * via the SoDEX REST API with EIP-712 signing.
 *
 * Testnet base URL: https://testnet-gw.sodex.dev/api/v1/spot
 *
 * This client integrates alongside TWAK as an alternative execution venue.
 * The agent prefers SoDEX for new entries and falls back to TWAK when:
 *   - SoDEX is not configured (missing SODEX_API_KEY env vars)
 *   - SoDEX returns an error (network, signing, balance issues)
 *   - The token pair doesn't exist on SoDEX
 *
 * Testnet requires no access application — works directly.
 * See: sodex.com/documentation/trading-api/trading-api
 */

import {
  SodexNonceManager,
  deriveAddress,
  buildMarketBuyPayload,
  buildMarketSellPayload,
  buildCancelPayload,
  computePayloadHash,
  signExchangeAction,
} from "./sodex-signer.js";
import type { Hex } from "viem";

// =============================================================================
// Types
// =============================================================================

export interface SodexConfig {
  /** API key name sent in X-API-Key header. Default "enw-agent". */
  apiKeyName?: string;
  /** API key's private key (32 bytes hex). Required for signing. */
  apiKeyPrivateKey?: string;
  /** SoDEX spot REST base URL. Defaults to testnet. */
  baseUrl?: string;
}

export interface OrderResult {
  success: boolean;
  /** Client order ID used in the request. */
  clOrdID: string;
  /** Server-assigned order ID on success. */
  orderID?: string;
  /** Symbol traded. */
  symbol?: string;
  /** Average fill price (market orders). */
  avgPrice?: string;
  /** Total filled quantity. */
  filledQuantity?: string;
  /** Total filled quote amount. */
  cummulativeQuoteQty?: string;
  /** Order status after placement. */
  status?: string;
  /** Error message on failure. */
  error?: string;
  /** Transaction timestamp. */
  timestamp: number;
}

export interface BalanceEntry {
  coin: string;
  free: string;
  locked: string;
  total: string;
  usdValue?: number;
}

export interface SodexAccountInfo {
  accountId: string;
  /** Can trade / can withdraw flags. */
  canTrade: boolean;
  /** List of balances. */
  balances: BalanceEntry[];
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = "https://testnet-gw.sodex.dev/api/v1/spot";
const DEFAULT_API_KEY_NAME = "enw-agent";
const REQUEST_TIMEOUT_MS = 15000;

// =============================================================================
// REST Client
// =============================================================================

/**
 * Make a signed GET request to a SoDEX public endpoint.
 * Public endpoints don't need x-api-key or x-api-sign headers.
 */
async function publicGet<T>(
  path: string,
  baseUrl: string,
): Promise<T | null> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[SoDEX] GET ${path} → ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (err) {
    console.warn(`[SoDEX] GET ${path} failed:`, err);
    return null;
  }
}

// =============================================================================
// SoDEX Client
// =============================================================================

export class SodexClient {
  private config: Required<Omit<SodexConfig, "apiKeyPrivateKey">> & {
    apiKeyPrivateKey: Hex;
  };
  private nonceManager = new SodexNonceManager();
  private signingAddress: Hex;

  /** Cached account ID (fetched lazily, reset on errors). */
  private accountId: string | null = null;

  constructor(config: SodexConfig = {}) {
    const pk = config.apiKeyPrivateKey || process.env.SODEX_API_KEY_PRIVATE || "";
    const hexPk = pk.startsWith("0x") ? (pk as Hex) : (`0x${pk}` as Hex);

    this.config = {
      apiKeyName: config.apiKeyName || process.env.SODEX_API_KEY_NAME || DEFAULT_API_KEY_NAME,
      apiKeyPrivateKey: hexPk,
      baseUrl: config.baseUrl || process.env.SODEX_BASE_URL || DEFAULT_BASE_URL,
    };

    // Derive the signing address from the private key for nonce tracking
    this.signingAddress = hexPk !== "0x" ? deriveAddress(hexPk) : "0x";
  }

  // ===========================================================================
  // Availability
  // ===========================================================================

  /**
   * Whether this client has the credentials to submit orders to SoDEX.
   */
  isAvailable(): boolean {
    return this.config.apiKeyPrivateKey !== "0x";
  }

  // ===========================================================================
  // Order Placement
  // ===========================================================================

  /**
   * Place a market buy order on SoDEX spot testnet.
   *
   * @param symbol - Trading pair, e.g. "BTCUSDC"
   * @param quoteQuantity - Amount of quote currency to spend (e.g., "10.00")
   * @returns OrderResult with order ID or error
   */
  async placeMarketBuy(
    symbol: string,
    quoteQuantity: string,
  ): Promise<OrderResult> {
    const clOrdID = this.generateClOrdId("buy");
    const payload = buildMarketBuyPayload(clOrdID, symbol, quoteQuantity);
    return this.submitOrder(payload, clOrdID);
  }

  /**
   * Place a market sell order on SoDEX spot testnet.
   *
   * @param symbol - Trading pair, e.g. "BTCUSDC"
   * @param baseQuantity - Amount of base token to sell (e.g., "0.001")
   * @returns OrderResult with order ID or error
   */
  async placeMarketSell(
    symbol: string,
    baseQuantity: string,
  ): Promise<OrderResult> {
    const clOrdID = this.generateClOrdId("sell");
    const payload = buildMarketSellPayload(clOrdID, symbol, baseQuantity);
    return this.submitOrder(payload, clOrdID);
  }

  /**
   * Cancel an open order by client order ID.
   */
  async cancelOrder(clOrdID: string, symbol: string): Promise<boolean> {
    const payload = buildCancelPayload(clOrdID, symbol);
    const nonce = this.nonceManager.nextNonce();
    const payloadHash = computePayloadHash(payload);
    const signature = await signExchangeAction(
      this.config.apiKeyPrivateKey,
      payloadHash,
      nonce,
    );

    try {
      const response = await fetch(`${this.config.baseUrl}/order/cancel`, {
        method: "DELETE",
        headers: {
          "X-API-Key": this.config.apiKeyName,
          "X-API-Sign": signature,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response.ok;
    } catch (err) {
      console.warn(`[SoDEX] Cancel failed for ${clOrdID}:`, err);
      return false;
    }
  }

  // ===========================================================================
  // Account / Balance
  // ===========================================================================

  /**
   * Get the account ID for the configured signing address.
   * Cached after first successful fetch.
   */
  async getAccountId(): Promise<string | null> {
    if (this.accountId) return this.accountId;

    // Query account info via the spot API
    const addr = this.signingAddress;
    if (addr === "0x" || addr.length < 10) return null;

    try {
      const info = await publicGet<{ aid?: string; accountID?: string }>(
        `/user/${addr}`,
        this.config.baseUrl,
      );

      const id = info?.aid ?? info?.accountID ?? null;
      if (id) this.accountId = id;
      return id;
    } catch {
      return null;
    }
  }

  /**
   * Fetch account balances from SoDEX spot.
   * Requires a prior getAccountId() call.
   */
  async getBalances(): Promise<BalanceEntry[]> {
    const accountId = await this.getAccountId();
    if (!accountId) return [];

    try {
      const result = await publicGet<{ balances?: BalanceEntry[] }>(
        `/account/${accountId}/balance`,
        this.config.baseUrl,
      );
      return result?.balances ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Get the USDC balance available for trading.
   */
  async getUsdcBalance(): Promise<number> {
    const balances = await this.getBalances();
    const usdc = balances.find(
      (b) => b.coin.toUpperCase() === "USDC",
    );
    return parseFloat(usdc?.free ?? "0");
  }

  // ===========================================================================
  // Health Check
  // ===========================================================================

  /**
   * Quick health check — verifies the testnet is reachable and the API key
   * is configured.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isAvailable()) {
      console.log("[SoDEX] Not configured — set SODEX_API_KEY_PRIVATE to enable");
      return false;
    }

    try {
      // Ping a public endpoint (exchange info/symbols)
      const symbols = await publicGet<{ symbols?: unknown[] }>(
        "/exchange/symbols",
        this.config.baseUrl,
      );
      if (symbols) {
        console.log(`[SoDEX] Connected to testnet — ${symbols.symbols?.length ?? "?"} symbols`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * Generate a unique client order ID.
   * Format: enw-{side}-{timestamp}-{random}
   */
  private generateClOrdId(side: string): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `enw-${side}-${ts}-${rand}`;
  }

  /**
   * Submit a signed trading action to SoDEX.
   * Builds the typed signature, sends the POST request, parses the response.
   */
  private async submitOrder(
    payload: Record<string, unknown>,
    clOrdID: string,
  ): Promise<OrderResult> {
    const nonce = this.nonceManager.nextNonce();
    const payloadHash = computePayloadHash(payload);
    const signature = await signExchangeAction(
      this.config.apiKeyPrivateKey,
      payloadHash,
      nonce,
    );

    const body = JSON.stringify(payload);
    const ts = Date.now();

    try {
      const response = await fetch(`${this.config.baseUrl}/order`, {
        method: "POST",
        headers: {
          "X-API-Key": this.config.apiKeyName,
          "X-API-Sign": signature,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const responseBody = await response.json().catch(() => ({})) as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          clOrdID,
          error: `HTTP ${response.status}: ${responseBody.msg ?? responseBody.error ?? response.statusText}`,
          timestamp: ts,
        };
      }

      // Success — parse the response
      return {
        success: true,
        clOrdID,
        orderID: String(responseBody.orderID ?? responseBody.orderId ?? ""),
        symbol: String(responseBody.symbol ?? payload.symbol ?? ""),
        avgPrice: String(responseBody.avgPrice ?? responseBody.avg_price ?? ""),
        filledQuantity: String(responseBody.executedQty ?? responseBody.filledQuantity ?? ""),
        cummulativeQuoteQty: String(responseBody.cummulativeQuoteQty ?? responseBody.funds ?? ""),
        status: String(responseBody.status ?? responseBody.orderStatus ?? "NEW"),
        timestamp: ts,
      };
    } catch (err) {
      return {
        success: false,
        clOrdID,
        error: err instanceof Error ? err.message : String(err),
        timestamp: ts,
      };
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

/** Default SoDEX testnet client instance. Reads env vars on construction. */
export const sodexClient = new SodexClient();
