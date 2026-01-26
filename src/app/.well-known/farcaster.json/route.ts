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
      tagline: "Being early feels like being wrong",
      ogTitle: "Early, Not Wrong",
      ogDescription: "On-chain behavioral analysis to prove conviction",
      ogImageUrl: `${APP_URL}/api/og`,
    },
  };

  // Only include accountAssociation if all values are configured
  const header = process.env.FARCASTER_HEADER;
  const payload = process.env.FARCASTER_PAYLOAD;
  const signature = process.env.FARCASTER_SIGNATURE;

  if (header && payload && signature) {
    manifest.accountAssociation = { header, payload, signature };
  }

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
