import { NextRequest, NextResponse } from "next/server";
import { 
  Account, 
  AleoNetworkClient, 
  ProgramManager, 
  AleoKeyProvider, 
  NetworkRecordProvider,
  initializeWasm
} from "@provablehq/sdk/mainnet.js";
import { APP_CONFIG } from "@/lib/config";

const PRIVATE_KEY = process.env.ALEO_PRIVATE_KEY;

export async function POST(req: NextRequest) {
  try {
    const { userAddress, amount } = await req.json();

    if (!PRIVATE_KEY) {
      return NextResponse.json(
        { error: "Treasury private key not configured on server" },
        { status: 500 }
      );
    }

    if (!userAddress || !amount) {
      return NextResponse.json(
        { error: "Missing userAddress or amount" },
        { status: 400 }
      );
    }

    // Initialize WASM for Aleo SDK
    await initializeWasm();

    const account = new Account({ privateKey: PRIVATE_KEY });
    const networkClient = new AleoNetworkClient(APP_CONFIG.chains.aleo.apiUrl);
    const keyProvider = new AleoKeyProvider();
    const recordProvider = new NetworkRecordProvider(account, networkClient);
    
    const programManager = new ProgramManager(
      APP_CONFIG.chains.aleo.apiUrl, 
      keyProvider, 
      recordProvider
    );
    programManager.setAccount(account);

    // Amount should be u64 (number as string)
    // We assume 6 decimals for USDCx (200,000 = 0.2 USDCx)
    const rebateAmount = amount.toString() + "u64";

    console.log(`Executing rebate: ${rebateAmount} USDCx to ${userAddress}`);

    const txId = await programManager.execute({
      programName: APP_CONFIG.chains.aleo.usdcProgramId,
      functionName: "transfer_public",
      inputs: [userAddress, rebateAmount],
      priorityFee: 0.1, // Credits for fee
      privateFee: false
    });

    return NextResponse.json({
      success: true,
      transactionId: txId,
      message: `Rebate of ${amount} units sent to ${userAddress}`
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error during rebate";
    console.error("Aleo rebate API error:", error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
