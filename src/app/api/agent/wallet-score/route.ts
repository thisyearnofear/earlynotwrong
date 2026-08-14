/**
 * POST /api/agent/wallet-score
 *
 * Behavioral conviction scoring as a service — the `wallet-score/v1` product.
 * Send a wallet address + chain, get back the behavioral score (win rate,
 * patience tax, archetype, cohort percentile) with a verifiable ledger hash.
 *
 * This is the same scoring the interactive `/analyzer` runs, packaged as a
 * clean API for the MCP/CAP `wallet-score` service. See
 * `docs/WALLET_SCORE_PLAN.md` and `src/lib/wallet-score.ts`.
 *
 * No auth — the rate limit + the CROO/MCP paywall are the gate. The route is
 * intentionally thin: all logic lives in `scoreWallet()` so it's testable
 * and reusable.
 */

import { NextRequest, NextResponse } from "next/server";
import { scoreWallet, type WalletChain } from "@/lib/wallet-score";

// ─── Rate limiting ───────────────────────────────────────────────────────────
//
// Simple in-memory IP + address limiter. The CROO/MCP paywall is the real
// gate for production use; this just prevents a cold caller from hammering
// the (expensive) on-chain fetch path for free. 5 calls / 10 min / IP, and
// 1 concurrent call per address (the fetch is idempotent for a given
// address+window, so duplicate calls within the window are wasteful).

const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS_PER_IP = 5;
const ipCalls = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipCalls.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    ipCalls.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > MAX_CALLS_PER_IP;
}

// Periodic cleanup so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipCalls) {
    if (now - entry.windowStart > WINDOW_MS) ipCalls.delete(ip);
  }
}, WINDOW_MS);

// ─── Input validation ───────────────────────────────────────────────────────

const VALID_CHAINS: WalletChain[] = ["solana", "base"];

interface WalletScoreRequest {
  address: string;
  chain: WalletChain;
  resolvedName?: string | null;
  timeHorizonDays?: number;
  minTradeValue?: number;
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  let body: WalletScoreRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { address, chain } = body;

  if (!address || typeof address !== "string") {
    return NextResponse.json(
      { error: "Missing required field: address" },
      { status: 400 },
    );
  }
  if (!chain || !VALID_CHAINS.includes(chain)) {
    return NextResponse.json(
      { error: `Invalid chain. Must be one of: ${VALID_CHAINS.join(", ")}` },
      { status: 400 },
    );
  }

  // Rate limit.
  const ip = getClientIp(request);
  if (rateLimited(ip)) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        detail: `Max ${MAX_CALLS_PER_IP} calls per ${WINDOW_MS / 60000} min per IP. The CROO/MCP paywall is the production gate; this limiter protects the free path.`,
      },
      { status: 429 },
    );
  }

  try {
    const result = await scoreWallet({
      address,
      chain,
      resolvedName: body.resolvedName ?? null,
      timeHorizonDays: body.timeHorizonDays,
      minTradeValue: body.minTradeValue,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("wallet-score error:", error);
    return NextResponse.json(
      {
        error: "Failed to score wallet",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

/** GET — lightweight metadata for discovery (what this endpoint offers). */
export async function GET() {
  return NextResponse.json({
    service: "wallet-score",
    schema: "wallet-score/v1",
    description:
      "Behavioral conviction scoring for any wallet. Send { address, chain } to POST.",
    schemaUrl: "https://earlynotwrong.vercel.app/schemas/wallet-score-v1.schema.json",
    pricing: "$0.05 USDC via CROO CAP or MCP x402 (free tier rate-limited)",
  });
}
