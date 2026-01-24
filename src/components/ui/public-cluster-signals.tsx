"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Users, Loader2, Bell, ArrowRight } from "lucide-react";
import Link from "next/link";

interface ClusterSignal {
  id: string;
  chain: "solana" | "base";
  tokenSymbol?: string;
  tokenAddress: string;
  clusterSize: number;
  avgTrustScore: number;
  createdAtMs: number;
}

interface PublicClusterSignalsProps {
  className?: string;
  limit?: number;
}

export function PublicClusterSignals({
  className,
  limit = 3,
}: PublicClusterSignalsProps) {
  const [clusters, setClusters] = useState<ClusterSignal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchClusters() {
      try {
        const response = await fetch(`/api/alerts?kind=cluster&limit=${limit}`);
        const data = await response.json();
        if (data.success && data.clusters) {
          setClusters(data.clusters);
        }
      } catch (err) {
        console.error("Failed to fetch clusters:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchClusters();
  }, [limit]);

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

  if (loading) {
    return (
      <Card className={cn("glass-panel border-border/50 bg-surface/30", className)}>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
        </CardContent>
      </Card>
    );
  }

  if (clusters.length === 0) {
    return null; // Don't show anything if no clusters
  }

  return (
    <Card className={cn("glass-panel border-signal/20 bg-surface/30", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono text-signal uppercase tracking-wider flex items-center gap-2">
          <Bell className="w-3.5 h-3.5" />
          Recent Cluster Signals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {clusters.map((cluster) => (
          <div
            key={cluster.id}
            className="flex items-center justify-between p-2 rounded bg-signal/5 border border-signal/10"
          >
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-signal" />
              <span className="text-xs font-mono text-foreground">
                {cluster.clusterSize} traders →{" "}
                <span className="text-signal">
                  {cluster.tokenSymbol || formatAddress(cluster.tokenAddress)}
                </span>
              </span>
              <span
                className={cn(
                  "text-[9px] px-1 py-0.5 rounded font-mono",
                  cluster.chain === "solana"
                    ? "bg-purple-500/20 text-purple-300"
                    : "bg-blue-500/20 text-blue-300"
                )}
              >
                {cluster.chain.toUpperCase()}
              </span>
            </div>
            <span className="text-[10px] text-foreground-muted">
              {formatTimeAgo(cluster.createdAtMs)}
            </span>
          </div>
        ))}
        <Link
          href="/features#cluster-alerts"
          className="flex items-center justify-center gap-1 text-[10px] font-mono text-signal hover:underline pt-2"
        >
          Learn about Cluster Alerts <ArrowRight className="w-3 h-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
