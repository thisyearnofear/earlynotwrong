/**
 * Notification Dispatch Endpoint
 * Called by Vercel Cron to process queued notifications
 * 
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/alerts/dispatch",
 *     "schedule": "* * * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { processNotificationQueue } from "@/lib/notifications";

const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(request: NextRequest) {
  // Verify cron secret if configured
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await processNotificationQueue(20);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Dispatch error:", error);
    return NextResponse.json(
      { error: "Dispatch failed", details: String(error) },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
