import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

/**
 * Personal Watchlist API
 * GET /api/user/watchlist?userAddress=...
 * POST /api/user/watchlist { userAddress, watchedAddress, chain, name }
 * DELETE /api/user/watchlist?userAddress=...&watchedAddress=...&chain=...
 */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userAddress = searchParams.get("userAddress");

  if (!userAddress) {
    return NextResponse.json({ error: "userAddress required" }, { status: 400 });
  }

  try {
    // Fetch user's watchlist joined with latest conviction data if available
    // Using LATERAL join to get only the latest analysis for each watched address
    const result = await sql`
      SELECT 
        pw.watched_address as "watchedAddress",
        pw.chain,
        pw.name,
        pw.created_at as "createdAt",
        ca.score as "latestScore",
        ca.archetype as "latestArchetype",
        ca.analyzed_at as "latestAnalyzedAt"
      FROM personal_watchlists pw
      LEFT JOIN LATERAL (
        SELECT score, archetype, analyzed_at
        FROM conviction_analyses
        WHERE address = pw.watched_address AND chain = pw.chain
        ORDER BY analyzed_at DESC
        LIMIT 1
      ) ca ON true
      WHERE pw.user_address = ${userAddress}
      ORDER BY pw.created_at DESC
    `;

    return NextResponse.json({ watchlist: result.rows });
  } catch (error) {
    console.error("Watchlist GET error:", error);
    return NextResponse.json({ error: "Failed to fetch watchlist" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userAddress, watchedAddress, chain, name } = await req.json();

    if (!userAddress || !watchedAddress || !chain) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO personal_watchlists (user_address, watched_address, chain, name)
      VALUES (${userAddress}, ${watchedAddress}, ${chain}, ${name})
      ON CONFLICT (user_address, watched_address, chain) DO UPDATE
      SET name = EXCLUDED.name
      RETURNING *
    `;

    return NextResponse.json({ success: true, item: result.rows[0] });
  } catch (error) {
    console.error("Watchlist POST error:", error);
    return NextResponse.json({ error: "Failed to add to watchlist" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userAddress = searchParams.get("userAddress");
  const watchedAddress = searchParams.get("watchedAddress");
  const chain = searchParams.get("chain");

  if (!userAddress || !watchedAddress || !chain) {
    return NextResponse.json({ error: "Missing required params" }, { status: 400 });
  }

  try {
    await sql`
      DELETE FROM personal_watchlists
      WHERE user_address = ${userAddress} AND watched_address = ${watchedAddress} AND chain = ${chain}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Watchlist DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete from watchlist" }, { status: 500 });
  }
}
