import { NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://earlynotwrong.com";

export async function GET() {
  // Build the manifest object
  const manifest: Record<string, unknown> = {
    miniapp: {
      version: "1",
      name: "Early, Not Wrong",
      homeUrl: APP_URL,
      iconUrl: `${APP_URL}/icon-1024.png`,
      splashImageUrl: `${APP_URL}/splash-200.png`,
      splashBackgroundColor: "#050505",
      webhookUrl: `${APP_URL}/api/farcaster/webhook`,
      subtitle: "On-chain conviction analysis",
      description:
        "Analyze trading behavior to distinguish bad timing from bad thesis. Get your conviction score.",
      primaryCategory: "finance",
      tags: ["trading", "defi", "analytics", "onchain", "conviction"],
      heroImageUrl: `${APP_URL}/api/og`,
      imageUrl: `${APP_URL}/api/og`,
      buttonTitle: "Analyze Conviction",
      tagline: "Being early feels like being wrong",
      ogTitle: "Early, Not Wrong",
      ogDescription: "On-chain behavioral analysis to prove conviction",
      ogImageUrl: `${APP_URL}/api/og`,
    },
    accountAssociation: {
      header:
        "eyJmaWQiOjUyNTQsInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHg4QjAzQTJDMzY1YzI2MUFlQmU2ODQyMjREQkI2Qzk1OTJhQkNkRkIyIn0",
      payload: "eyJkb21haW4iOiJlYXJseW5vdHdyb25nLnZlcmNlbC5hcHAifQ",
      signature:
        "0x776403de0b26432bf02f8045ac70e0fe13e572b760fbc4e909d06839c542660ed1eff3fca5d49e56f7c636b74f745cc3499555099bcd3e8ade2c96a5a622f81c31b",
    },
  };

  return NextResponse.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
