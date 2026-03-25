import { NextRequest, NextResponse } from "next/server";
import { marketService } from "@/lib/services/market-service";

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

    // Use consolidated MarketService
    const rawTransactions = await marketService.fetchTransactions({
      address,
      chain,
      timeHorizonDays,
      minTradeValue,
    });

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