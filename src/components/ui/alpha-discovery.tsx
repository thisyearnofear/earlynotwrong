"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { useAppStore } from "@/lib/store";
import { ConvictionBadge } from "@/components/ui/conviction-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Archetype } from "@/components/ui/conviction-badge";
import {
  TrendingUp,
  Users,
  Filter,
  Zap,
  Crown,
  Target,
} from "lucide-react";
import { WatchlistButton } from "@/components/ui/watchlist-button";
import { useConviction } from "@/hooks/use-conviction";
import { SkeletonRow } from "@/components/ui/skeleton";

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
  nominator?: {
    address: string;
    ethos: number;
  };
  endorsements?: number;
  scout?: {
    address: string;
    ethos: number;
  };
}

interface AlphaDiscoveryProps {
  className?: string;
  onDataLoaded?: (hasData: boolean) => void;
}

export function AlphaDiscovery({
  className,
  onDataLoaded,
}: AlphaDiscoveryProps) {
  const [wallets, setWallets] = useState<AlphaWallet[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    minEthosScore: 1000,
    minConvictionScore: 80,
    chain: null as "solana" | "base" | null,
  });

  const [viewMode, setViewMode] = useState<"discovery" | "community">("discovery");
  const { analyzeWallet } = useConviction();

  const fetchAlphaWallets = React.useCallback(async () => {
    setLoading(true);
    try {
      let data;

      if (viewMode === "discovery") {
        const { targetAddress, isShowcaseMode } = useAppStore.getState();
        const params = new URLSearchParams({
          minEthosScore: filters.minEthosScore.toString(),
          minConvictionScore: filters.minConvictionScore.toString(),
          limit: "10",
          requester: isShowcaseMode ? "DEMO" : (targetAddress || ""),
        });

        if (filters.chain) {
          params.append("chain", filters.chain);
        }

        const response = await fetch(`/api/alpha/discover?${params}`);
        data = await response.json();

        if (data.success) {
          setWallets(data.wallets);
          onDataLoaded?.(data.wallets.length > 0);
        }
      } else {
        // Community Watchlist Mode
        const params = new URLSearchParams({
          status: "approved",
        });
        if (filters.chain) params.append("chain", filters.chain);

        const response = await fetch(`/api/community/watchlist?${params}`);
        const result = await response.json();

        if (result.traders) {
          // Map community traders to AlphaWallet shape
          const mapped = result.traders.map((t: any) => ({
            address: t.wallets[0], // Use primary wallet
            chain: t.chain,
            convictionScore: t.avg_conviction_score || 0,
            ethosScore: t.added_by_ethos || 0, // Use nominator's score as proxy for credibility? Or fetch?
            totalPositions: t.total_analyses || 0,
            patienceTax: 0,
            upsideCapture: 0,
            archetype: "Community Pick",
            alphaRating: "High", // Default for community curated
            lastAnalyzed: Date.now(),
            farcasterIdentity: t.farcaster ? { username: t.farcaster, displayName: t.name } : undefined,
            nominator: t.added_by ? { address: t.added_by, ethos: t.added_by_ethos } : undefined,
            endorsements: t.endorsement_count || 0
          }));
          setWallets(mapped);
          onDataLoaded?.(mapped.length > 0);
        }
      }
    } catch (error) {
      console.error("Failed to fetch wallets:", error);
      onDataLoaded?.(false);
    } finally {
      setLoading(false);
    }
  }, [
    viewMode,
    filters.minEthosScore,
    filters.minConvictionScore,
    filters.chain,
    onDataLoaded,
  ]);

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
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Alpha Discovery
            </div>
            <div className="flex items-center bg-surface/50 rounded-lg p-0.5 border border-border/50">
              <button
                onClick={() => setViewMode("discovery")}
                className={cn(
                  "px-2 py-0.5 text-[10px] rounded-md transition-all font-mono",
                  viewMode === "discovery"
                    ? "bg-signal/20 text-signal shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                )}
              >
                ALGO
              </button>
              <button
                onClick={() => setViewMode("community")}
                className={cn(
                  "px-2 py-0.5 text-[10px] rounded-md transition-all font-mono",
                  viewMode === "community"
                    ? "bg-patience/20 text-patience shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                )}
              >
                CURATED
              </button>
            </div>
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
          feature="alphaDiscovery"
          className="min-h-75"
        >
          <div className="space-y-3">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonRow key={i} className="rounded-lg border border-border/30" />
                ))}
              </div>
            ) : wallets.length === 0 ? (
              <div className="text-center py-12 px-6 bg-surface/20 rounded-xl border border-dashed border-border/30 relative overflow-hidden group">
                <div className="absolute inset-0 bg-signal/5 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="mx-auto bg-surface/40 rounded-2xl p-4 w-16 h-16 flex items-center justify-center mb-4 border border-border/50 shadow-inner">
                  <Target className="w-8 h-8 text-foreground-muted/50" />
                </div>
                <div className="space-y-2 relative z-10">
                  <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-foreground">
                    No Alpha Detected
                  </h3>
                  <p className="text-xs text-foreground-muted leading-relaxed max-w-[240px] mx-auto">
                    Alpha signals appear here when high-trust traders are analyzed. Start a deep scan to populate this feed.
                  </p>
                </div>
              </div>
            ) : (
              wallets.map((wallet) => (
                <div
                  key={`${wallet.address}_${wallet.chain}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border/50 hover:bg-surface/50 transition-colors group cursor-pointer"
                  onClick={() => analyzeWallet(wallet.address)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {wallet.farcasterIdentity?.pfpUrl && (
                      <img
                        src={wallet.farcasterIdentity.pfpUrl}
                        alt={wallet.farcasterIdentity.username}
                        className="w-8 h-8 rounded-full"
                        loading="lazy"
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
                        <span>CI: {wallet.convictionScore ?? "---"}</span>
                        <span>Ethos: {wallet.ethosScore}</span>
                        <span>{wallet.lastAnalyzed ? formatTimeAgo(wallet.lastAnalyzed) : "Pending Scan"}</span>
                      </div>

                      {(wallet.scout || wallet.nominator) && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex items-center gap-1.5 text-[10px] text-foreground-muted bg-surface/50 w-fit px-1.5 py-0.5 rounded border border-border/30">
                            <Users className="w-3 h-3 text-signal" />
                            <span>{wallet.scout ? "Scouted by" : "Nominated by"}</span>
                            <span className="font-mono text-foreground">{formatAddress(wallet.scout?.address || wallet.nominator!.address)}</span>
                            <span className="text-signal">({wallet.scout?.ethos || wallet.nominator!.ethos})</span>
                          </div>
                          {wallet.endorsements !== undefined && wallet.endorsements > 0 && (
                            <div className="flex items-center gap-1 text-[10px] text-patience bg-patience/10 px-1.5 py-0.5 rounded border border-patience/20">
                              <Zap className="w-3 h-3" />
                              <span>{wallet.endorsements} Endorsements</span>
                            </div>
                          )}
                        </div>
                      )}
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

                    <div onClick={(e) => e.stopPropagation()}>
                      <WatchlistButton
                        wallet={{
                          address: wallet.address,
                          chain: wallet.chain,
                          convictionScore: wallet.convictionScore,
                          ethosScore: wallet.ethosScore,
                          archetype: wallet.archetype,
                          farcasterUsername: wallet.farcasterIdentity?.username,
                          displayName: wallet.farcasterIdentity?.displayName
                        }}
                        variant="icon"
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {wallets.length > 0 && (
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
          )}
        </EthosGatedContent>
      </CardContent>
    </Card>
  );
}
