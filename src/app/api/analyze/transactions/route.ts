import { NextRequest, NextResponse } from "next/server";
import { APP_CONFIG } from "@/lib/config";

interface TransactionRequest {
  address: string;
  chain: "solana" | "base";
  timeHorizonDays: number;
  minTradeValue: number;
}

interface TokenTransaction {
  hash: string;
  timestamp: number;
  tokenAddress: string;
  tokenSymbol?: string;
  type: "buy" | "sell";
  amount: number;
  priceUsd: number;
  valueUsd: number;
  blockNumber: number;
}

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const ZERION_API_KEY = process.env.ZERION_API_KEY;

// Base/stablecoin tokens used for trading pairs
const KNOWN_BASE_TOKENS = [
  "So11111111111111111111111111111111111111112", // SOL / WSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (Solana)
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT (Solana)
  "mSoLzYq7mSqcxt3ED4PSc69RzY83W95G5p7s8pAnJdV", // mSOL
  "J1toso9YmRAn99mX6K399Nn5E7f9oY1s3vshV68yTth", // jitoSOL
  "7dHbS7qBSnS6fJ686mD9B756S8PqM756S8PqM756S8Pq", // stSOL
];

// Common wrapped/synthetic tokens to filter as base pairs
const WRAPPED_TOKENS = [
  "So11111111111111111111111111111111111111112", // Wrapped SOL
  "0x4200000000000000000000000000000000000006", // WETH (Base)
];

// Token patterns to exclude (LP tokens, NFTs, etc.)
function shouldExcludeToken(
  symbol: string | null | undefined,
  address: string,
): boolean {
  if (!symbol) return false;

  const symbolUpper = symbol.toUpperCase();

  // Exclude LP tokens
  if (
    symbolUpper.includes("-LP") ||
    symbolUpper.includes("LP-") ||
    symbolUpper.includes("UNI-V2") ||
    symbolUpper.includes("CAKE-LP") ||
    symbolUpper.includes("SLP")
  ) {
    return true;
  }

  // Exclude wrapped versions we want to treat as base
  if (WRAPPED_TOKENS.includes(address)) {
    return false; // These are base tokens, not tradeable assets
  }

  return false;
}

// Validate transaction data quality
function validateTransactions(transactions: TokenTransaction[]): {
  valid: TokenTransaction[];
  invalid: number;
  quality: {
    withSymbols: number;
    withValidPrices: number;
    withValidAmounts: number;
    avgValueUsd: number;
  };
} {
  const valid: TokenTransaction[] = [];
  let invalid = 0;
  let withSymbols = 0;
  let withValidPrices = 0;
  let withValidAmounts = 0;
  let totalValue = 0;

  for (const tx of transactions) {
    // Basic validation: must have essential fields
    if (!tx.tokenAddress || tx.timestamp <= 0 || tx.valueUsd < 0) {
      invalid++;
      continue;
    }

    // Exclude suspicious LP tokens
    if (shouldExcludeToken(tx.tokenSymbol, tx.tokenAddress)) {
      invalid++;
      continue;
    }

    if (tx.tokenSymbol) withSymbols++;
    if (tx.priceUsd > 0) withValidPrices++;
    if (tx.amount > 0) withValidAmounts++;
    totalValue += tx.valueUsd;

    valid.push(tx);
  }

  return {
    valid,
    invalid,
    quality: {
      withSymbols,
      withValidPrices,
      withValidAmounts,
      avgValueUsd: valid.length > 0 ? totalValue / valid.length : 0,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: TransactionRequest = await request.json();
    const { address, chain, timeHorizonDays, minTradeValue } = body;

    if (!address || !chain) {
      return NextResponse.json(
        { error: "Missing required fields: address, chain" },
        { status: 400 },
      );
    }

    let rawTransactions: TokenTransaction[];

    if (chain === "solana") {
      rawTransactions = await fetchSolanaTransactions(
        address,
        timeHorizonDays,
        minTradeValue,
      );
    } else {
      rawTransactions = await fetchBaseTransactions(
        address,
        timeHorizonDays,
        minTradeValue,
      );
    }

    // Validate and filter transactions
    const {
      valid: transactions,
      invalid,
      quality,
    } = validateTransactions(rawTransactions);

    return NextResponse.json({
      success: true,
      transactions,
      count: transactions.length,
      quality: {
        totalRaw: rawTransactions.length,
        invalidFiltered: invalid,
        dataCompleteness: {
          symbolRate: Math.round(
            (quality.withSymbols / Math.max(transactions.length, 1)) * 100,
          ),
          priceRate: Math.round(
            (quality.withValidPrices / Math.max(transactions.length, 1)) * 100,
          ),
          amountRate: Math.round(
            (quality.withValidAmounts / Math.max(transactions.length, 1)) * 100,
          ),
        },
        avgTradeSize: Math.round(quality.avgValueUsd * 100) / 100,
      },
    });
  } catch (error) {
    console.error("Transaction fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions", details: String(error) },
      { status: 500 },
    );
  }
}

