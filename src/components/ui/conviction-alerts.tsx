"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Bell,
  BellRing,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  RefreshCw,
  ExternalLink,
  Volume2,
  VolumeX,
  Loader2,
  Users,
  Settings2,
} from "lucide-react";
import { NotificationSettings } from "@/components/ui/notification-settings";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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

interface ClusterSignal {
  id: string;
  kind: "cluster";
  chain: "solana" | "base";
  tokenAddress: string;
  tokenSymbol?: string;
  windowMinutes: number;
  uniqueTraders: Array<{
    walletAddress: string;
    traderId?: string;
    trustScore?: number;
  }>;
  clusterSize: number;
  avgTrustScore: number;
  createdAtMs: number;
}

interface ConvictionAlertsProps {
  className?: string;
  onDataLoaded?: (hasData: boolean) => void;
}

export function ConvictionAlerts({
  className,
  onDataLoaded,
}: ConvictionAlertsProps) {
  const [alerts, setAlerts] = useState<ApiAlert[]>([]);
  const [clusters, setClusters] = useState<ClusterSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filter, setFilter] = useState<"all" | "high" | "critical">("all");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/alerts?hours=24&minValue=100&limit=20",
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch alerts: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setAlerts(data.alerts || []);
        setClusters(data.clusters || []);
        setLastRefresh(new Date());
        onDataLoaded?.((data.alerts || []).length > 0 || (data.clusters || []).length > 0);
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
      onDataLoaded?.(false);
    } finally {
      setLoading(false);
    }
  }, [onDataLoaded]);

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
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs" title="Alert settings">
                  <Settings2 className="w-3 h-3" />
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-zinc-700">
                <DialogHeader>
                  <DialogTitle className="font-mono text-sm">Cluster Alert Settings</DialogTitle>
                </DialogHeader>
                <NotificationSettings userAddress="DEMO" />
              </DialogContent>
            </Dialog>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setFilter(
                  filter === "all"
                    ? "high"
                    : filter === "high"
                      ? "critical"
                      : "all",
                )
              }
              className="text-xs font-mono"
            >
              {filter === "all"
                ? "All"
                : filter === "high"
                  ? "High+"
                  : "Critical"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <EthosGatedContent
          feature="realTimeAlerts"
          className="min-h-100"
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
          ) : filteredAlerts.length === 0 && clusters.length === 0 ? (
            <div className="text-center py-4 text-foreground-muted bg-surface/20 rounded-lg border border-dashed border-border/30">
              <div className="text-xs font-mono uppercase tracking-tighter opacity-50 mb-1">
                No Alerts Detected
              </div>
              <div className="text-[10px] opacity-40">
                {filter !== "all"
                  ? "Try adjusting the filter to see more alerts"
                  : "Watchlist traders haven't made significant moves"}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Cluster Signals */}
              {clusters.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    Cluster Signals
                  </div>
                  <div className="space-y-2">
                    {clusters.slice(0, 3).map((cluster) => (
                      <div
                        key={cluster.id}
                        className="p-3 rounded-lg border-l-4 border-l-signal bg-signal/10 border border-signal/30"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-signal" />
                            <span className="font-mono text-sm font-semibold text-foreground">
                              {cluster.clusterSize} traders entered {cluster.tokenSymbol || formatAddress(cluster.tokenAddress)}
                            </span>
                            <span
                              className={cn(
                                "text-xs px-1.5 py-0.5 rounded font-mono",
                                cluster.chain === "solana"
                                  ? "bg-purple-500/20 text-purple-300"
                                  : "bg-blue-500/20 text-blue-300"
                              )}
                            >
                              {cluster.chain.toUpperCase()}
                            </span>
                          </div>
                          <span className="text-xs text-foreground-muted">
                            Avg Trust: {cluster.avgTrustScore}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {cluster.uniqueTraders.slice(0, 5).map((t, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-0.5 bg-surface/50 rounded font-mono text-foreground-muted"
                            >
                              {t.traderId || formatAddress(t.walletAddress)}
                              {t.trustScore && <span className="text-signal ml-1">({t.trustScore})</span>}
                            </span>
                          ))}
                          {cluster.uniqueTraders.length > 5 && (
                            <span className="text-xs text-foreground-muted">
                              +{cluster.uniqueTraders.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {filteredAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    "p-4 rounded-lg border-l-4 bg-surface/30 border border-border/50 hover:bg-surface/50 transition-colors",
                    getSeverityColor(alert.severity),
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
                                : "bg-blue-500/20 text-blue-300",
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

          {filteredAlerts.length > 0 && (
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
          )}
        </EthosGatedContent>
      </CardContent>
    </Card>
  );
}
