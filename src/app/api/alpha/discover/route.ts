import { NextRequest, NextResponse } from "next/server";
import { APP_CONFIG } from "@/lib/config";

interface AlphaWallet {
    address: string;
    chain: 'solana' | 'base';
    convictionScore: number;
    ethosScore: number;
    totalPositions: number;
    patienceTax: number;
    upsideCapture: number;
    archetype: string;
    alphaRating: 'Unknown' | 'Low' | 'Medium' | 'High' | 'Elite';
    lastAnalyzed: number;
    farcasterIdentity?: {
        username: string;
        displayName?: string;
        pfpUrl?: string;
    };
}

// Mock high-conviction wallets for demo (in production, this would query a database)
const MOCK_ALPHA_WALLETS: AlphaWallet[] = [
    {
        address: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
        chain: "solana",
        convictionScore: 94.2,
        ethosScore: 2150,
        totalPositions: 12,
        patienceTax: 850,
        upsideCapture: 87,
        archetype: "Iron Pillar",
        alphaRating: "Elite",
        lastAnalyzed: Date.now() - 1000 * 60 * 30, // 30 min ago
        farcasterIdentity: {
            username: "toly",
            displayName: "Anatoly Yakovenko",
            pfpUrl: "https://i.imgur.com/placeholder.jpg"
        }
    },
    {
        address: "0xFB70BDE99b4933A576Ea4e38645Ee1E88B1D6b19",
        chain: "base",
        convictionScore: 89.7,
        ethosScore: 1850,
        totalPositions: 8,
        patienceTax: 1200,
        upsideCapture: 82,
        archetype: "Iron Pillar",
        alphaRating: "Elite",
        lastAnalyzed: Date.now() - 1000 * 60 * 45, // 45 min ago
    },
    {
        address: "6qemckK3fajDuKhVNyvRxNd9a3ubFXxMWkHSEgMVxxov",
        chain: "solana",
        convictionScore: 85.3,
        ethosScore: 1420,
        totalPositions: 15,
        patienceTax: 2100,
        upsideCapture: 78,
        archetype: "Profit Phantom",
        alphaRating: "High",
        lastAnalyzed: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
        farcasterIdentity: {
            username: "zinger",
            displayName: "Zinger",
            pfpUrl: "https://i.imgur.com/placeholder2.jpg"
        }
    },
    {
        address: "0xc4Fdf12dC03424bEb5c117B4B19726401a9dD1AB",
        chain: "base",
        convictionScore: 82.1,
        ethosScore: 1180,
        totalPositions: 6,
        patienceTax: 950,
        upsideCapture: 85,
        archetype: "Diamond Hand",
        alphaRating: "High",
        lastAnalyzed: Date.now() - 1000 * 60 * 60 * 3, // 3 hours ago
    }
];

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const minEthosScore = parseInt(searchParams.get('minEthosScore') || '0');
        const minConvictionScore = parseInt(searchParams.get('minConvictionScore') || '0');
        const chain = searchParams.get('chain') as 'solana' | 'base' | null;
        const limit = parseInt(searchParams.get('limit') || '20');

        // Filter and sort wallets
        let filteredWallets = MOCK_ALPHA_WALLETS.filter(wallet => {
            if (wallet.ethosScore < minEthosScore) return false;
            if (wallet.convictionScore < minConvictionScore) return false;
            if (chain && wallet.chain !== chain) return false;
            return true;
        });

        // Sort by weighted alpha score (conviction * reputation multiplier)
        filteredWallets.sort((a, b) => {
            const getMultiplier = (ethosScore: number) => {
                const { reputation } = APP_CONFIG;
                if (ethosScore >= reputation.ethosScoreThresholds.elite) return 1.5;
                if (ethosScore >= reputation.ethosScoreThresholds.high) return 1.3;
                if (ethosScore >= reputation.ethosScoreThresholds.medium) return 1.15;
                if (ethosScore >= reputation.ethosScoreThresholds.low) return 1.05;
                return 1.0;
            };

            const aWeighted = a.convictionScore * getMultiplier(a.ethosScore);
            const bWeighted = b.convictionScore * getMultiplier(b.ethosScore);

            return bWeighted - aWeighted;
        });

        // Limit results
        const results = filteredWallets.slice(0, limit);

        return NextResponse.json({
            success: true,
            wallets: results,
            total: results.length,
            filters: {
                minEthosScore,
                minConvictionScore,
                chain,
                limit
            }
        });

    } catch (error) {
        console.error("Alpha discovery error:", error);
        return NextResponse.json(
            { error: "Failed to discover alpha wallets", details: String(error) },
            { status: 500 }
        );
    }
}