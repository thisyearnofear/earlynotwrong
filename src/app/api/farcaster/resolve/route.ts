import { NextRequest, NextResponse } from "next/server";

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_BASE_URL = "https://api.neynar.com/v2";

export async function POST(request: NextRequest) {
    if (!NEYNAR_API_KEY) {
        return NextResponse.json(
            { error: "Neynar API key not configured" },
            { status: 500 }
        );
    }

    try {
        const { address } = await request.json();

        if (!address) {
            return NextResponse.json(
                { error: "Address is required" },
                { status: 400 }
            );
        }

        // Use Neynar's bulk-by-address endpoint
        const response = await fetch(
            `${NEYNAR_BASE_URL}/farcaster/user/bulk-by-address?addresses=${address}`,
            {
                headers: {
                    'x-api-key': NEYNAR_API_KEY,
                },
            }
        );

        if (!response.ok) {
            console.warn(`Neynar API error: ${response.status}`);
            return NextResponse.json({ identity: null });
        }

        const data = await response.json();
        const users = data[address];

        if (!users || users.length === 0) {
            return NextResponse.json({ identity: null });
        }

        // Take the first user (primary identity)
        const user = users[0];

        const identity = {
            fid: user.fid,
            username: user.username,
            displayName: user.display_name,
            pfpUrl: user.pfp_url,
            bio: user.profile?.bio?.text,
            followerCount: user.follower_count,
            followingCount: user.following_count,
            verifiedAddresses: {
                ethAddresses: user.verified_addresses?.eth_addresses || [],
                solAddresses: user.verified_addresses?.sol_addresses || [],
            },
        };

        return NextResponse.json({ identity });
    } catch (error) {
        console.error("Farcaster resolution error:", error);
        return NextResponse.json({ identity: null });
    }
}