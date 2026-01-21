"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    Flame,
    TrendingUp,
    Users,
    ExternalLink,
    Filter
} from "lucide-react";

interface TokenConviction {
    tokenAddress: string;
    symbol: string;
    name: string;
    logoUri?: string;
    chain: 'solana' | 'base';
    credibleHolders: number;
    avgConvictionScore: number;
    avgEthosScore: number;
    totalValue: number;
    convictionIntensity: number; // 0-100 score
}

interface TokenHeatmapProps {
    className?: string;
}

// Mock data for demo
const MOCK_TOKEN_DATA: TokenConviction[] = [
    {
        tokenAddress: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Solana",
        chain: "solana",
        credibleHolders: 8,
        avgConvictionScore: 87.2,
        avgEthosScore: 1650,
        totalValue: 2400000,
        convictionIntensity: 94
    },
    {
        tokenAddress: "0x4200000000000000000000000000000000000006",
        symbol: "WETH",
        name: "Wrapped Ether",
        chain: "base",
        credibleHolders: 12,
        avgConvictionScore: 82.1,
        avgEthosScore: 1420,
        totalValue: 1800000,
        convictionIntensity: 89
    },
    {
        tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        symbol: "USDC",
        name: "USD Coin",
        chain: "solana",
        credibleHolders: 15,
        avgConvictionScore: 75.8,
        avgEthosScore: 1280,
        totalValue: 950000,
        convictionIntensity: 78
    },
    {
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        name: "USD Coin",
        chain: "base",
        credibleHolders: 9,
        avgConvictionScore: 71.3,
        avgEthosScore: 1150,
        totalValue: 720000,
        convictionIntensity: 72
    }
];

export function TokenHeatmap({ className }: TokenHeatmapProps) {
    const [tokens, setTokens] = useState<TokenConviction[]>(MOCK_TOKEN_DATA);
    const [sortBy, setSortBy] = useState<'conviction' | 'holders' | 'value'>('conviction');
    const [chainFilter, setChainFilter] = useState<'all' | 'solana' | 'base'>('all');

    const filteredAndSortedTokens = React.useMemo(() => {
        let filtered = tokens;

        if (chainFilter !== 'all') {
            filtered = tokens.filter(token => token.chain === chainFilter);
        }

        return filtered.sort((a, b) => {
            switch (sortBy) {
                case 'conviction':
                    return b.convictionIntensity - a.convictionIntensity;
                case 'holders':
                    return b.credibleHolders - a.credibleHolders;
                case 'value':
                    return b.totalValue - a.totalValue;
                default:
                    return 0;
            }
        });
    }, [tokens, sortBy, chainFilter]);

    const formatValue = (value: number) => {
        if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
        return `$${value}`;
    };

    const getIntensityColor = (intensity: number) => {
        if (intensity >= 90) return "bg-patience text-patience-foreground";
        if (intensity >= 80) return "bg-signal text-signal-foreground";
        if (intensity >= 70) return "bg-foreground text-background";
        return "bg-foreground-muted text-foreground";
    };

    return (
        <Card className={cn("glass-panel border-border/50 bg-surface/40", className)}>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
                        <Flame className="w-4 h-4" />
                        Token Conviction Heatmap
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSortBy(sortBy === 'conviction' ? 'holders' : sortBy === 'holders' ? 'value' : 'conviction')}
                            className="text-xs font-mono"
                        >
                            <TrendingUp className="w-3 h-3 mr-1" />
                            {sortBy === 'conviction' ? 'Conviction' : sortBy === 'holders' ? 'Holders' : 'Value'}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setChainFilter(chainFilter === 'all' ? 'solana' : chainFilter === 'solana' ? 'base' : 'all')}
                            className="text-xs font-mono"
                        >
                            <Filter className="w-3 h-3 mr-1" />
                            {chainFilter === 'all' ? 'All' : chainFilter.toUpperCase()}
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent>
                <EthosGatedContent
                    minScore={500}
                    title="Token Conviction Analysis"
                    description="See which tokens have the highest concentration of credible, high-conviction holders."
                    className="min-h-[250px]"
                >
                    <div className="space-y-2">
                        {filteredAndSortedTokens.map((token) => (
                            <div
                                key={`${token.tokenAddress}_${token.chain}`}
                                className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border/50 hover:bg-surface/50 transition-colors group"
                            >
                                <div className="flex items-center gap-3 flex-1">
                                    <div className="flex items-center gap-2">
                                        <div className={cn(
                                            "w-2 h-2 rounded-full",
                                            token.chain === 'solana' ? "bg-purple-500" : "bg-blue-500"
                                        )} />
                                        <span className="font-mono text-sm font-semibold text-foreground">
                                            {token.symbol}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-4 text-xs text-foreground-muted">
                                        <div className="flex items-center gap-1">
                                            <Users className="w-3 h-3" />
                                            <span>{token.credibleHolders} holders</span>
                                        </div>
                                        <span>Avg CI: {token.avgConvictionScore}</span>
                                        <span>{formatValue(token.totalValue)}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <div className={cn(
                                        "px-2 py-1 rounded text-xs font-mono font-bold",
                                        getIntensityColor(token.convictionIntensity)
                                    )}>
                                        {token.convictionIntensity}
                                    </div>

                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => {
                                            console.log('Analyze token:', token.symbol);
                                        }}
                                    >
                                        <ExternalLink className="w-3 h-3" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 pt-4 border-t border-border/50">
                        <div className="flex items-center justify-between text-xs text-foreground-muted">
                            <span>Showing {filteredAndSortedTokens.length} tokens with credible conviction</span>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-patience" />
                                    <span>90+ Intensity</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-signal" />
                                    <span>80+ Intensity</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </EthosGatedContent>
            </CardContent>
        </Card>
    );
}