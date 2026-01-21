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

export async function POST(request: NextRequest) {
  try {
    const body: TransactionRequest = await request.json();
    const { address, chain, timeHorizonDays, minTradeValue } = body;

    if (!address || !chain) {
      return NextResponse.json(
        { error: "Missing required fields: address, chain" },
        { status: 400 }
      );
    }

    let transactions: TokenTransaction[];

    if (chain === "solana") {
      transactions = await fetchSolanaTransactions(
        address,
        timeHorizonDays,
        minTradeValue
      );
    } else {
      transactions = await fetchBaseTransactions(
        address,
        timeHorizonDays,
        minTradeValue
      );
    }

    return NextResponse.json({
      success: true,
      transactions,
      count: transactions.length,
    });
  } catch (error) {
    console.error("Transaction fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions", details: String(error) },
      { status: 500 }
    );
  }
}

async function fetchSolanaTransactions(
  address: string,
  timeHorizonDays: number,
  minTradeValue: number
): Promise<TokenTransaction[]> {
  const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;

  const heliusUrl = HELIUS_API_KEY
    ? `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}`
    : null;

  if (!heliusUrl) {
    console.warn("No Helius API key configured");
    return [];
  }

  const response = await fetch(heliusUrl, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Helius API error: ${response.status}`);
  }

  const data = await response.json();
  const transactions: TokenTransaction[] = [];

  for (const tx of data) {
    if (tx.timestamp * 1000 < cutoffTime) continue;

    const swapInfo = await parseSolanaSwap(tx);
    if (swapInfo && swapInfo.valueUsd >= minTradeValue) {
      transactions.push(swapInfo);
    }
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
  minTradeValue: number
): Promise<TokenTransaction[]> {
  const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;
  const latestBlock = await getLatestBlock();
  const cutoffBlock = await getBlockByTimestamp(cutoffTime, latestBlock);

  const response = await fetch(APP_CONFIG.chains.base.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [
        {
          fromBlock: `0x${cutoffBlock.toString(16)}`,
          toBlock: "latest",
          fromAddress: address,
          category: ["erc20"],
          withMetadata: true,
          excludeZeroValue: true,
          maxCount: 1000,
        },
      ],
    }),
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Alchemy API error: ${response.status}`);
  }

  const data = await response.json();
  const transactions: TokenTransaction[] = [];

  for (const transfer of data.result?.transfers || []) {
    const txInfo = await parseBaseTransfer(transfer, minTradeValue);
    if (txInfo) {
      transactions.push(txInfo);
    }
  }

  return transactions.sort((a, b) => a.timestamp - b.timestamp);
}

async function getSolPrice(): Promise<number> {
  try {
    const response = await fetch('https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112', {
      next: { revalidate: 600 }
    });
    const data = await response.json();
    return parseFloat(data.data?.So11111111111111111111111111111111111111112?.price || APP_CONFIG.fallbacks.solPrice.toString());
  } catch (error) {
    console.warn("Failed to fetch live SOL price, using fallback:", error);
    return APP_CONFIG.fallbacks.solPrice;
  }
}

async function parseSolanaSwap(tx: any): Promise<TokenTransaction | null> {
  try {
    const tokenTransfers = tx.tokenTransfers || [];
    if (tokenTransfers.length < 2) return null;

    const solTransfer = tokenTransfers.find(
      (t: any) => t.mint === "So11111111111111111111111111111111111111112"
    );

    if (!solTransfer) return null;

    const tokenTransfer = tokenTransfers.find(
      (t: any) => t.mint !== "So11111111111111111111111111111111111111112"
    );

    if (!tokenTransfer) return null;

    const type = solTransfer.fromUserAccount === tx.feePayer ? "buy" : "sell";
    const amount = parseFloat(tokenTransfer.tokenAmount || "0");
    const solAmount = parseFloat(solTransfer.tokenAmount || "0") / 1e9;

    const solPriceUsd = await getSolPrice();
    const valueUsd = solAmount * solPriceUsd;
    const priceUsd = amount > 0 ? valueUsd / amount : 0;

    return {
      hash: tx.signature,
      timestamp: tx.timestamp * 1000,
      tokenAddress: tokenTransfer.mint,
      tokenSymbol: tokenTransfer.tokenSymbol,
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

async function parseBaseTransfer(
  transfer: any,
  minTradeValue: number
): Promise<TokenTransaction | null> {
  try {
    const valueUsd = parseFloat(transfer.metadata?.value || "0");
    if (valueUsd < minTradeValue) return null;

    return {
      hash: transfer.hash,
      timestamp: new Date(transfer.metadata.blockTimestamp).getTime(),
      tokenAddress: transfer.rawContract.address,
      tokenSymbol: transfer.asset,
      type: "sell",
      amount: parseFloat(transfer.value || "0"),
      priceUsd: valueUsd / parseFloat(transfer.value || "1"),
      valueUsd,
      blockNumber: parseInt(transfer.blockNum, 16),
    };
  } catch (error) {
    console.warn("Failed to parse Base transfer:", error);
    return null;
  }
}

async function getBlockByTimestamp(timestamp: number, currentBlock: number): Promise<number> {
  const now = Date.now();
  const daysDiff = (now - timestamp) / (24 * 60 * 60 * 1000);
  // Base is ~2s blocks, so 0.5 blocks/sec
  return Math.max(0, currentBlock - Math.floor(daysDiff * 24 * 60 * 60 * 0.5));
}