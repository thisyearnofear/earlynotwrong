import { NextRequest, NextResponse } from "next/server";

const AGENT_HOST = process.env.AGENT_HOST || "144.202.117.160";
const AGENT_PORT = process.env.AGENT_PORT || "31777";

const VALID_ENDPOINTS = ["status", "trades", "conviction", "reputation/stats", "cap/status"] as const;

export async function GET(req: NextRequest) {
  const endpoint = req.nextUrl.searchParams.get("endpoint");

  if (!endpoint || !VALID_ENDPOINTS.includes(endpoint as typeof VALID_ENDPOINTS[number])) {
    return NextResponse.json(
      { error: `Invalid endpoint. Valid: ${VALID_ENDPOINTS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const url = `http://${AGENT_HOST}:${AGENT_PORT}/${endpoint}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Agent returned ${res.status}: ${res.statusText}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to reach agent: ${message}` },
      { status: 502 },
    );
  }
}
