"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { ConvictionBadge } from "@/components/ui/conviction-badge";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Archetype } from "@/components/ui/conviction-badge";
import {
  TrendingUp,
  Users,
  Filter,
  ExternalLink,
  Zap,
  Crown,
  Target,
} from "lucide-react";

interface AlphaWallet {
  address: string;
  chain: "solana" | "base";
  convictionScore: number;
  ethosScore: number;
  totalPositions: number;
  patienceTax: number;
  upsideCapture: number;
  archetype: string;
  alphaRating: "Unknown" | "Low" | "Medium" | "High" | "Elite";
  lastAnalyzed: number;
  farcasterIdentity?: {
    username: string;
    displayName?: string;
    pfpUrl?: string;
  };
}

interface AlphaDiscoveryProps {
  className?: string;
}

export function AlphaDiscovery({ className }: AlphaDiscoveryProps) {
  const [wallets, setWallets] = useState<AlphaWallet[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    minEthosScore: 1000,
    minConvictionScore: 80,
    chain: null as "solana" | "base" | null,
  });

  const fetchAlphaWallets = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        minEthosScore: filters.minEthosScore.toString(),
        minConvictionScore: filters.minConvictionScore.toString(),
        limit: "10",
      });

      if (filters.chain) {
        params.append("chain", filters.chain);
      }

      const response = await fetch(`/api/alpha/discover?${params}`);
      const data = await response.json();

      if (data.success) {
        setWallets(data.wallets);
      }
    } catch (error) {
      console.error("Failed to fetch alpha wallets:", error);
    } finally {
      setLoading(false);
    }
  }, [filters.minEthosScore, filters.minConvictionScore, filters.chain]);

  useEffect(() => {
    fetchAlphaWallets();
  }, [fetchAlphaWallets]);

  const formatAddress = (address: string) =>
    `${address.slice(0, 6)}...${address.slice(-4)}`;

  const formatTimeAgo = (timestamp: number) => {
    const minutes = Math.floor((Date.now() - timestamp) / (1000 * 60));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const getRatingIcon = (rating: string) => {
    switch (rating) {
      case "Elite":
        return <Crown className="w-4 h-4 text-patience" />;
      case "High":
        return <Zap className="w-4 h-4 text-signal" />;
      case "Medium":
        return <Target className="w-4 h-4 text-foreground" />;
      default:
        return <Users className="w-4 h-4 text-foreground-muted" />;
    }
  };

  return (
    <Card
      className={cn("glass-panel border-border/50 bg-surface/40", className)}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Alpha Discovery
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  chain:
                    prev.chain === "solana"
                      ? "base"
                      : prev.chain === "base"
                        ? null
                        : "solana",
                }))
              }
              className="text-xs font-mono"
            >
              <Filter className="w-3 h-3 mr-1" />
              {filters.chain || "All"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <EthosGatedContent
          minScore={500}
          title="High-Conviction Tracker"
          description="Monitor moves by Iron Pillar traders with proven conviction and high Ethos credibility."
          className="min-h-75"
        >
          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-sm text-foreground-muted font-mono">
                  SCANNING ALPHA WALLETS...
                </div>
              </div>
            ) : wallets.length === 0 ? (
              <div className="text-center py-8 text-foreground-muted">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">No high-conviction wallets found</div>
                <div className="text-xs mt-1">Try adjusting filters</div>
              </div>
            ) : (
              wallets.map((wallet) => (
                <div
                  key={`${wallet.address}_${wallet.chain}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border/50 hover:bg-surface/50 transition-colors group"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {wallet.farcasterIdentity?.pfpUrl && (
                      <img
                        src={wallet.farcasterIdentity.pfpUrl}
                        alt={wallet.farcasterIdentity.username}
                        className="w-8 h-8 rounded-full"
                      />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm text-foreground">
                          {wallet.farcasterIdentity?.displayName ||
                            formatAddress(wallet.address)}
                        </span>
                        {wallet.farcasterIdentity && (
                          <span className="text-xs text-foreground-muted">
                            @{wallet.farcasterIdentity.username}
                          </span>
                        )}
                        <span
                          className={cn(
                            "text-xs px-1.5 py-0.5 rounded font-mono",
                            wallet.chain === "solana"
                              ? "bg-purple-500/20 text-purple-300"
                              : "bg-blue-500/20 text-blue-300",
                          )}
                        >
                          {wallet.chain.toUpperCase()}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-foreground-muted">
                        <span>CI: {wallet.convictionScore}</span>
                        <span>Ethos: {wallet.ethosScore}</span>
                        <span>{formatTimeAgo(wallet.lastAnalyzed)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {getRatingIcon(wallet.alphaRating)}
                      <span className="text-xs font-mono text-foreground-muted">
                        {wallet.alphaRating}
                      </span>
                    </div>

                    <ConvictionBadge
                      archetype={wallet.archetype as Archetype}
                      size="sm"
                    />

                    <Button
                      variant="ghost"
                      size="sm"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        // In a real app, this would navigate to the wallet analysis
                        console.log("Analyze wallet:", wallet.address);
                      }}
                    >
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="flex items-center justify-between text-xs text-foreground-muted">
              <span>Showing {wallets.length} high-conviction wallets</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchAlphaWallets}
                className="text-xs"
              >
                Refresh
              </Button>
            </div>
          </div>
        </EthosGatedContent>
      </CardContent>
    </Card>
  );
}
