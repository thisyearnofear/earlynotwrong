import { NextRequest, NextResponse } from "next/server";
import { marketService } from "@/lib/services/market-service";
import { APP_CONFIG } from "@/lib/config";

interface PriceRequest {
  tokenAddress: string;
  chain: "solana" | "base";
  exitPrice?: number;
  exitTimestamp?: number;
  positionSize?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: PriceRequest = await request.json();
    const { tokenAddress, chain, exitPrice, exitTimestamp, positionSize } =
      body;

    if (!tokenAddress || !chain) {
      return NextResponse.json(
        { error: "Missing required fields: tokenAddress, chain" },
        { status: 400 }
      );
    }

    const [metadata, priceAnalysis] = await Promise.all([
      marketService.getTokenMetadata(tokenAddress, chain),
      marketService.getPriceData(tokenAddress, chain),
    ]);

    let patienceTax = null;
    if (exitPrice && exitTimestamp && positionSize) {
      patienceTax = await marketService.calculatePatienceTax(
        tokenAddress,
        chain,
        exitPrice,
        exitTimestamp,
        positionSize,
        APP_CONFIG.analysis.patienceTaxWindowDays
      );
    }

    return NextResponse.json({
      success: true,
      metadata,
      priceAnalysis,
      patienceTax,
    });
  } catch (error) {
    console.error("Price fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch price data", details: String(error) },
      { status: 500 }
    );
  }
}