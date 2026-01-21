import { NextRequest, NextResponse } from "next/server";

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
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

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

    const swapInfo = parseSolanaSwap(tx);
    if (swapInfo && swapInfo.valueUsd >= minTradeValue) {
      transactions.push(swapInfo);
    }
  }

  return transactions.sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchBaseTransactions(
  address: string,
  timeHorizonDays: number,
  minTradeValue: number
): Promise<TokenTransaction[]> {
  const alchemyUrl = ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : null;

  if (!alchemyUrl) {
    console.warn("No Alchemy API key configured");
    return [];
  }

  const cutoffTime = Date.now() - timeHorizonDays * 24 * 60 * 60 * 1000;
  const cutoffBlock = await getBlockByTimestamp(cutoffTime);

  const response = await fetch(alchemyUrl, {
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

function parseSolanaSwap(tx: any): TokenTransaction | null {
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

    const solPriceUsd = 180; // TODO: Fetch real SOL price
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

async function getBlockByTimestamp(timestamp: number): Promise<number> {
  const now = Date.now();
  const daysDiff = (now - timestamp) / (24 * 60 * 60 * 1000);
  const currentBlock = 25000000;
  return Math.max(0, currentBlock - Math.floor(daysDiff * 24 * 60 * 60 * 2));
}
