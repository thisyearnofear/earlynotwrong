"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Trophy, Medal, Award, TrendingUp, Users, Zap, Search, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConvictionBadge } from "@/components/ui/conviction-badge";
import { useAppStore } from "@/lib/store";
import { useConviction } from "@/hooks/use-conviction";
import { WatchlistButton } from "@/components/ui/watchlist-button";

interface LeaderboardEntry {
    rank: number;
    address: string;
    addressShort: string;
    chain: "solana" | "base";
    convictionScore: number;
    patienceTax: number;
    winRate: number;
    archetype: string;
    totalPositions: number;
    displayName?: string;
    farcaster?: string;
    ens?: string;
    ethosScore?: number;
    unifiedTrustScore?: number;
    unifiedTrustTier?: string;
    rankChange?: number | null;
    lastUpdated: string;
}

export function LeaderboardPanel({ className }: { className?: string }) {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const { analyzeWallet } = useConviction();

    useEffect(() => {
        async function fetchLeaderboard() {
            setLoading(true);
            try {
                const { targetAddress, isShowcaseMode } = useAppStore.getState();
                const params = new URLSearchParams({
                    limit: "20",
                    requester: isShowcaseMode ? "DEMO" : (targetAddress || "")
                });
                const response = await fetch(`/api/leaderboard?${params.toString()}`);
                const data = await response.json();
                if (data.entries) {
                    setEntries(data.entries);
                }
            } catch (error) {
                console.error("Failed to fetch leaderboard:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchLeaderboard();
    }, []);

    const getRankIcon = (rank: number) => {
        if (rank === 1) return <Trophy className="w-5 h-5 text-patience drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]" />;
        if (rank === 2) return <Medal className="w-5 h-5 text-signal drop-shadow-[0_0_8px_rgba(255,165,0,0.4)]" />;
        if (rank === 3) return <Award className="w-5 h-5 text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.4)]" />;
        return <span className="text-xs font-mono text-foreground-muted w-5 text-center">{rank}</span>;
    };

    return (
        <Card className={cn("glass-panel border-border/50 bg-surface/40 overflow-hidden", className)}>
            <CardHeader className="border-b border-border/30 bg-surface/20">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-patience/10 border border-patience/20">
                            <Trophy className="w-5 h-5 text-patience" />
                        </div>
                        <div>
                            <CardTitle className="text-sm font-mono tracking-wider uppercase">Alpha Leaderboard</CardTitle>
                            <CardDescription className="text-[10px] uppercase tracking-tight">Top conviction traders across Base & Solana</CardDescription>
                        </div>
                    </div>
                    <Badge variant="outline" className="font-mono text-[10px] bg-surface/50">
                        {entries.length} ACTIVE TRADERS
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <EthosGatedContent
                    feature="alphaDiscovery"
                    title="Global Leaderboard Locked"
                    description="High-fidelity rankings of top traders require 'Alpha' tier reputation to verify conviction signals."
                    className="min-h-100 border-0 rounded-none bg-transparent"
                >
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider border-b border-border/30 bg-surface/10">
                                    <th className="px-4 py-3 text-left font-medium">Rank</th>
                                    <th className="px-4 py-3 text-left font-medium">Trader</th>
                                    <th className="px-4 py-3 text-center font-medium">Score</th>
                                    <th className="px-4 py-3 text-center font-medium">Trust</th>
                                    <th className="px-4 py-3 text-left font-medium">Archetype</th>
                                    <th className="px-4 py-3 text-right font-medium">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {loading ? (
                                    Array.from({ length: 10 }).map((_, i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={5} className="px-4 py-4 h-12 bg-surface/5"></td>
                                        </tr>
                                    ))
                                ) : entries.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-16">
                                            <div className="flex flex-col items-center text-center space-y-4">
                                                <div className="mx-auto bg-surface/40 rounded-2xl p-4 w-16 h-16 flex items-center justify-center border border-border/50 shadow-inner">
                                                    <Trophy className="w-8 h-8 text-foreground-muted/50" />
                                                </div>
                                                <div className="space-y-2">
                                                    <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-foreground">
                                                        Leaderboard Empty
                                                    </h3>
                                                    <p className="text-xs text-foreground-muted leading-relaxed max-w-[240px] mx-auto">
                                                        Analyzed wallets with conviction scores appear here. Start by analyzing any wallet to populate the rankings.
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    entries.map((entry) => (
                                        <tr
                                            key={`${entry.chain}:${entry.address}`}
                                            className="group hover:bg-surface/50 transition-colors cursor-pointer"
                                            onClick={() => analyzeWallet(entry.address)}
                                        >
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    {getRankIcon(entry.rank)}
                                                    {entry.rankChange && (
                                                        <span className={cn(
                                                            "text-[8px] font-mono",
                                                            entry.rankChange > 0 ? "text-patience" : "text-impatience"
                                                        )}>
                                                            {entry.rankChange > 0 ? "↑" : "↓"}{Math.abs(entry.rankChange)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-foreground truncate max-w-32">
                                                            {entry.farcaster ? `@${entry.farcaster}` : entry.ens || entry.addressShort}
                                                        </span>
                                                        <span className={cn(
                                                            "text-[9px] px-1 rounded uppercase font-mono",
                                                            entry.chain === "solana" ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"
                                                        )}>
                                                            {entry.chain}
                                                        </span>
                                                    </div>
                                                    {entry.ethosScore && (
                                                        <span className="text-[9px] text-foreground-muted font-mono uppercase">
                                                            Ethos: {entry.ethosScore}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-center">
                                                <div className="inline-flex flex-col items-center">
                                                    <span className="text-lg font-bold text-foreground font-mono">{entry.convictionScore}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-center">
                                                <div className="inline-flex flex-col items-center">
                                                    {entry.unifiedTrustScore ? (
                                                        <div className="flex flex-col items-center">
                                                            <span className="text-sm font-bold font-mono">
                                                                {entry.unifiedTrustScore}
                                                            </span>
                                                            <span className="text-[8px] text-foreground-muted font-mono uppercase">
                                                                {entry.unifiedTrustTier}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] text-foreground-muted font-mono">-</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <ConvictionBadge archetype={entry.archetype as any} size="sm" />
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                                    <WatchlistButton
                                                        wallet={{
                                                            address: entry.address,
                                                            chain: entry.chain,
                                                            convictionScore: entry.convictionScore,
                                                            ethosScore: entry.ethosScore,
                                                            archetype: entry.archetype,
                                                            farcasterUsername: entry.farcaster
                                                        }}
                                                        size="icon"
                                                        variant="icon"
                                                    />
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <ArrowRight className="w-4 h-4 text-foreground-muted" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-4 border-t border-border/30 bg-surface/5">
                        <div className="flex items-center justify-between text-[10px] font-mono text-foreground-muted uppercase">
                            <div className="flex items-center gap-4">
                                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {entries.length} Tracked</span>
                                <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Active Rankings</span>
                            </div>
                            <span>Updated Hourly</span>
                        </div>
                    </div>
                </EthosGatedContent>
            </CardContent>
        </Card>
    );
}
