import { NextRequest, NextResponse } from "next/server";

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_BASE_URL = "https://api.neynar.com/v2";
const WEB3_BIO_BASE_URL = "https://api.web3.bio";
const ENSDATA_BASE_URL = "https://ensdata.net";

interface Profile {
  platform: string;
  identity: string;
  displayName: string;
  avatar: string | null;
  description: string | null;
  social: {
    uid?: number | null;
    follower?: number | null;
    following?: number | null;
    [key: string]: unknown;
  };
  verifiedAddresses?: {
    ethAddresses: string[];
    solAddresses: string[];
  };
}

export async function POST(request: NextRequest) {
  try {
    const { address, fid } = await request.json();

    if (!address && !fid) {
      return NextResponse.json(
        { error: "Address or FID is required" },
        { status: 400 },
      );
    }

    let profiles: Profile[] = [];

    // Priority 1: If FID is provided, fetch directly from Neynar
    if (fid && NEYNAR_API_KEY) {
      try {
        const neynarResponse = await fetch(
          `${NEYNAR_BASE_URL}/farcaster/user/bulk?fids=${fid}`,
          {
            headers: {
              "x-api-key": NEYNAR_API_KEY,
              Accept: "application/json",
            },
          },
        );

        if (neynarResponse.ok) {
          const neynarData = await neynarResponse.json();
          if (neynarData.users && neynarData.users.length > 0) {
            const user = neynarData.users[0];
            profiles = [
              {
                platform: "farcaster",
                identity: user.username,
                displayName: user.display_name,
                avatar: user.pfp_url,
                description: user.profile?.bio?.text,
                social: {
                  uid: user.fid,
                  follower: user.follower_count,
                  following: user.following_count,
                },
                verifiedAddresses: {
                  ethAddresses: user.verified_addresses.eth_addresses,
                  solAddresses: user.verified_addresses.sol_addresses,
                },
              },
            ];
          }
        }
      } catch (neynarError) {
        console.warn("Neynar FID lookup failed:", neynarError);
      }
    }

    // Priority 2: Try Neynar bulk-by-address (searches custody + verified addresses)
    if (profiles.length === 0 && address && NEYNAR_API_KEY) {
      try {
        const neynarResponse = await fetch(
          `${NEYNAR_BASE_URL}/farcaster/user/bulk-by-address?addresses=${address}`,
          {
            headers: {
              "x-api-key": NEYNAR_API_KEY,
              Accept: "application/json",
            },
          },
        );

        if (neynarResponse.ok) {
          const neynarData = await neynarResponse.json();
          const users = neynarData[address.toLowerCase()];
          if (users && users.length > 0) {
            const user = users[0];
            profiles = [
              {
                platform: "farcaster",
                identity: user.username,
                displayName: user.display_name,
                avatar: user.pfp_url,
                description: user.profile?.bio?.text,
                social: {
                  uid: user.fid,
                  follower: user.follower_count,
                  following: user.following_count,
                },
                verifiedAddresses: {
                  ethAddresses: user.verified_addresses.eth_addresses,
                  solAddresses: user.verified_addresses.sol_addresses,
                },
              },
            ];
          }
        }
      } catch (neynarError) {
        console.warn("Neynar address lookup failed:", neynarError);
      }
    }

    // Priority 3: Fallback to Web3.bio universal resolver
    if (profiles.length === 0 && address) {
      try {
        const web3BioResponse = await fetch(
          `${WEB3_BIO_BASE_URL}/ns/${address}`,
          {
            headers: {
              Accept: "application/json",
            },
          },
        );

        if (web3BioResponse.ok) {
          profiles = await web3BioResponse.json();
        }
      } catch (web3BioError) {
        console.warn("Web3.bio lookup failed:", web3BioError);
      }
    }

    // If no profiles found, try ENS direct lookup as fallback
    if (!profiles || profiles.length === 0) {
      try {
        const ensResponse = await fetch(`${ENSDATA_BASE_URL}/${address}`);
        if (ensResponse.ok) {
          const ensData = await ensResponse.json();
          if (ensData.ens_primary || ensData.ens) {
            // Create a profile from ENS data
            const ensName = ensData.ens_primary || ensData.ens;
            profiles = [
              {
                platform: "ens",
                identity: ensName,
                displayName: ensName,
                avatar: ensData.avatar_url || ensData.avatar || null,
                description: ensData.description || null,
                social: {},
              },
            ];
          }
        }
      } catch (ensError) {
        console.warn("ENS fallback failed:", ensError);
      }
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ identity: null });
    }

    // Prioritize Farcaster profile if available, otherwise use ENS or first profile
    const farcasterProfile = profiles.find((p) => p.platform === "farcaster");
    const ensProfile = profiles.find((p) => p.platform === "ens");
    const basenamesProfile = profiles.find((p) => p.platform === "basenames");
    const primaryProfile =
      farcasterProfile || ensProfile || basenamesProfile || profiles[0];

    // If we have a Farcaster profile, extract FID from social data
    const identity = {
      fid: farcasterProfile?.social?.uid || null,
      username: primaryProfile.identity,
      displayName: primaryProfile.displayName,
      pfpUrl: primaryProfile.avatar,
      bio: primaryProfile.description,
      followerCount: primaryProfile.social?.follower || null,
      followingCount: primaryProfile.social?.following || null,
      platform: primaryProfile.platform,
      // Include all available profiles for richer context
      allProfiles: profiles.map((p) => ({
        platform: p.platform,
        identity: p.identity,
        displayName: p.displayName,
        avatar: p.avatar,
        description: p.description,
      })),
      verifiedAddresses: farcasterProfile?.verifiedAddresses,
    };

    return NextResponse.json({ identity });
  } catch (error) {
    console.error("Identity resolution error:", error);
    return NextResponse.json({ identity: null });
  }
}
