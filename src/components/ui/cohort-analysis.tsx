"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { ethosClient } from "@/lib/ethos";
import { cn } from "@/lib/utils";
import {
    Users,
    TrendingUp,
    Target,
    BarChart3,
    Filter,
    Crown,
    Zap,
    Shield
} from "lucide-react";

interface CohortData {
    tier: 'premium' | 'whale' | 'alpha' | 'elite';
    userCount: number;
    avgConvictionScore: number;
    avgPatienceTax: number;
    avgUpsideCapture: number;
    avgHoldingPeriod: number;
    topArchetype: string;
    performance: {
        winRate: number;
        avgReturn: number;
        sharpeRatio: number;
    };
}

interface CohortAnalysisProps {
    className?: string;
}

// Mock cohort data for demo
const MOCK_COHORT_DATA: CohortData[] = [
    {
        tier: 'elite',
        userCount: 47,
        avgConvictionScore: 91.2,
        avgPatienceTax: 1200,
        avgUpsideCapture: 89.5,
        avgHoldingPeriod: 145,
        topArchetype: 'Iron Pillar',
        performance: {
            winRate: 78.2,
            avgReturn: 245.8,
            sharpeRatio: 2.1
        }
    },
    {
        tier: 'alpha',
        userCount: 156,
        avgConvictionScore: 84.7,
        avgPatienceTax: 2100,
        avgUpsideCapture: 82.1,
        avgHoldingPeriod: 98,
        topArchetype: 'Diamond Hand',
        performance: {
            winRate: 71.5,
            avgReturn: 189.3,
            sharpeRatio: 1.7
        }
    },
    {
        tier: 'whale',
        userCount: 423,
        avgConvictionScore: 76.3,
        avgPatienceTax: 3400,
        avgUpsideCapture: 74.8,
        avgHoldingPeriod: 67,
        topArchetype: 'Profit Phantom',
        performance: {
            winRate: 64.2,
            avgReturn: 142.7,
            sharpeRatio: 1.3
        }
    },
    {
        tier: 'premium',
        userCount: 1247,
        avgConvictionScore: 68.9,
        avgPatienceTax: 5200,
        avgUpsideCapture: 65.4,
        avgHoldingPeriod: 42,
        topArchetype: 'Exit Voyager',
        performance: {
            winRate: 58.7,
            avgReturn: 98.4,
            sharpeRatio: 0.9
        }
    }
];

