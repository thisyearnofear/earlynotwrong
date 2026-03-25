import { APP_CONFIG } from "@/lib/config";
import { serverCache, CacheKeys, CacheTTL } from "@/lib/server-cache";
import { TokenTransaction } from "@/lib/market";

// =============================================================================
// Types
// =============================================================================

export interface TokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
}

export interface PriceAnalysis {
  currentPrice: number;
  priceChange24h: number;
  priceChange7d?: number;
  allTimeHigh?: number;
  volume24h?: number;
  marketCap?: number;
  lastUpdated: number;
}

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface PatienceTaxResult {
  patienceTax: number;
  maxMissedGain: number;
  maxMissedGainDate: number;
  currentMissedGain?: number;
  wouldBeValue: number;
}

export interface TransactionParams {
  address: string;
  chain: "solana" | "base";
  timeHorizonDays: number;
  minTradeValue: number;
}

// =============================================================================
// Constants
// =============================================================================

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const ZERION_API_KEY = process.env.ZERION_API_KEY;

const BIRDEYE_URL = "https://public-api.birdeye.so";
const DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex";
const COINGECKO_URL = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_URL = "https://pro-api.coingecko.com/api/v3";

const getCoingeckoUrl = () => COINGECKO_API_KEY ? COINGECKO_PRO_URL : COINGECKO_URL;
const getCoingeckoHeaders = (): HeadersInit => COINGECKO_API_KEY ? { "x-cg-pro-api-key": COINGECKO_API_KEY } : {};

// =============================================================================
// Market Service
// =============================================================================

export class MarketService {
  /**
   * Fetch transactions for a wallet on a specific chain
   */
  async fetchTransactions(params: TransactionParams): Promise<TokenTransaction[]> {
    const { address, chain, timeHorizonDays, minTradeValue } = params;

    if (chain === "solana") {
      return this.fetchSolanaTransactions(address, timeHorizonDays, minTradeValue);
    } else {
      return this.fetchBaseTransactions(address, timeHorizonDays, minTradeValue);
    }
  }

  /**
   * Fetch token metadata with caching
   */
  async getTokenMetadata(
    tokenAddress: string,
    chain: "solana" | "base"
  ): Promise<TokenMetadata | null> {
    const cacheKey = CacheKeys.tokenMetadata(tokenAddress, chain);

    return serverCache.get(
      cacheKey,
      async () => {
        try {
          if (chain === "solana" && BIRDEYE_API_KEY) {
            const response = await fetch(
              `${BIRDEYE_URL}/defi/token_overview?address=${tokenAddress}`,
              {
                headers: { "X-API-KEY": BIRDEYE_API_KEY },
              }
            );

            if (response.ok) {
              const data = await response.json();
              if (data.success && data.data) {
                const token = data.data;
                return {
                  address: tokenAddress,
                  symbol: token.symbol || "UNKNOWN",
                  name: token.name || "Unknown Token",
                  decimals: token.decimals || 9,
                  logoUri: token.logoURI,
                };
              }
            }
          }

          // Fallback to DexScreener
          const response = await fetch(`${DEXSCREENER_URL}/tokens/${tokenAddress}`);
          if (response.ok) {
            const data = await response.json();
            const pair = data.pairs?.[0];
            if (pair) {
              return {
                address: tokenAddress,
                symbol: pair.baseToken?.symbol || "UNKNOWN",
                name: pair.baseToken?.name || "Unknown Token",
                decimals: 18,
                logoUri: pair.info?.imageUrl,
              };
            }
          }

          return null;
        } catch (error) {
          console.warn(`Token metadata fetch failed for ${tokenAddress}:`, error);
          return null;
        }
      },
      CacheTTL.METADATA
    );
  }

  /**
   * Fetch current price and 24h change
   */
  async getPriceData(
    tokenAddress: string,
    chain: "solana" | "base"
  ): Promise<PriceAnalysis | null> {
    const cacheKey = CacheKeys.tokenPrice(tokenAddress, chain);

    return serverCache.get(
      cacheKey,
      async () => {
        try {
          if (chain === "solana" && BIRDEYE_API_KEY) {
            const response = await fetch(
              `${BIRDEYE_URL}/defi/price?list_address=${tokenAddress}`,
              {
                headers: { "X-API-KEY": BIRDEYE_API_KEY },
              }
            );

            if (response.ok) {
              const data = await response.json();
              if (data.success && data.data) {
                const priceData = data.data;
                return {
                  currentPrice: priceData.value || 0,
                  priceChange24h: priceData.priceChange24hPercent || 0,
                  lastUpdated: Date.now(),
                };
              }
            }
          }

          const response = await fetch(`${DEXSCREENER_URL}/tokens/${tokenAddress}`);
          if (response.ok) {
            const data = await response.json();
            const pair = data.pairs?.[0];
            if (pair) {
              return {
                currentPrice: parseFloat(pair.priceUsd || "0"),
                priceChange24h: parseFloat(pair.priceChange?.h24 || "0"),
                lastUpdated: Date.now(),
              };
            }
          }

          return null;
        } catch (error) {
          console.warn(`Price fetch failed for ${tokenAddress}:`, error);
          return null;
        }
      },
      CacheTTL.PRICE_CURRENT
    );
  }

