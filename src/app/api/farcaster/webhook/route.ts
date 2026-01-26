import { NextRequest, NextResponse } from "next/server";

interface WebhookEvent {
  header: string;
  payload: string;
  signature: string;
}

interface DecodedPayload {
  event: "miniapp_added" | "miniapp_removed" | "notifications_enabled" | "notifications_disabled";
  notificationDetails?: {
    url: string;
    token: string;
  };
  fid?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: WebhookEvent = await request.json();

    // Decode the base64url payload
    const payloadJson = Buffer.from(body.payload, "base64url").toString("utf-8");
    const payload: DecodedPayload = JSON.parse(payloadJson);

    console.log(`[Farcaster Webhook] Event: ${payload.event}`, {
      fid: payload.fid,
      hasNotificationDetails: !!payload.notificationDetails,
    });

    switch (payload.event) {
      case "miniapp_added":
      case "notifications_enabled":
        if (payload.notificationDetails && payload.fid) {
          // Store notification token for this user
          // In production, save to database
          console.log(`[Farcaster] User ${payload.fid} enabled notifications`);
        }
        break;

      case "miniapp_removed":
      case "notifications_disabled":
        if (payload.fid) {
          // Remove notification token for this user
          console.log(`[Farcaster] User ${payload.fid} disabled notifications`);
        }
        break;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Farcaster Webhook] Error:", error);
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }
}
