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

async function fetchBaseTransactions(
  address: string,
  timeHorizonDays: number,
  minTradeValue: number,
): Promise<TokenTransaction[]> {
  const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;
  const latestBlock = await getLatestBlock();
  const cutoffBlock = await getBlockByTimestamp(cutoffTime, latestBlock);
  const fromBlockHex = `0x${cutoffBlock.toString(16)}`;

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
            maxCount: "0x1f4", // 500
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
            maxCount: "0x1f4", // 500
          },
        ],
      }),
      next: { revalidate: 300 },
    }),
  ]);

  if (!outgoingResponse.ok) {
    throw new Error(`Alchemy API error (outgoing): ${outgoingResponse.status}`);
  }
  if (!incomingResponse.ok) {
    throw new Error(`Alchemy API error (incoming): ${incomingResponse.status}`);
  }

  const [outgoingData, incomingData] = await Promise.all([
    outgoingResponse.json(),
    incomingResponse.json(),
  ]);

  const transactions: TokenTransaction[] = [];
  const seenHashes = new Set<string>();

  // Process outgoing transfers (sells)
  for (const transfer of outgoingData.result?.transfers || []) {
    if (seenHashes.has(transfer.hash)) continue;
    seenHashes.add(transfer.hash);
    const txInfo = await parseBaseTransfer(transfer, minTradeValue, address);
    if (txInfo) {
      transactions.push(txInfo);
    }
  }

  // Process incoming transfers (buys)
  for (const transfer of incomingData.result?.transfers || []) {
    if (seenHashes.has(transfer.hash)) continue;
    seenHashes.add(transfer.hash);
    const txInfo = await parseBaseTransfer(transfer, minTradeValue, address);
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

async function getBaseTokenPrice(tokenAddress: string): Promise<number> {
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
    );
    const data = await response.json();
    const pair = data.pairs?.[0];
    return parseFloat(pair?.priceUsd || "0");
  } catch (error) {
    console.warn(
      `Failed to fetch price for Base token ${tokenAddress}:`,
      error,
    );
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
      // Legitimate alternative: fetch real-time price if metadata is missing
      priceUsd = await getBaseTokenPrice(tokenAddress);
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
