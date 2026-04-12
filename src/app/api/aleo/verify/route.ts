import { NextRequest, NextResponse } from "next/server";
import { AleoNetworkClient } from "@provablehq/sdk/testnet.js";
import { APP_CONFIG } from "@/lib/config";

export async function POST(req: NextRequest) {
  try {
    const { transactionId } = await req.json();

    if (!transactionId) {
      return NextResponse.json(
        { error: "Missing transactionId" },
        { status: 400 }
      );
    }

    const client = new AleoNetworkClient(APP_CONFIG.chains.aleo.apiUrl);
    
    // Check transaction status
    const transaction = await client.getTransaction(transactionId).catch(() => null);

    if (!transaction) {
      return NextResponse.json(
        { 
          verified: false, 
          status: "not_found",
          message: `Transaction not found on Aleo ${APP_CONFIG.chains.aleo.network === "testnet3" ? "Testnet" : "Mainnet"} yet. It might still be propagating.` 
        },
        { status: 200 }
      );
    }

    // In a real app, we would verify the transition inputs/outputs
    // to ensure it matches the claimed proof (e.g. correct program and function)
    const isConvictionProgram = transaction.execution?.transitions?.some(
      (t: { program: string }) => t.program === APP_CONFIG.chains.aleo.programId
    );

    return NextResponse.json({
      verified: true,
      status: "confirmed",
      program: APP_CONFIG.chains.aleo.programId,
      isCorrectProgram: isConvictionProgram,
      timestamp: new Date().toISOString(),
      transaction: {
        id: transaction.id,
        type: transaction.type,
      }
    });
  } catch (error) {
    console.error("Aleo verification API error:", error);
    return NextResponse.json(
      { error: "Internal server error during verification" },
      { status: 500 }
    );
  }
}