async function fetchSolanaTransactions(
  address: string,
  timeHorizonDays: number,
  minTradeValue: number,
): Promise<TokenTransaction[]> {
  // Try Birdeye first (best for trading history), then Helius as fallback
  if (BIRDEYE_API_KEY) {
    try {
      const birdeyeTxs = await fetchSolanaViaBirdeye(
        address,
        timeHorizonDays,
        minTradeValue,
      );
      if (birdeyeTxs.length > 0) {
        return birdeyeTxs;
      }
    } catch (error) {
      console.warn("Birdeye fetch failed, falling back to Helius:", error);
    }
  }

  // Fallback to Helius with pagination
  return fetchSolanaViaHelius(address, timeHorizonDays, minTradeValue);
}

async function fetchSolanaViaBirdeye(
  address: string,
  timeHorizonDays: number,
  minTradeValue: number,
): Promise<TokenTransaction[]> {
  const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;
  const transactions: TokenTransaction[] = [];

  // Birdeye wallet trade history API
  const url = `https://public-api.birdeye.so/v1/wallet/tx_list?wallet=${address}&tx_type=swap&limit=100`;

  const response = await fetch(url, {
    headers: {
      "X-API-KEY": BIRDEYE_API_KEY!,
      "x-chain": "solana",
    },
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Birdeye API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.success || !data.data?.items) {
    return [];
  }

  for (const tx of data.data.items) {
    const txTime = tx.blockUnixTime * 1000;
    if (txTime < cutoffTime) continue;

    // Birdeye provides parsed swap data directly
    const fromToken = tx.from;
    const toToken = tx.to;

    if (!fromToken || !toToken) continue;

    // Determine if this is a buy or sell based on SOL/stablecoin flow
    const isSolOrStable = (symbol: string) =>
      ["SOL", "USDC", "USDT", "MSOL", "JITOSOL", "STSOL", "WSOL"].includes(
        symbol?.toUpperCase(),
      );

    const isBuy =
      isSolOrStable(fromToken.symbol) && !isSolOrStable(toToken.symbol);
    const isSell =
      !isSolOrStable(fromToken.symbol) && isSolOrStable(toToken.symbol);

    if (!isBuy && !isSell) continue; // Skip token-to-token for now

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

async function fetchSolanaViaHelius(
  address: string,
  timeHorizonDays: number,
  minTradeValue: number,
): Promise<TokenTransaction[]> {
  const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;
  const transactions: TokenTransaction[] = [];
  let lastSignature: string | undefined;
  const maxPages = 5; // Fetch up to 500 transactions

  if (!HELIUS_API_KEY) {
    console.warn("No Helius API key configured");
    return [];
  }

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(
      `https://api.helius.xyz/v0/addresses/${address}/transactions`,
    );
    url.searchParams.set("api-key", HELIUS_API_KEY);
    if (lastSignature) {
      url.searchParams.set("before", lastSignature);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      throw new Error(`Helius API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data || data.length === 0) break;

    let reachedCutoff = false;
    for (const tx of data) {
      if (tx.timestamp * 1000 < cutoffTime) {
        reachedCutoff = true;
        break;
      }

      const swapInfo = await parseSolanaSwap(tx, address);
      if (swapInfo && swapInfo.valueUsd >= minTradeValue) {
        transactions.push(swapInfo);
      }
    }

    if (reachedCutoff || data.length < 100) break;
    lastSignature = data[data.length - 1].signature;
  }

  return transactions.sort((a, b) => a.timestamp - b.timestamp);
}

async function getLatestBlock(): Promise<number> {
  try {
    const response = await fetch(APP_CONFIG.chains.base.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_blockNumber",
      }),
    });
    const data = await response.json();
    return parseInt(data.result, 16);
  } catch (error) {
    console.warn("Failed to fetch latest block, using fallback:", error);
    return 25000000;
  }
}

// Helper for batching
function chunk<T>(array: T[], size: number): T[][] {
  const chunked: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
}

async function fetchBaseTransactions(
  address: string,
  timeHorizonDays: number,
  minTradeValue: number,
): Promise<TokenTransaction[]> {
  // Try Zerion first (Unified + Best Pricing)
  if (ZERION_API_KEY) {
    try {
      console.log(`[Base Transactions] Attempting Zerion API fetch for ${address}...`);
      const zTransactions = await fetchBaseViaZerion(address, timeHorizonDays, minTradeValue);
      if (zTransactions.length > 0) {
        console.log(`[Base Transactions] Zerion returned ${zTransactions.length} transactions`);
        return zTransactions;
      }
    } catch (e) {
      console.warn("Zerion fetch failed, falling back to Alchemy/RPC stack:", e);
    }
  }

  console.log(`[Base Transactions] Starting fetch for ${address} (${timeHorizonDays}d, >$${minTradeValue})`);
  const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;

  // Get block range
  const latestBlock = await getLatestBlock();
  const cutoffBlock = await getBlockByTimestamp(cutoffTime, latestBlock);
  const fromBlockHex = `0x${cutoffBlock.toString(16)}`;

  console.log(`[Base Transactions] Scanning blocks ${cutoffBlock} to ${latestBlock}`);

  // Fetch both outgoing (sells) and incoming (buys) transfers in parallel
  const [outgoingResponse, incomingResponse] = await Promise.all([
    fetch(APP_CONFIG.chains.base.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [
          {
            fromBlock: fromBlockHex,
            toBlock: "latest",
            fromAddress: address,
            category: ["erc20", "external"],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: "0x3e8", // 1000 - increased limit
          },
        ],
      }),
      next: { revalidate: 300 },
    }),
    fetch(APP_CONFIG.chains.base.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [
          {
            fromBlock: fromBlockHex,
            toBlock: "latest",
            toAddress: address,
            category: ["erc20", "external"],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: "0x3e8", // 1000
          },
        ],
      }),
      next: { revalidate: 300 },
    }),
  ]);

  if (!outgoingResponse.ok || !incomingResponse.ok) {
    throw new Error(`Alchemy API error: ${outgoingResponse.status} / ${incomingResponse.status}`);
  }

  const [outgoingData, incomingData] = await Promise.all([
    outgoingResponse.json(),
    incomingResponse.json(),
  ]);

  const rawTransfers = [
    ...(outgoingData.result?.transfers || []),
    ...(incomingData.result?.transfers || [])
  ];

  console.log(`[Base Transactions] Fetched ${rawTransfers.length} raw transfers`);

  // 1. Identify tokens needing price data (missing alchemy metadata)
  const tokensToFetch = new Set<string>();
  const priceCache = new Map<string, number>();

  // Pre-fill known stablecoins
  const KNOWN_TOKENS = {
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 1.0, // USDC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 1.0, // DAI
    '0x4200000000000000000000000000000000000006': 0, // WETH - handle via DexScreener to get real price
  };

  Object.entries(KNOWN_TOKENS).forEach(([addr, price]) => {
    if (price > 0) priceCache.set(addr.toLowerCase(), price);
  });

  rawTransfers.forEach(t => {
    if (t.category === 'external') return; // ETH transfers handled separately or skipped
    const tokenAddr = t.rawContract?.address?.toLowerCase();
    if (!tokenAddr) return;

    // Use Alchemy value if valid and sufficient
    const metaValue = parseFloat(t.metadata?.value || "0");
    if (metaValue > 0) return; // We have value

    if (!priceCache.has(tokenAddr)) {
      tokensToFetch.add(tokenAddr);
    }
  });

  // 2. Batch fetch prices from DexScreener
  const uniqueTokens = Array.from(tokensToFetch);
  console.log(`[Base Transactions] Need prices for ${uniqueTokens.length} tokens`);

  // DexScreener allows multiple tokens per call (30 max recommended)
  const tokenChunks = chunk(uniqueTokens, 30);

  await Promise.all(tokenChunks.map(async (batch) => {
    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${batch.join(',')}`
      );
      if (!response.ok) return;

      const data = await response.json();
      if (!data.pairs) return;

      // Create a map of best pair per token
      const bestPairs = new Map<string, any>();

      data.pairs.forEach((pair: any) => {
        const baseToken = pair.baseToken.address.toLowerCase();
        // Prefer USD pairs or high liquidity
        if (!bestPairs.has(baseToken) || parseFloat(pair.liquidity?.usd || "0") > parseFloat(bestPairs.get(baseToken)?.liquidity?.usd || "0")) {
          bestPairs.set(baseToken, pair);
        }
      });

      bestPairs.forEach((pair, tokenAddr) => {
        const price = parseFloat(pair.priceUsd || "0");
        if (price > 0) {
          priceCache.set(tokenAddr, price);
        }
      });
    } catch (e) {
      console.warn("Batch price fetch failed", e);
    }
  }));

  console.log(`[Base Transactions] Price cache populated with ${priceCache.size} entries`);

  // 3. Process transactions
  const transactions: TokenTransaction[] = [];
  const seenHashes = new Set<string>();

  // Process all transfers
  for (const transfer of rawTransfers) {
    if (seenHashes.has(transfer.hash)) continue;
    seenHashes.add(transfer.hash);

    // Parse with price cache
    const txInfo = await parseBaseTransfer(transfer, minTradeValue, address, priceCache);
    if (txInfo) {
      transactions.push(txInfo);
    }
  }

  return transactions.sort((a, b) => a.timestamp - b.timestamp);
}

