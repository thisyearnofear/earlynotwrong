/**
 * Database Health Check API
 */

import { NextResponse } from "next/server";
import { healthCheck } from "@/lib/db/postgres";

export async function GET() {
  const health = await healthCheck();

  return NextResponse.json(health, {
    status: health.connected ? 200 : 503,
  });
}
