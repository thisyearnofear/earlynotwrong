import { NextRequest, NextResponse } from "next/server";
import { treasury } from "@/lib/aleo/treasury";

/**
 * Per-address rate limit. A full eligibility check would prove the user holds
 * a ConvictionRecord meeting a threshold — but Aleo records are private
 * (decryptable only by the owner), so the server can't read them. A proper
 * gate requires the client to submit a ZK proof of ownership; that's a
 * larger workstream. For now this is the best we can do without on-chain
 * decrypt: throttle per-address to prevent voucher farming.
 *
 * Survives within the running Node process — for a multi-instance deploy
 * this should move to Postgres / Redis.
 */
const REBATE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const lastIssuedAt = new Map<string, number>();

function tooSoon(address: string): boolean {
  const last = lastIssuedAt.get(address);
  if (!last) return false;
  return Date.now() - last < REBATE_COOLDOWN_MS;
}

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

    // Per-address cooldown (basic anti-farming).
    if (tooSoon(userAddress)) {
      const remainingMs = REBATE_COOLDOWN_MS - (Date.now() - (lastIssuedAt.get(userAddress) ?? 0));
      return NextResponse.json(
        {
          error: "Rebate cooldown active",
          retryAfterSeconds: Math.ceil(remainingMs / 1000),
        },
        { status: 429 }
      );
    }

    // Voucher signing happens on the VPS via HMAC-authed call — see
    // src/lib/aleo/treasury.ts. Vercel no longer holds ALEO_PRIVATE_KEY.
    const voucher = await treasury.signVoucher(userAddress, Number(amount));
    lastIssuedAt.set(userAddress, Date.now());

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