async function getSolPrice(): Promise<number> {
  try {
    const response = await fetch(
      "https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112",
      {
        next: { revalidate: 600 },
      },
    );
    const data = await response.json();
    return parseFloat(
      data.data?.So11111111111111111111111111111111111111112?.price ||
      APP_CONFIG.fallbacks.solPrice.toString(),
    );
  } catch (error) {
    console.warn("Failed to fetch live SOL price, using fallback:", error);
    return APP_CONFIG.fallbacks.solPrice;
  }
}

// Cache for token metadata to avoid repeated lookups
const tokenMetadataCache = new Map<string, string | null>();

async function getSolanaTokenSymbol(mint: string): Promise<string | null> {
  if (tokenMetadataCache.has(mint)) {
    return tokenMetadataCache.get(mint) || null;
  }

  // Try Jupiter API with auth
  if (JUPITER_API_KEY) {
    try {
      const response = await fetch(`https://tokens.jup.ag/token/${mint}`, {
        headers: { Authorization: `Bearer ${JUPITER_API_KEY}` },
        next: { revalidate: 86400 },
      });

      if (response.ok) {
        const data = await response.json();
        const symbol = data.symbol || null;
        if (symbol) {
          tokenMetadataCache.set(mint, symbol);
          return symbol;
        }
      }
    } catch {
      // Fall through to DexScreener
    }
  }

  // Fallback: DexScreener (free, no key)
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      {
        next: { revalidate: 3600 },
      },
    );

    if (response.ok) {
      const data = await response.json();
      const pair = data.pairs?.[0];
      if (pair) {
        const symbol =
          pair.baseToken?.address === mint
            ? pair.baseToken?.symbol
            : pair.quoteToken?.symbol;
        if (symbol) {
          tokenMetadataCache.set(mint, symbol);
          return symbol;
        }
      }
    }
  } catch {
    // Ignore
  }

  tokenMetadataCache.set(mint, null);
  return null;
}

