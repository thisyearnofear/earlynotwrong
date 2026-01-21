import { NextResponse } from "next/server";
import { serverCache } from "@/lib/server-cache";

export async function GET() {
  const stats = serverCache.getStats();
  
  return NextResponse.json({
    success: true,
    stats,
    message: "Server cache statistics",
  });
}

export const dynamic = "force-dynamic";
