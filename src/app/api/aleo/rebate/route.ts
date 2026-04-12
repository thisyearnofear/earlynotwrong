import { NextRequest, NextResponse } from "next/server";
import { 
  initializeWasm
} from "@provablehq/sdk/testnet.js";
import { treasury } from "@/lib/aleo/treasury";

export async function POST(req: NextRequest) {
  try {
    const { userAddress, amount } = await req.json();

    if (!userAddress || !amount) {
      return NextResponse.json(
        { error: "Missing userAddress or amount" },
        { status: 400 }
      );
    }

    // Safety limit check
    if (!treasury.validateRebateAmount(Number(amount))) {
      return NextResponse.json(
        { error: "Rebate amount exceeds safety limits" },
        { status: 403 }
      );
    }

    // Initialize WASM for Aleo SDK
    await initializeWasm();

    // Generate signed voucher instead of executing on-chain transfer
    // This follows the 'Pull' model where the platform authorizes but the user executes.
    const voucher = await treasury.signVoucher(userAddress, Number(amount));

    return NextResponse.json({
      success: true,
      voucher: {
        recipient: userAddress,
        amount: amount.toString(),
        nonce: voucher.nonce,
        signature: voucher.signature
      },
      message: `Rebate voucher generated. Please submit the claim transaction to Aleo.`
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