async function parseSolanaSwap(
  tx: {
    tokenTransfers?: Array<{
      mint: string;
      toUserAccount: string;
      tokenAmount: number | string;
      tokenSymbol?: string;
    }>;
    feePayer?: string;
    signature: string;
    timestamp: number;
    slot: number;
  },
  walletAddress: string,
): Promise<TokenTransaction | null> {
  try {
    const tokenTransfers = tx.tokenTransfers || [];
    if (tokenTransfers.length < 2) return null;

    // Find base token (SOL, USDC, or USDT)
    const baseTransfer = tokenTransfers.find((t) =>
      KNOWN_BASE_TOKENS.includes(t.mint),
    );

    if (!baseTransfer) return null;

    // Find the traded token (non-base token)
    const tokenTransfer = tokenTransfers.find(
      (t) => !KNOWN_BASE_TOKENS.includes(t.mint),
    );

    if (!tokenTransfer) return null;

    // Determine buy/sell: if wallet received the token, it's a buy
    const isBuy =
      tokenTransfer.toUserAccount === walletAddress ||
      tokenTransfer.toUserAccount === tx.feePayer;
    const type = isBuy ? "buy" : "sell";

    // tokenAmount can be a number or string - handle both
    const rawTokenAmount = tokenTransfer.tokenAmount;
    const amount =
      typeof rawTokenAmount === "number"
        ? rawTokenAmount
        : parseFloat(rawTokenAmount || "0");

    const rawBaseAmount = baseTransfer.tokenAmount;
    let baseAmountRaw =
      typeof rawBaseAmount === "number"
        ? rawBaseAmount
        : parseFloat(rawBaseAmount || "0");

    // Handle decimal conversion based on token type
    const isSol =
      baseTransfer.mint === "So11111111111111111111111111111111111111112";

    // Helius tokenAmount is generally already the uiAmount (scaled float).
    // We only divide if the number is so large it's clearly a raw lamport/atomic value.
    // Threshold: 10^12 (1000 SOL or 1M USDC).
    if (isSol && baseAmountRaw > 1_000_000_000_000) {
      baseAmountRaw = baseAmountRaw / 1e9;
    } else if (!isSol && baseAmountRaw > 1_000_000_000_000) {
      baseAmountRaw = baseAmountRaw / 1e6;
    }

    // Get USD value
    let valueUsd: number;
    if (isSol) {
      const solPriceUsd = await getSolPrice();
      valueUsd = baseAmountRaw * solPriceUsd;
    } else {
      valueUsd = baseAmountRaw; // USDC/USDT is 1:1 USD
    }

    const priceUsd = amount > 0 ? valueUsd / amount : 0;

    // Get token symbol - use provided or lookup
    let tokenSymbol = tokenTransfer.tokenSymbol;
    if (!tokenSymbol) {
      const resolved = await getSolanaTokenSymbol(tokenTransfer.mint);
      tokenSymbol = resolved || undefined;
    }

    return {
      hash: tx.signature,
      timestamp: tx.timestamp * 1000,
      tokenAddress: tokenTransfer.mint,
      tokenSymbol: tokenSymbol || "UNKNOWN",
      type,
      amount,
      priceUsd,
      valueUsd,
      blockNumber: tx.slot,
    };
  } catch (error) {
    console.warn("Failed to parse Solana swap:", error);
    return null;
  }
}

