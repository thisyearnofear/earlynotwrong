import { NextRequest, NextResponse } from "next/server";

const AGENT_HOST = process.env.AGENT_HOST || "144.202.117.160";
const AGENT_PORT = process.env.AGENT_PORT || "31777";

const VALID_GET_ENDPOINTS = [
  "status",
  "trades",
  "conviction",
  "edge-report",
  "reputation/stats",
  "cap/status",
  "signals/preview",
  "signals/teaser",
  "casper/balance",
  "casper/anchors",
] as const;

/** Endpoints whose first (uncached) call can take minutes — the edge report
 *  runs a 90-day backtest through the rolling-window rate limiter (20
 *  symbols × 3s pacing). The agent caches the result for 30 min, so repeat
 *  calls are instant, but the cold call needs a generous timeout. */
const SLOW_ENDPOINTS = new Set(["edge-report"]);
const SLOW_ENDPOINT_TIMEOUT_MS = 8 * 60 * 1000; // 8 min — covers a 20-symbol cold fill

const VALID_POST_ENDPOINTS = [
  "casper/build-anchor",
  "casper/submit-anchor",
] as const;

export async function GET(req: NextRequest) {
  const endpoint = req.nextUrl.searchParams.get("endpoint");

  if (!endpoint || !VALID_GET_ENDPOINTS.includes(endpoint as typeof VALID_GET_ENDPOINTS[number])) {
    return NextResponse.json(
      { error: `Invalid endpoint. Valid GET: ${VALID_GET_ENDPOINTS.join(", ")}` },
      { status: 400 },
    );
  }

  // Forward query params for endpoints that need them (e.g. casper/balance?publicKey=…).
  const search = req.nextUrl.searchParams;
  search.delete("endpoint");
  const qs = search.toString();
  const url = `http://${AGENT_HOST}:${AGENT_PORT}/${endpoint}${qs ? `?${qs}` : ""}`;

  try {
    const timeoutMs = SLOW_ENDPOINTS.has(endpoint) ? SLOW_ENDPOINT_TIMEOUT_MS : 10_000;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
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

export async function POST(req: NextRequest) {
  const endpoint = req.nextUrl.searchParams.get("endpoint");

  if (!endpoint || !VALID_POST_ENDPOINTS.includes(endpoint as typeof VALID_POST_ENDPOINTS[number])) {
    return NextResponse.json(
      { error: `Invalid endpoint. Valid POST: ${VALID_POST_ENDPOINTS.join(", ")}` },
      { status: 400 },
    );
  }

  const url = `http://${AGENT_HOST}:${AGENT_PORT}/${endpoint}`;

  try {
    const body = await req.text();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({ error: `Agent returned ${res.status}` }));
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status === 400 ? 400 : 502 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to reach agent: ${message}` },
      { status: 502 },
    );
  }
}
