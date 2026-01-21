"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { ethosClient } from "@/lib/ethos";
import { cn } from "@/lib/utils";
import {
    Crown,
    Zap,
    Users,
    Shield,
    Clock,
    Download,
    Bell,
    TrendingUp,
    Settings,
    ExternalLink,
    ChevronRight,
    Star
} from "lucide-react";

interface ReputationPerksProps {
    className?: string;
}

export function ReputationPerks({ className }: ReputationPerksProps) {
    const { ethosScore } = useAppStore();
    const reputationPerks = ethosClient.getReputationPerks(ethosScore?.score || null);

    const getTierIcon = (tier: string) => {
        switch (tier) {
            case 'elite': return <Crown className="w-5 h-5 text-patience" />;
            case 'alpha': return <Zap className="w-5 h-5 text-signal" />;
            case 'whale': return <Users className="w-5 h-5 text-foreground" />;
            case 'premium': return <Shield className="w-5 h-5 text-foreground-muted" />;
            default: return <Shield className="w-5 h-5 text-border" />;
        }
    };

    const getTierColor = (tier: string) => {
        switch (tier) {
            case 'elite': return "text-patience border-patience/30 bg-patience/5";
            case 'alpha': return "text-signal border-signal/30 bg-signal/5";
            case 'whale': return "text-foreground border-foreground/30 bg-foreground/5";
            case 'premium': return "text-foreground-muted border-foreground-muted/30 bg-foreground-muted/5";
            default: return "text-border border-border/30 bg-border/5";
        }
    };

    const formatRefreshRate = (ms: number) => {
        const seconds = ms / 1000;
        if (seconds >= 60) return `${seconds / 60}m`;
        return `${seconds}s`;
    };

    const formatHistoryDepth = (days: number) => {
        if (days >= 365) return `${Math.floor(days / 365)}y`;
        if (days >= 30) return `${Math.floor(days / 30)}mo`;
        return `${days}d`;
    };

    return (
        <Card className={cn("glass-panel border-border/50 bg-surface/40", className)}>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
                        <Star className="w-4 h-4" />
                        Reputation Perks
                    </CardTitle>
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono",
                        getTierColor(reputationPerks.tier)
                    )}>
                        {getTierIcon(reputationPerks.tier)}
                        <span className="uppercase font-bold">{reputationPerks.tier}</span>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-6">
                {/* Current Perks */}
                <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Settings className="w-4 h-4" />
                        Active Perks
                    </h4>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex items-center gap-2 p-2 rounded bg-surface/30 border border-border/50">
                            <Clock className="w-4 h-4 text-signal" />
                            <div className="text-xs">
                                <div className="font-mono text-foreground">
                                    {formatRefreshRate(reputationPerks.perks.refreshRate)}
                                </div>
                                <div className="text-foreground-muted">Refresh Rate</div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 p-2 rounded bg-surface/30 border border-border/50">
                            <TrendingUp className="w-4 h-4 text-patience" />
                            <div className="text-xs">
                                <div className="font-mono text-foreground">
                                    {formatHistoryDepth(reputationPerks.perks.historyDepth)}
                                </div>
                                <div className="text-foreground-muted">History Depth</div>
                            </div>
                        </div>

                        {reputationPerks.perks.exportData && (
                            <div className="flex items-center gap-2 p-2 rounded bg-surface/30 border border-border/50">
                                <Download className="w-4 h-4 text-foreground" />
                                <div className="text-xs">
                                    <div className="font-mono text-foreground">Enabled</div>
                                    <div className="text-foreground-muted">Data Export</div>
                                </div>
                            </div>
                        )}

                        {reputationPerks.perks.realTimeAlerts && (
                            <div className="flex items-center gap-2 p-2 rounded bg-surface/30 border border-border/50">
                                <Bell className="w-4 h-4 text-signal" />
                                <div className="text-xs">
                                    <div className="font-mono text-foreground">Live</div>
                                    <div className="text-foreground-muted">Alerts</div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Advanced Perks */}
                    {(reputationPerks.perks.cohortComparison ||
                        reputationPerks.perks.whaleTracking ||
                        reputationPerks.perks.apiAccess) && (
                            <div className="space-y-2">
                                <div className="text-xs text-foreground-muted uppercase tracking-wider">Advanced Features</div>
                                <div className="flex flex-wrap gap-2">
                                    {reputationPerks.perks.cohortComparison && (
                                        <span className="px-2 py-1 text-xs bg-foreground/10 text-foreground rounded font-mono">
                                            Cohort Analysis
                                        </span>
                                    )}
                                    {reputationPerks.perks.advancedFilters && (
                                        <span className="px-2 py-1 text-xs bg-foreground/10 text-foreground rounded font-mono">
                                            Advanced Filters
                                        </span>
                                    )}
                                    {reputationPerks.perks.whaleTracking && (
                                        <span className="px-2 py-1 text-xs bg-signal/10 text-signal rounded font-mono">
                                            Whale Tracking
                                        </span>
                                    )}
                                    {reputationPerks.perks.prioritySupport && (
                                        <span className="px-2 py-1 text-xs bg-patience/10 text-patience rounded font-mono">
                                            Priority Support
                                        </span>
                                    )}
                                    {reputationPerks.perks.earlyAccess && (
                                        <span className="px-2 py-1 text-xs bg-patience/10 text-patience rounded font-mono">
                                            Early Access
                                        </span>
                                    )}
                                    {reputationPerks.perks.apiAccess && (
                                        <span className="px-2 py-1 text-xs bg-patience/10 text-patience rounded font-mono">
                                            API Access
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                </div>

                {/* Next Tier Upgrade */}
                {reputationPerks.nextTier && (
                    <div className="space-y-3 pt-4 border-t border-border/50">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-foreground">
                                Unlock {reputationPerks.nextTier.name}
                            </h4>
                            <div className="text-xs font-mono text-foreground-muted">
                                {ethosScore?.score || 0} / {reputationPerks.nextTier.requiredScore}
                            </div>
                        </div>

                        <div className="w-full bg-surface rounded-full h-2">
                            <div
                                className="bg-gradient-to-r from-signal to-patience h-2 rounded-full transition-all duration-500"
                                style={{
                                    width: `${Math.min(100, ((ethosScore?.score || 0) / reputationPerks.nextTier.requiredScore) * 100)}%`
                                }}
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="text-xs text-foreground-muted uppercase tracking-wider">
                                New Perks at {reputationPerks.nextTier.requiredScore} Ethos
                            </div>
                            <div className="space-y-1">
                                {reputationPerks.nextTier.newPerks.map((perk, index) => (
                                    <div key={index} className="flex items-center gap-2 text-xs text-foreground-muted">
                                        <ChevronRight className="w-3 h-3" />
                                        <span>{perk}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-3"
                            onClick={() => window.open("https://ethos.network", "_blank")}
                        >
                            <ExternalLink className="w-3 h-3 mr-2" />
                            Build Reputation on Ethos
                        </Button>
                    </div>
                )}

                {/* Elite Status */}
                {reputationPerks.tier === 'elite' && (
                    <div className="p-4 rounded-lg bg-patience/5 border border-patience/20">
                        <div className="flex items-center gap-2 mb-2">
                            <Crown className="w-4 h-4 text-patience" />
                            <span className="text-sm font-semibold text-patience">Elite Status Achieved</span>
                        </div>
                        <p className="text-xs text-foreground-muted">
                            You have unlocked all available perks. Thank you for being a valued member of the reputation-native ecosystem.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}