// Module-level price cache (cleared per request via weak references or timeout)
const basePriceCache = new Map<string, { price: number; timestamp: number }>();
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// GeckoTerminal fallback
async function getGeckoTerminalPrice(address: string): Promise<number> {
  try {
    const response = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/tokens/${address}`,
      { next: { revalidate: 3600 } }
    );

    if (!response.ok) return 0;

    const data = await response.json();
    return parseFloat(data.data?.attributes?.price_usd || "0");
  } catch (error) {
    return 0;
  }
}

async function getBaseTokenPrice(tokenAddress: string): Promise<number> {
  // Check cache first
  const cached = basePriceCache.get(tokenAddress);
  if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
    return cached.price;
  }

  try {
    // Primary: DexScreener
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
    );

    if (response.ok) {
      const data = await response.json();
      const pair = data.pairs?.[0];
      const price = parseFloat(pair?.priceUsd || "0");
      if (price > 0) {
        basePriceCache.set(tokenAddress, { price, timestamp: Date.now() });
        return price;
      }
    }

    // Fallback: GeckoTerminal
    console.log(`[Price Fallback] Trying GeckoTerminal for ${tokenAddress}`);
    const geckoPrice = await getGeckoTerminalPrice(tokenAddress);
    if (geckoPrice > 0) {
      basePriceCache.set(tokenAddress, { price: geckoPrice, timestamp: Date.now() });
      return geckoPrice;
    }

    // No price found
    basePriceCache.set(tokenAddress, { price: 0, timestamp: Date.now() });
    return 0;
  } catch (error) {
    console.warn(
      `Failed to fetch price for Base token ${tokenAddress}:`,
      error instanceof Error ? error.message : 'Unknown',
    );
    basePriceCache.set(tokenAddress, { price: 0, timestamp: Date.now() });
    return 0;
  }
}


async function parseBaseTransfer(
  transfer: {
    rawContract?: { address: string };
    value: number | string;
    hash: string;
    category?: string;
    metadata?: {
      value?: string;
      blockTimestamp?: string;
    };
    blockNum: string;
    asset: string;
    from: string;
  },
  minTradeValue: number,
  userAddress: string,
  priceMap?: Map<string, number>,
): Promise<TokenTransaction | null> {
  try {
    // Skip if the token being transferred IS the user's address (e.g., ENS-style tokens)
    const tokenAddress = transfer.rawContract?.address?.toLowerCase();
    if (!tokenAddress || tokenAddress === userAddress.toLowerCase()) {
      return null;
    }

    // Skip external ETH transfers (we want token trades, not plain ETH sends)
    if (transfer.category === "external") {
      return null;
    }

    const isSell = transfer.from.toLowerCase() === userAddress.toLowerCase();
    const type = isSell ? "sell" : "buy";

    // Alchemy value is often in USD for known tokens, but we should verify
    let valueUsd = parseFloat(transfer.metadata?.value || "0");
    const amount =
      typeof transfer.value === "number"
        ? transfer.value
        : parseFloat(transfer.value || "0");

    let priceUsd = 0;
    if (valueUsd > 0 && amount > 0) {
      priceUsd = valueUsd / amount;
    } else {
      // Check price map first
      if (priceMap && tokenAddress && priceMap.has(tokenAddress)) {
        priceUsd = priceMap.get(tokenAddress) || 0;
      } else {
        // Legitimate alternative: fetch real-time price if metadata is missing and not in cache
        priceUsd = await getBaseTokenPrice(tokenAddress);
      }
      valueUsd = priceUsd * amount;
    }

    if (valueUsd < minTradeValue) return null;

    return {
      hash: transfer.hash,
      timestamp: transfer.metadata?.blockTimestamp
        ? new Date(transfer.metadata.blockTimestamp).getTime()
        : Date.now(),
      tokenAddress: tokenAddress,
      tokenSymbol: transfer.asset || "UNKNOWN",
      type,
      amount,
      priceUsd,
      valueUsd,
      blockNumber: parseInt(transfer.blockNum, 16),
    };
  } catch (error) {
    console.warn("Failed to parse Base transfer:", error);
    return null;
  }
}

async function getBlockByTimestamp(
  timestamp: number,
  currentBlock: number,
): Promise<number> {
  const now = Date.now();
  const daysDiff = (now - timestamp) / (24 * 60 * 60 * 1000);
  // Base is ~2s blocks, so 0.5 blocks/sec
  return Math.max(0, currentBlock - Math.floor(daysDiff * 24 * 60 * 60 * 0.5));
}

async function fetchBaseViaZerion(
  address: string,
  days: number,
  minVal: number
): Promise<TokenTransaction[]> {
  if (!ZERION_API_KEY) return [];

  const auth = Buffer.from(ZERION_API_KEY + ':').toString('base64');
  const cutoff = Date.now() - (days * 86400 * 1000);
  const txs: TokenTransaction[] = [];

  let url = `https://api.zerion.io/v1/wallets/${address}/transactions/?filter[chain_ids]=base&currency=usd&page[size]=100`;
  let pageCount = 0;
  const MAX_PAGES = 10; // Capped to prevent exhausting daily quota (300 req/day)

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

      for (const transfer of (attrs.transfers || [])) {
        // Only confirmed transactions
        if (transfer.status !== 'confirmed') continue;

        // Filter junk/spam with no value if minVal > 0
        const val = transfer.value || 0;
        if (val < minVal) continue;

        // Skip non-fungible transfers for now (NFTs) unless they have value?
        // Zerion puts NFTs in fungible_info too sometimes, simpler to check symbol
        const info = transfer.fungible_info;
        if (!info) continue;

        const symbol = info.symbol || 'UNK';
        const impl = info.implementations?.find((i: any) => i.chain_id === 'base');
        const tokenAddr = impl?.address || attrs.hash; // Fallback if no addr

        const qty = parseFloat(transfer.quantity.float || "0");
        const price = transfer.price || (qty > 0 ? val / qty : 0);

        txs.push({
          hash: attrs.hash,
          timestamp: time,
          tokenAddress: tokenAddr,
          tokenSymbol: symbol,
          type: transfer.direction === 'in' ? 'buy' : 'sell', // in = receive (buy), out = send (sell)
          amount: qty,
          priceUsd: price,
          valueUsd: val,
          blockNumber: attrs.block_number,
        });
      }
    }

    if (reachedCutoff) break;

    if (data.links?.next) {
      url = data.links.next;
    } else {
      url = "";
    }
  }

  return txs.sort((a, b) => a.timestamp - b.timestamp);
}