export function CohortAnalysis({ className }: CohortAnalysisProps) {
    const { ethosScore, convictionMetrics } = useAppStore();
    const reputationPerks = ethosClient.getReputationPerks(ethosScore?.score || null);
    const userTier = reputationPerks.tier;

    const getTierIcon = (tier: string) => {
        switch (tier) {
            case 'elite': return <Crown className="w-4 h-4 text-patience" />;
            case 'alpha': return <Zap className="w-4 h-4 text-signal" />;
            case 'whale': return <Users className="w-4 h-4 text-foreground" />;
            case 'premium': return <Shield className="w-4 h-4 text-foreground-muted" />;
            default: return <Shield className="w-4 h-4 text-border" />;
        }
    };

    const getTierColor = (tier: string, isUserTier: boolean = false) => {
        const baseColors = {
            elite: "border-patience/30 bg-patience/5",
            alpha: "border-signal/30 bg-signal/5",
            whale: "border-foreground/30 bg-foreground/5",
            premium: "border-foreground-muted/30 bg-foreground-muted/5"
        };

        if (isUserTier) {
            return cn(baseColors[tier as keyof typeof baseColors], "ring-2 ring-signal/50");
        }

        return baseColors[tier as keyof typeof baseColors];
    };

    const getPerformanceColor = (value: number, metric: 'winRate' | 'return' | 'sharpe') => {
        const thresholds = {
            winRate: { good: 70, excellent: 75 },
            return: { good: 150, excellent: 200 },
            sharpe: { good: 1.5, excellent: 2.0 }
        };

        const threshold = thresholds[metric];
        if (value >= threshold.excellent) return "text-patience";
        if (value >= threshold.good) return "text-signal";
        return "text-foreground";
    };

    const getUserPercentile = (userScore: number, cohortAvg: number) => {
        if (userScore > cohortAvg * 1.2) return "Top 10%";
        if (userScore > cohortAvg * 1.1) return "Top 25%";
        if (userScore > cohortAvg * 0.9) return "Average";
        if (userScore > cohortAvg * 0.8) return "Bottom 25%";
        return "Bottom 10%";
    };

    return (
        <Card className={cn("glass-panel border-border/50 bg-surface/40", className)}>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" />
                        Cohort Analysis
                    </CardTitle>
                    <div className="flex items-center gap-2 text-xs text-foreground-muted">
                        <Target className="w-3 h-3" />
                        <span>Your Tier: {userTier}</span>
                    </div>
                </div>
            </CardHeader>

            <CardContent>
                <EthosGatedContent
                    minScore={500}
                    title="Reputation Cohort Comparison"
                    description="Compare your conviction metrics against other traders in your reputation tier."
                    className="min-h-[500px]"
                >
                    <div className="space-y-4">
                        {MOCK_COHORT_DATA.map((cohort) => {
                            const isUserTier = cohort.tier === userTier;

                            return (
                                <div
                                    key={cohort.tier}
                                    className={cn(
                                        "p-4 rounded-lg border transition-all duration-200",
                                        getTierColor(cohort.tier, isUserTier)
                                    )}
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            {getTierIcon(cohort.tier)}
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-foreground capitalize">
                                                        {cohort.tier} Tier
                                                    </span>
                                                    {isUserTier && (
                                                        <span className="px-2 py-0.5 text-xs bg-signal/20 text-signal rounded font-mono">
                                                            YOUR TIER
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-foreground-muted">
                                                    {cohort.userCount} active traders
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-sm font-mono text-foreground">
                                                {cohort.avgConvictionScore} CI
                                            </div>
                                            <div className="text-xs text-foreground-muted">
                                                Avg Score
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                        <div className="text-center">
                                            <div className="text-lg font-mono text-foreground">
                                                {cohort.avgUpsideCapture}%
                                            </div>
                                            <div className="text-xs text-foreground-muted">
                                                Upside Capture
                                            </div>
                                            {isUserTier && convictionMetrics && (
                                                <div className="text-xs text-signal mt-1">
                                                    You: {getUserPercentile(convictionMetrics.upsideCapture, cohort.avgUpsideCapture)}
                                                </div>
                                            )}
                                        </div>

                                        <div className="text-center">
                                            <div className="text-lg font-mono text-foreground">
                                                ${(cohort.avgPatienceTax / 1000).toFixed(1)}K
                                            </div>
                                            <div className="text-xs text-foreground-muted">
                                                Patience Tax
                                            </div>
                                            {isUserTier && convictionMetrics && (
                                                <div className="text-xs text-signal mt-1">
                                                    You: {getUserPercentile(convictionMetrics.patienceTax, cohort.avgPatienceTax)}
                                                </div>
                                            )}
                                        </div>

                                        <div className="text-center">
                                            <div className="text-lg font-mono text-foreground">
                                                {cohort.avgHoldingPeriod}d
                                            </div>
                                            <div className="text-xs text-foreground-muted">
                                                Avg Hold
                                            </div>
                                            {isUserTier && convictionMetrics && (
                                                <div className="text-xs text-signal mt-1">
                                                    You: {getUserPercentile(convictionMetrics.avgHoldingPeriod, cohort.avgHoldingPeriod)}
                                                </div>
                                            )}
                                        </div>

                                        <div className="text-center">
                                            <div className="text-lg font-mono text-foreground">
                                                {cohort.performance.winRate}%
                                            </div>
                                            <div className="text-xs text-foreground-muted">
                                                Win Rate
                                            </div>
                                            {isUserTier && convictionMetrics && (
                                                <div className="text-xs text-signal mt-1">
                                                    You: {getUserPercentile(convictionMetrics.winRate, cohort.performance.winRate)}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-3 border-t border-border/30">
                                        <div className="flex items-center gap-4 text-xs text-foreground-muted">
                                            <span>Top Archetype: {cohort.topArchetype}</span>
                                            <span className={getPerformanceColor(cohort.performance.avgReturn, 'return')}>
                                                Avg Return: {cohort.performance.avgReturn}%
                                            </span>
                                        </div>
                                        <div className="text-xs font-mono">
                                            <span className={getPerformanceColor(cohort.performance.sharpeRatio, 'sharpe')}>
                                                Sharpe: {cohort.performance.sharpeRatio}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-6 pt-4 border-t border-border/50">
                        <div className="text-xs text-foreground-muted space-y-2">
                            <div className="flex items-center justify-between">
                                <span>Data updated every 24 hours</span>
                                <span>Based on last 180 days of activity</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-patience" />
                                    <span>Top 10% Performance</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-signal" />
                                    <span>Above Average</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </EthosGatedContent>
            </CardContent>
        </Card>
    );
}