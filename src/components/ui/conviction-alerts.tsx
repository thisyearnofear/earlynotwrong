"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
    Bell,
    BellRing,
    TrendingUp,
    TrendingDown,
    ArrowUpRight,
    ArrowDownRight,
    Clock,
    Users,
    Zap,
    Settings,
    Volume2,
    VolumeX
} from "lucide-react";

interface ConvictionAlert {
    id: string;
    timestamp: number;
    type: 'entry' | 'exit' | 'hold' | 'whale_move';
    severity: 'low' | 'medium' | 'high' | 'critical';
    wallet: {
        address: string;
        ethosScore: number;
        convictionScore: number;
        archetype: string;
        farcasterIdentity?: {
            username: string;
            displayName?: string;
            pfpUrl?: string;
        };
    };
    token: {
        symbol: string;
        name: string;
        chain: 'solana' | 'base';
    };
    action: {
        type: string;
        amount: number;
        valueUsd: number;
        priceImpact?: number;
    };
    conviction: {
        confidence: number;
        reasoning: string;
    };
}

interface ConvictionAlertsProps {
    className?: string;
}

// Mock real-time alerts for demo
const MOCK_ALERTS: ConvictionAlert[] = [
    {
        id: "alert_1",
        timestamp: Date.now() - 1000 * 60 * 2, // 2 min ago
        type: "entry",
        severity: "high",
        wallet: {
            address: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
            ethosScore: 2150,
            convictionScore: 94.2,
            archetype: "Iron Pillar",
            farcasterIdentity: {
                username: "toly",
                displayName: "Anatoly Yakovenko"
            }
        },
        token: {
            symbol: "JUP",
            name: "Jupiter",
            chain: "solana"
        },
        action: {
            type: "Large Buy",
            amount: 50000,
            valueUsd: 45000,
            priceImpact: 0.8
        },
        conviction: {
            confidence: 92,
            reasoning: "Elite trader with 94.2 CI entering significant position"
        }
    },
    {
        id: "alert_2",
        timestamp: Date.now() - 1000 * 60 * 8, // 8 min ago
        type: "hold",
        severity: "medium",
        wallet: {
            address: "6qemckK3fajDuKhVNyvRxNd9a3ubFXxMWkHSEgMVxxov",
            ethosScore: 1420,
            convictionScore: 85.3,
            archetype: "Profit Phantom"
        },
        token: {
            symbol: "SOL",
            name: "Solana",
            chain: "solana"
        },
        action: {
            type: "Conviction Hold",
            amount: 1200,
            valueUsd: 180000
        },
        conviction: {
            confidence: 78,
            reasoning: "Holding through 15% drawdown - typical conviction behavior"
        }
    },
    {
        id: "alert_3",
        timestamp: Date.now() - 1000 * 60 * 15, // 15 min ago
        type: "whale_move",
        severity: "critical",
        wallet: {
            address: "0xFB70BDE99b4933A576Ea4e38645Ee1E88B1D6b19",
            ethosScore: 1850,
            convictionScore: 89.7,
            archetype: "Iron Pillar"
        },
        token: {
            symbol: "WETH",
            name: "Wrapped Ether",
            chain: "base"
        },
        action: {
            type: "Whale Accumulation",
            amount: 45,
            valueUsd: 150000,
            priceImpact: 1.2
        },
        conviction: {
            confidence: 88,
            reasoning: "Consistent accumulation pattern by high-conviction whale"
        }
    }
];

