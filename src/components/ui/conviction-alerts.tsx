"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  Bell,
  BellRing,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Users,
  RefreshCw,
  ExternalLink,
  Volume2,
  VolumeX,
  Loader2,
} from "lucide-react";

interface ApiAlert {
  id: string;
  timestamp: number;
  type: "entry" | "exit" | "accumulation" | "distribution";
  severity: "low" | "medium" | "high" | "critical";
  trader: {
    id: string;
    name: string;
    walletAddress: string;
    ethosScore: number | null;
    chain: "solana" | "base";
    farcasterIdentity?: {
      username: string;
      displayName?: string;
    };
  };
  token: {
    symbol: string;
    address: string;
    chain: "solana" | "base";
  };
  action: {
    type: string;
    amount: number;
    valueUsd: number;
  };
  txHash: string;
}

interface ConvictionAlertsProps {
  className?: string;
}

export function ConvictionAlerts({ className }: ConvictionAlertsProps) {
  const { ethosScore } = useAppStore();
  const [alerts, setAlerts] = useState<ApiAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filter, setFilter] = useState<"all" | "high" | "critical">("all");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/alerts?hours=24&minValue=100&limit=20");
      if (!response.ok) {
        throw new Error(`Failed to fetch alerts: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setAlerts(data.alerts);
        setLastRefresh(new Date());
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const filteredAlerts = alerts.filter((alert) => {
    if (filter === "all") return true;
    return (
      alert.severity === filter ||
      (filter === "high" && alert.severity === "critical")
    );
  });

  const formatTimeAgo = (timestamp: number) => {
    const minutes = Math.floor((Date.now() - timestamp) / (1000 * 60));
    if (minutes < 1) return "Just now";
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
    return `$${value.toFixed(0)}`;
  };

  const getAlertIcon = (type: string, severity: string) => {
    const iconClass =
      severity === "critical"
        ? "text-impatience"
        : severity === "high"
          ? "text-signal"
          : "text-foreground";

    switch (type) {
      case "entry":
      case "accumulation":
        return <ArrowUpRight className={cn("w-4 h-4", iconClass)} />;
      case "exit":
      case "distribution":
        return <ArrowDownRight className={cn("w-4 h-4", iconClass)} />;
      default:
        return <TrendingUp className={cn("w-4 h-4", iconClass)} />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "border-l-impatience bg-impatience/5";
      case "high":
        return "border-l-signal bg-signal/5";
      case "medium":
        return "border-l-foreground bg-foreground/5";
      default:
        return "border-l-border bg-border/5";
    }
  };

  const getBasescanUrl = (txHash: string) =>
    `https://basescan.org/tx/${txHash}`;

  return (
    <Card
      className={cn("glass-panel border-border/50 bg-surface/40", className)}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
            <BellRing className="w-4 h-4" />
            Conviction Alerts
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchAlerts}
              disabled={loading}
              className="text-xs"
              title="Refresh alerts"
            >
              <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="text-xs"
            >
              {soundEnabled ? (
                <Volume2 className="w-3 h-3" />
              ) : (
                <VolumeX className="w-3 h-3" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setFilter(
                  filter === "all"
                    ? "high"
                    : filter === "high"
                      ? "critical"
                      : "all"
                )
              }
              className="text-xs font-mono"
            >
              {filter === "all" ? "All" : filter === "high" ? "High+" : "Critical"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <EthosGatedContent
          minScore={1000}
          title="Real-Time Conviction Alerts"
          description="Get instant notifications when tracked traders make significant moves."
          className="min-h-[400px]"
        >
          {error ? (
            <div className="text-center py-8 text-foreground-muted">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm text-impatience">{error}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchAlerts}
                className="mt-2"
              >
                Try Again
              </Button>
            </div>
          ) : loading && alerts.length === 0 ? (
            <div className="text-center py-8 text-foreground-muted">
              <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" />
              <div className="text-sm">Scanning watchlist wallets...</div>
              <div className="text-xs mt-1">
                Fetching recent transactions from Base
              </div>
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="text-center py-8 text-foreground-muted">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm">No alerts in the last 24 hours</div>
              <div className="text-xs mt-1">
                {filter !== "all"
                  ? "Try adjusting the filter to see more alerts"
                  : "Watchlist traders haven't made significant moves"}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAlerts.map((alert) => (
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
                            {alert.trader.farcasterIdentity?.displayName ||
                              alert.trader.name ||
                              formatAddress(alert.trader.walletAddress)}
                          </span>
                          {alert.trader.farcasterIdentity && (
                            <span className="text-xs text-foreground-muted">
                              @{alert.trader.farcasterIdentity.username}
                            </span>
                          )}
                          <span
                            className={cn(
                              "text-xs px-1.5 py-0.5 rounded font-mono",
                              alert.token.chain === "solana"
                                ? "bg-purple-500/20 text-purple-300"
                                : "bg-blue-500/20 text-blue-300"
                            )}
                          >
                            {alert.token.chain.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-xs text-foreground-muted">
                          {alert.trader.ethosScore
                            ? `Ethos: ${alert.trader.ethosScore}`
                            : formatAddress(alert.trader.walletAddress)}
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
                        <span>
                          Amount: {alert.action.amount.toLocaleString()}
                        </span>
                      </div>
                      <a
                        href={getBasescanUrl(alert.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-signal hover:underline"
                      >
                        <span>View tx</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="flex items-center justify-between text-xs text-foreground-muted">
              <span>
                {lastRefresh
                  ? `Updated ${formatTimeAgo(lastRefresh.getTime())}`
                  : "Loading..."}
                {" • "}
                {filteredAlerts.length} alerts
              </span>
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
