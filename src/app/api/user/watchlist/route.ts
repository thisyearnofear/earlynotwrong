import { NextRequest, NextResponse } from "next/server";
import { 
  getPersonalWatchlist, 
  addToPersonalWatchlist, 
  removeFromPersonalWatchlist 
} from "@/lib/db/postgres";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userAddress = searchParams.get("userAddress");

  if (!userAddress) {
    return NextResponse.json({ error: "Missing userAddress" }, { status: 400 });
  }

  try {
    const watchlist = await getPersonalWatchlist(userAddress);
    return NextResponse.json({ watchlist });
  } catch (error) {
    console.error("Failed to fetch personal watchlist:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userAddress, watchedAddress, chain, name, tags } = body;

    if (!userAddress || !watchedAddress || !chain) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const entry = await addToPersonalWatchlist(userAddress, watchedAddress, chain, name, tags);
    
    if (!entry) {
      return NextResponse.json({ error: "Failed to add entry" }, { status: 500 });
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Failed to add to personal watchlist:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userAddress = searchParams.get("userAddress");
  const watchedAddress = searchParams.get("watchedAddress");
  const chain = searchParams.get("chain");

  if (!userAddress || !watchedAddress || !chain) {
    return NextResponse.json({ error: "Missing required params" }, { status: 400 });
  }

  const success = await removeFromPersonalWatchlist(
    userAddress, 
    watchedAddress, 
    chain as "solana" | "base"
  );

  if (!success) {
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