export function ConvictionAlerts({ className }: ConvictionAlertsProps) {
    const { ethosScore } = useAppStore();
    const [alerts, setAlerts] = useState<ConvictionAlert[]>(MOCK_ALERTS);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [filter, setFilter] = useState<'all' | 'high' | 'critical'>('all');

    const filteredAlerts = alerts.filter(alert => {
        if (filter === 'all') return true;
        return alert.severity === filter || (filter === 'high' && alert.severity === 'critical');
    });

    const formatTimeAgo = (timestamp: number) => {
        const minutes = Math.floor((Date.now() - timestamp) / (1000 * 60));
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    };

    const formatAddress = (address: string) =>
        `${address.slice(0, 6)}...${address.slice(-4)}`;

    const formatValue = (value: number) => {
        if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
        return `$${value}`;
    };

    const getAlertIcon = (type: string, severity: string) => {
        const iconClass = severity === 'critical' ? 'text-impatience' :
            severity === 'high' ? 'text-signal' : 'text-foreground';

        switch (type) {
            case 'entry': return <ArrowUpRight className={cn("w-4 h-4", iconClass)} />;
            case 'exit': return <ArrowDownRight className={cn("w-4 h-4", iconClass)} />;
            case 'whale_move': return <Users className={cn("w-4 h-4", iconClass)} />;
            default: return <TrendingUp className={cn("w-4 h-4", iconClass)} />;
        }
    };

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'critical': return 'border-l-impatience bg-impatience/5';
            case 'high': return 'border-l-signal bg-signal/5';
            case 'medium': return 'border-l-foreground bg-foreground/5';
            default: return 'border-l-border bg-border/5';
        }
    };

    return (
        <Card className={cn("glass-panel border-border/50 bg-surface/40", className)}>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
                        <BellRing className="w-4 h-4" />
                        Conviction Alerts
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSoundEnabled(!soundEnabled)}
                            className="text-xs"
                        >
                            {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFilter(filter === 'all' ? 'high' : filter === 'high' ? 'critical' : 'all')}
                            className="text-xs font-mono"
                        >
                            {filter === 'all' ? 'All' : filter === 'high' ? 'High+' : 'Critical'}
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent>
                <EthosGatedContent
                    minScore={1000}
                    title="Real-Time Conviction Alerts"
                    description="Get instant notifications when high-Ethos traders make significant moves."
                    className="min-h-[400px]"
                >
                    <div className="space-y-3">
                        {filteredAlerts.length === 0 ? (
                            <div className="text-center py-8 text-foreground-muted">
                                <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <div className="text-sm">No alerts matching filter</div>
                                <div className="text-xs mt-1">Adjust filter to see more alerts</div>
                            </div>
                        ) : (
                            filteredAlerts.map((alert) => (
                                <div
                                    key={alert.id}
                                    className={cn(
                                        "p-4 rounded-lg border-l-4 bg-surface/30 border border-border/50 hover:bg-surface/50 transition-colors",
                                        getSeverityColor(alert.severity)
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-3">
                                            {getAlertIcon(alert.type, alert.severity)}
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-mono text-sm font-semibold text-foreground">
                                                        {alert.wallet.farcasterIdentity?.displayName || formatAddress(alert.wallet.address)}
                                                    </span>
                                                    {alert.wallet.farcasterIdentity && (
                                                        <span className="text-xs text-foreground-muted">
                                                            @{alert.wallet.farcasterIdentity.username}
                                                        </span>
                                                    )}
                                                    <span className={cn(
                                                        "text-xs px-1.5 py-0.5 rounded font-mono",
                                                        alert.token.chain === 'solana' ? "bg-purple-500/20 text-purple-300" : "bg-blue-500/20 text-blue-300"
                                                    )}>
                                                        {alert.token.chain.toUpperCase()}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-foreground-muted">
                                                    Ethos: {alert.wallet.ethosScore} • CI: {alert.wallet.convictionScore} • {alert.wallet.archetype}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-xs text-foreground-muted flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {formatTimeAgo(alert.timestamp)}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm text-foreground">
                                                    {alert.action.type}
                                                </span>
                                                <span className="text-xs text-foreground-muted">
                                                    {alert.token.symbol}
                                                </span>
                                            </div>
                                            <div className="text-sm font-mono text-foreground">
                                                {formatValue(alert.action.valueUsd)}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-4 text-foreground-muted">
                                                <span>Amount: {alert.action.amount.toLocaleString()}</span>
                                                {alert.action.priceImpact && (
                                                    <span>Impact: {alert.action.priceImpact}%</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Zap className="w-3 h-3 text-signal" />
                                                <span className="text-signal">{alert.conviction.confidence}% confidence</span>
                                            </div>
                                        </div>

                                        <div className="pt-2 border-t border-border/30">
                                            <p className="text-xs text-foreground-muted italic">
                                                {alert.conviction.reasoning}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-border/50">
                        <div className="flex items-center justify-between text-xs text-foreground-muted">
                            <span>Showing {filteredAlerts.length} recent alerts</span>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-impatience" />
                                    <span>Critical</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-signal" />
                                    <span>High</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </EthosGatedContent>
            </CardContent>
        </Card>
    );
}