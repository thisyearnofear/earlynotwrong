import { NextRequest, NextResponse } from "next/server";
import { PrivacyCash } from "privacycash";

/**
 * GET /api/privacy/balance
 *
 * Reads a Solana wallet's private SOL balance via the Privacy Cash SDK.
 * Runs server-side only (see next.config.ts serverExternalPackages).
 *
 * The server uses its own Helius/mainnet RPC. The client only needs to
 * provide its public key — no signing is required for balance reads.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Missing address query param" },
      { status: 400 },
    );
  }

  const rpcUrl =
    process.env.HELIUS_RPC_URL ||
    (process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com");

  try {
    const client = new PrivacyCash({
      RPC_url: rpcUrl,
      owner: address,
      enableDebug: false,
    });

    const { lamports } = await client.getPrivateBalance();

    return NextResponse.json({
      solLamports: lamports,
      solFormatted: (lamports / 1e9).toFixed(4),
      ok: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("Privacy balance fetch failed:", msg);
    return NextResponse.json(
      {
        solLamports: 0,
        solFormatted: "0.0000",
        ok: false,
        error: msg,
      },
      { status: 500 },
    );
  }
}
