import { NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://earlynotwrong.vercel.app";
// Ensure APP_URL starts with https://
const FULL_APP_URL = APP_URL.startsWith("http") ? APP_URL : `https://${APP_URL}`;

export async function GET() {
  const manifest = {
    miniapp: {
      version: "1",
      name: "Early, Not Wrong",
      homeUrl: FULL_APP_URL,
      iconUrl: `${FULL_APP_URL}/icon-1024.png`,
      splashImageUrl: `${FULL_APP_URL}/splash-200.png`,
      splashBackgroundColor: "#050505",
      webhookUrl: `${FULL_APP_URL}/api/farcaster/webhook`,
      subtitle: "On-chain conviction analysis",
      description: "Analyze trading behavior to distinguish bad timing from bad thesis. Get your conviction score.",
      primaryCategory: "finance",
      tags: ["trading", "defi", "analytics", "onchain", "conviction"],
      heroImageUrl: `${FULL_APP_URL}/api/og`,
      imageUrl: `${FULL_APP_URL}/api/og`,
      buttonTitle: "Analyze Conviction",
      tagline: "Early, not wrong.",
      ogTitle: "Early, Not Wrong",
      ogDescription: "On-chain behavioral analysis to prove conviction",
      ogImageUrl: `${FULL_APP_URL}/api/og`
    },
    accountAssociation: {
      header: "eyJmaWQiOjUyNTQsInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHg4QjAzQTJDMzY1YzI2MUFlQmU2ODQyMjREQkI2Qzk1OTJhQkNkRkIyIn0",
      payload: "eyJkb21haW4iOiJlYXJseW5vdHdyb25nLnZlcmNlbC5hcHAifQ",
      signature: "MwdkA94LJkMr8C+ARaxw4P4T5XK3YPvE6QnQaDnFQmYO0e/D/KXUnlb3xja3T3Rcw0mVVQmbzT6K3iyWpaYi+hw="
    }
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "public, max-age=300"
    }
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