  /**
   * Fetch historical price data for a window
   */
  async getHistoricalPrices(
    tokenAddress: string,
    chain: "solana" | "base",
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<PricePoint[]> {
    const cacheKey = CacheKeys.priceHistory(tokenAddress, chain, fromTimestamp, toTimestamp);

    return serverCache.get(
      cacheKey,
      async () => {
        try {
          // 1. Try Birdeye (Solana only)
          if (chain === "solana" && BIRDEYE_API_KEY) {
            const response = await fetch(
              `${BIRDEYE_URL}/defi/history_price?address=${tokenAddress}&address_type=token&type=1H&time_from=${Math.floor(fromTimestamp / 1000)}&time_to=${Math.floor(toTimestamp / 1000)}`,
              {
                headers: { "X-API-KEY": BIRDEYE_API_KEY },
              }
            );

            if (response.ok) {
              const data = await response.json();
              if (data.success && data.data?.items) {
                return data.data.items.map((item: any) => ({
                  timestamp: item.unixTime * 1000,
                  price: item.value || 0,
                }));
              }
            }
          }

          // 2. Try CoinGecko
          const platformId = chain === "solana" ? "solana" : "base";
          const response = await fetch(
            `${getCoingeckoUrl()}/coins/${platformId}/contract/${tokenAddress}/market_chart/range?vs_currency=usd&from=${Math.floor(
              fromTimestamp / 1000
            )}&to=${Math.floor(toTimestamp / 1000)}`,
            {
              headers: getCoingeckoHeaders(),
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.prices && Array.isArray(data.prices)) {
              return data.prices.map(([timestamp, price]: [number, number]) => ({
                timestamp,
                price,
              }));
            }
          }

          return [];
        } catch (error) {
          console.warn(`Historical price fetch failed for ${tokenAddress}:`, error);
          return [];
        }
      },
      CacheTTL.PRICE_HISTORY
    );
  }

  /**
   * Calculate patience tax for a position
   */
  async calculatePatienceTax(
    tokenAddress: string,
    chain: "solana" | "base",
    exitPrice: number,
    exitTimestamp: number,
    positionSize: number,
    windowDays: number = APP_CONFIG.analysis.patienceTaxWindowDays
  ): Promise<PatienceTaxResult> {
    const endTimestamp = Math.min(
      Date.now(),
      exitTimestamp + windowDays * 24 * 60 * 60 * 1000
    );

    const priceHistory = await this.getHistoricalPrices(
      tokenAddress,
      chain,
      exitTimestamp,
      endTimestamp
    );

    if (priceHistory.length === 0) {
      return {
        patienceTax: 0,
        maxMissedGain: 0,
        maxMissedGainDate: exitTimestamp,
        wouldBeValue: positionSize,
      };
    }

    let maxPrice = exitPrice;
    let maxPriceDate = exitTimestamp;

    for (const point of priceHistory) {
      if (point.price > maxPrice) {
        maxPrice = point.price;
        maxPriceDate = point.timestamp;
      }
    }

    const maxMissedGainMultiplier = maxPrice / exitPrice;
    const maxMissedGain = (maxMissedGainMultiplier - 1) * 100;
    const patienceTax = positionSize * (maxMissedGainMultiplier - 1);
    const wouldBeValue = positionSize * maxMissedGainMultiplier;

    return {
      patienceTax: Math.max(0, patienceTax),
      maxMissedGain,
      maxMissedGainDate: maxPriceDate,
      wouldBeValue,
    };
  }

  /**
   * Fetch Solana transactions with fallbacks
   */
  private async fetchSolanaTransactions(
    address: string,
    timeHorizonDays: number,
    minTradeValue: number
  ): Promise<TokenTransaction[]> {
    if (BIRDEYE_API_KEY) {
      try {
        const birdeyeTxs = await this.fetchSolanaViaBirdeye(address, timeHorizonDays, minTradeValue);
        if (birdeyeTxs.length > 0) return birdeyeTxs;
      } catch (error) {
        console.warn("Birdeye fetch failed, falling back to Helius:", error);
      }
    }

    return this.fetchSolanaViaHelius(address, timeHorizonDays, minTradeValue);
  }

  /**
   * Fetch Solana via Birdeye API
   */
  private async fetchSolanaViaBirdeye(
    address: string,
    timeHorizonDays: number,
    minTradeValue: number
  ): Promise<TokenTransaction[]> {
    const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;
    const transactions: TokenTransaction[] = [];

    const url = `${BIRDEYE_URL}/v1/wallet/tx_list?wallet=${address}&tx_type=swap&limit=100`;
    const response = await fetch(url, {
      headers: {
        "X-API-KEY": BIRDEYE_API_KEY!,
        "x-chain": "solana",
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) throw new Error(`Birdeye API error: ${response.status}`);
    const data = await response.json();
    if (!data.success || !data.data?.items) return [];

    for (const tx of data.data.items) {
      const txTime = tx.blockUnixTime * 1000;
      if (txTime < cutoffTime) continue;

      const fromToken = tx.from;
      const toToken = tx.to;
      if (!fromToken || !toToken) continue;

      const isSolOrStable = (symbol: string) =>
        ["SOL", "USDC", "USDT", "MSOL", "JITOSOL", "STSOL", "WSOL"].includes(symbol?.toUpperCase());

      const isBuy = isSolOrStable(fromToken.symbol) && !isSolOrStable(toToken.symbol);
      const isSell = !isSolOrStable(fromToken.symbol) && isSolOrStable(toToken.symbol);

      if (!isBuy && !isSell) continue;

      const targetToken = isBuy ? toToken : fromToken;
      const valueToken = isBuy ? fromToken : toToken;
      const valueUsd = valueToken.uiAmount * (valueToken.priceUsd || 0);

      if (valueUsd < minTradeValue) continue;

      transactions.push({
        hash: tx.txHash,
        timestamp: txTime,
        tokenAddress: targetToken.address,
        tokenSymbol: targetToken.symbol,
        type: isBuy ? "buy" : "sell",
        amount: targetToken.uiAmount || 0,
        priceUsd: targetToken.priceUsd || 0,
        valueUsd,
        blockNumber: tx.slot || 0,
      });
    }

    return transactions.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Fetch Solana via Helius API
   */
  private async fetchSolanaViaHelius(
    address: string,
    timeHorizonDays: number,
    minTradeValue: number
  ): Promise<TokenTransaction[]> {
    const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;
    const transactions: TokenTransaction[] = [];
    let lastSignature: string | undefined;
    const maxPages = 5;

    if (!HELIUS_API_KEY) return [];

    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`https://api.helius.xyz/v0/addresses/${address}/transactions`);
      url.searchParams.set("api-key", HELIUS_API_KEY);
      if (lastSignature) url.searchParams.set("before", lastSignature);

      const response = await fetch(url.toString(), {
        headers: { "Content-Type": "application/json" },
        next: { revalidate: 300 },
      });

      if (!response.ok) throw new Error(`Helius API error: ${response.status}`);
      const data = await response.json();
      if (!data || data.length === 0) break;

      let reachedCutoff = false;
      for (const tx of data) {
        if (tx.timestamp * 1000 < cutoffTime) {
          reachedCutoff = true;
          break;
        }

        const swapInfo = await this.parseSolanaSwap(tx, address);
        if (swapInfo && swapInfo.valueUsd >= minTradeValue) {
          transactions.push(swapInfo);
        }
      }

      if (reachedCutoff || data.length < 100) break;
      lastSignature = data[data.length - 1].signature;
    }

    return transactions.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Fetch Base transactions with fallbacks
   */
  private async fetchBaseTransactions(
    address: string,
    timeHorizonDays: number,
    minTradeValue: number
  ): Promise<TokenTransaction[]> {
    if (ZERION_API_KEY) {
      try {
        const zTransactions = await this.fetchBaseViaZerion(address, timeHorizonDays, minTradeValue);
        if (zTransactions.length > 0) return zTransactions;
      } catch (e) {
        console.warn("Zerion fetch failed, falling back to Alchemy:", e);
      }
    }

    return this.fetchBaseViaAlchemy(address, timeHorizonDays, minTradeValue);
  }

  /**
   * Fetch Base via Zerion API
   */
  private async fetchBaseViaZerion(
    address: string,
    days: number,
    minVal: number
  ): Promise<TokenTransaction[]> {
    const auth = Buffer.from(ZERION_API_KEY + ":").toString("base64");
    const cutoff = Date.now() - days * 86400 * 1000;
    const txs: TokenTransaction[] = [];

    let url = `https://api.zerion.io/v1/wallets/${address}/transactions/?filter[chain_ids]=base&currency=usd&page[size]=100`;
    let pageCount = 0;
    const MAX_PAGES = 10;

    while (url && pageCount < MAX_PAGES) {
      pageCount++;
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!res.ok) throw new Error(`Zerion API error: ${res.statusText}`);

      const data = await res.json();
      const items = data.data || [];
      if (items.length === 0) break;

      let reachedCutoff = false;
      for (const item of items) {
        const attrs = item.attributes;
        const time = new Date(attrs.mined_at).getTime();
        if (time < cutoff) {
          reachedCutoff = true;
          break;
        }

        for (const transfer of attrs.transfers || []) {
          if (transfer.status !== "confirmed") continue;
          const val = transfer.value || 0;
          if (val < minVal) continue;

          const info = transfer.fungible_info;
          if (!info) continue;

          const impl = info.implementations?.find((i: any) => i.chain_id === "base");
          const tokenAddr = impl?.address || attrs.hash;
          const qty = parseFloat(transfer.quantity.float || "0");
          const price = transfer.price || (qty > 0 ? val / qty : 0);

          txs.push({
            hash: attrs.hash,
            timestamp: time,
            tokenAddress: tokenAddr,
            tokenSymbol: info.symbol || "UNK",
            type: transfer.direction === "in" ? "buy" : "sell",
            amount: qty,
            priceUsd: price,
            valueUsd: val,
            blockNumber: attrs.block_number,
          });
        }
      }

      if (reachedCutoff) break;
      url = data.links?.next || "";
    }

    return txs.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Fetch Base via Alchemy Asset Transfers
   */
  private async fetchBaseViaAlchemy(
    address: string,
    timeHorizonDays: number,
    minTradeValue: number
  ): Promise<TokenTransaction[]> {
    const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;
    const latestBlock = await this.getLatestBaseBlock();
    const cutoffBlock = await this.getBaseBlockByTimestamp(cutoffTime, latestBlock);
    const fromBlockHex = `0x${cutoffBlock.toString(16)}`;

    const [outgoing, incoming] = await Promise.all([
      this.callAlchemyAssetTransfers(address, fromBlockHex, true),
      this.callAlchemyAssetTransfers(address, fromBlockHex, false),
    ]);

    const rawTransfers = [...(outgoing.result?.transfers || []), ...(incoming.result?.transfers || [])];
    const priceCache = new Map<string, number>();

    priceCache.set("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 1.0);
    priceCache.set("0x50c5725949a6f0c72e6c4a641f24049a917db0cb", 1.0);

    const tokensToFetch = new Set<string>();
    rawTransfers.forEach((t: any) => {
      const addr = t.rawContract?.address?.toLowerCase();
      if (!addr || priceCache.has(addr) || parseFloat(t.metadata?.value || "0") > 0) return;
      tokensToFetch.add(addr);
    });

    if (tokensToFetch.size > 0) {
      const batchPrices = await this.batchFetchDexScreenerPrices(Array.from(tokensToFetch));
      batchPrices.forEach((price, addr) => priceCache.set(addr, price));
    }

    const transactions: TokenTransaction[] = [];
    const seenHashes = new Set<string>();

    for (const transfer of rawTransfers) {
      if (seenHashes.has(transfer.hash)) continue;
      seenHashes.add(transfer.hash);

      const txInfo = await this.parseBaseTransfer(transfer, minTradeValue, address, priceCache);
      if (txInfo) transactions.push(txInfo);
    }

    return transactions.sort((a, b) => a.timestamp - b.timestamp);
  }

  private async parseSolanaSwap(tx: any, userAddress: string): Promise<TokenTransaction | null> {
    try {
      const tokenTransfer = tx.tokenTransfers?.[0];
      if (!tokenTransfer) return null;

      const isBuy = tokenTransfer.toUserAccount === userAddress;
      const type = isBuy ? "buy" : "sell";
      const amount = tokenTransfer.tokenAmount;

      let valueUsd = 0;
      const baseAmountRaw = tx.nativeTransfers?.[0]?.amount || 0;
      const baseAmount = baseAmountRaw / 1e9;

      if (baseAmount > 0) {
        const solPrice = await this.getSolPrice();
        valueUsd = baseAmount * solPrice;
      }

      const priceUsd = amount > 0 ? valueUsd / amount : 0;
      return {
        hash: tx.signature,
        timestamp: tx.timestamp * 1000,
        tokenAddress: tokenTransfer.mint,
        tokenSymbol: tokenTransfer.tokenSymbol || "UNKNOWN",
        type,
        amount,
        priceUsd,
        valueUsd,
        blockNumber: tx.slot,
      };
    } catch {
      return null;
    }
  }

  private async parseBaseTransfer(
    transfer: any,
    minVal: number,
    userAddress: string,
    priceMap: Map<string, number>
  ): Promise<TokenTransaction | null> {
    try {
      const tokenAddr = transfer.rawContract?.address?.toLowerCase();
      if (!tokenAddr || tokenAddr === userAddress.toLowerCase() || transfer.category === "external") return null;

      const type = transfer.from.toLowerCase() === userAddress.toLowerCase() ? "sell" : "buy";
      const amount = typeof transfer.value === "number" ? transfer.value : parseFloat(transfer.value || "0");
      let valueUsd = parseFloat(transfer.metadata?.value || "0");

      if (valueUsd <= 0 && amount > 0) {
        const price = priceMap.get(tokenAddr) || await this.getBaseTokenPrice(tokenAddr);
        valueUsd = price * amount;
      }

      if (valueUsd < minVal) return null;

      return {
        hash: transfer.hash,
        timestamp: transfer.metadata?.blockTimestamp ? new Date(transfer.metadata.blockTimestamp).getTime() : Date.now(),
        tokenAddress: tokenAddr,
        tokenSymbol: transfer.asset || "UNKNOWN",
        type,
        amount,
        priceUsd: amount > 0 ? valueUsd / amount : 0,
        valueUsd,
        blockNumber: parseInt(transfer.blockNum, 16),
      };
    } catch {
      return null;
    }
  }

  private async getSolPrice(): Promise<number> {
    return serverCache.get("price:solana:native", async () => {
      try {
        const res = await fetch("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112");
        const data = await res.json();
        return parseFloat(data.data?.So11111111111111111111111111111111111111112?.price || APP_CONFIG.fallbacks.solPrice.toString());
      } catch {
        return APP_CONFIG.fallbacks.solPrice;
      }
    }, 600000);
  }

  private async getBaseTokenPrice(address: string): Promise<number> {
    const data = await this.getPriceData(address, "base");
    return data?.currentPrice || 0;
  }

  private async getLatestBaseBlock(): Promise<number> {
    const res = await fetch(APP_CONFIG.chains.base.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_blockNumber" }),
    });
    const data = await res.json();
    return parseInt(data.result, 16);
  }

  private async getBaseBlockByTimestamp(timestamp: number, currentBlock: number): Promise<number> {
    const daysDiff = (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
    return Math.max(0, currentBlock - Math.floor(daysDiff * 24 * 60 * 60 * 0.5));
  }

  private async callAlchemyAssetTransfers(address: string, fromBlock: string, isFrom: boolean) {
    const response = await fetch(APP_CONFIG.chains.base.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: isFrom ? 1 : 2,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [{
          fromBlock,
          toBlock: "latest",
          [isFrom ? "fromAddress" : "toAddress"]: address,
          category: ["erc20", "external"],
          withMetadata: true,
          excludeZeroValue: true,
          maxCount: "0x3e8",
        }],
      }),
    });
    return response.json();
  }

  private async batchFetchDexScreenerPrices(addresses: string[]): Promise<Map<string, number>> {
    const results = new Map<string, number>();
    const chunks = [];
    for (let i = 0; i < addresses.length; i += 30) chunks.push(addresses.slice(i, i + 30));

    await Promise.all(chunks.map(async (batch) => {
      try {
        const res = await fetch(`${DEXSCREENER_URL}/tokens/${batch.join(",")}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.pairs) return;
        data.pairs.forEach((pair: any) => {
          const addr = pair.baseToken.address.toLowerCase();
          if (!results.has(addr) || parseFloat(pair.liquidity?.usd || "0") > (results.get(addr) || 0)) {
            results.set(addr, parseFloat(pair.priceUsd || "0"));
          }
        });
      } catch {}
    }));
    return results;
  }
}

export const marketService = new MarketService();
