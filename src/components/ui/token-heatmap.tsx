"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Flame,
  TrendingUp,
  Users,
  ExternalLink,
  Filter,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { SkeletonRow } from "@/components/ui/skeleton";

interface TokenConviction {
  tokenAddress: string;
  symbol: string;
  name: string;
  chain: "solana" | "base";
  credibleHolders: number;
  avgConvictionScore: number;
  totalValue: number;
  convictionIntensity: number;
}

interface TokenHeatmapProps {
  className?: string;
  onDataLoaded?: (hasData: boolean) => void;
}

export function TokenHeatmap({ className, onDataLoaded }: TokenHeatmapProps) {
  const [tokens, setTokens] = useState<TokenConviction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"conviction" | "holders" | "value">(
    "conviction",
  );
  const [chainFilter, setChainFilter] = useState<"all" | "solana" | "base">(
    "all",
  );

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (chainFilter !== "all") {
        params.set("chain", chainFilter);
      }

      const response = await fetch(`/api/tokens/heatmap?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setTokens(data.tokens);
        onDataLoaded?.(data.tokens.length > 0);
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tokens");
      onDataLoaded?.(false);
    } finally {
      setLoading(false);
    }
  }, [chainFilter, onDataLoaded]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const sortedTokens = React.useMemo(() => {
    return [...tokens].sort((a, b) => {
      switch (sortBy) {
        case "conviction":
          return b.convictionIntensity - a.convictionIntensity;
        case "holders":
          return b.credibleHolders - a.credibleHolders;
        case "value":
          return b.totalValue - a.totalValue;
        default:
          return 0;
      }
    });
  }, [tokens, sortBy]);

  const formatValue = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  const getIntensityColor = (intensity: number) => {
    if (intensity >= 90) return "bg-patience text-patience-foreground";
    if (intensity >= 80) return "bg-signal text-signal-foreground";
    if (intensity >= 70) return "bg-foreground text-background";
    return "bg-foreground-muted text-foreground";
  };

  const getExplorerUrl = (token: TokenConviction) => {
    if (token.chain === "solana") {
      return `https://solscan.io/token/${token.tokenAddress}`;
    }
    return `https://basescan.org/token/${token.tokenAddress}`;
  };

  return (
    <Card
      className={cn("glass-panel border-border/50 bg-surface/40", className)}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
            <Flame className="w-4 h-4" />
            Token Conviction Heatmap
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSortBy(
                  sortBy === "conviction"
                    ? "holders"
                    : sortBy === "holders"
                      ? "value"
                      : "conviction",
                )
              }
              className="text-xs font-mono"
            >
              <TrendingUp className="w-3 h-3 mr-1" />
              {sortBy === "conviction"
                ? "Conviction"
                : sortBy === "holders"
                  ? "Holders"
                  : "Value"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setChainFilter(
                  chainFilter === "all"
                    ? "solana"
                    : chainFilter === "solana"
                      ? "base"
                      : "all",
                )
              }
              className="text-xs font-mono"
            >
              <Filter className="w-3 h-3 mr-1" />
              {chainFilter === "all" ? "All" : chainFilter.toUpperCase()}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchTokens}
              disabled={loading}
              className="text-xs"
            >
              <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <EthosGatedContent
          feature="tokenHeatmap"
          className="min-h-62.5"
        >
          {error ? (
            <div className="text-center py-8 text-foreground-muted">
              <Flame className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm text-impatience">{error}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchTokens}
                className="mt-2"
              >
                Try Again
              </Button>
            </div>
          ) : loading && tokens.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonRow key={i} className="rounded-lg border border-border/30" />
              ))}
            </div>
          ) : sortedTokens.length === 0 ? (
            <div className="text-center py-4 text-foreground-muted bg-surface/20 rounded-lg border border-dashed border-border/30">
              <div className="text-xs font-mono uppercase tracking-tighter opacity-50 mb-1">
                No Tokens Detected
              </div>
              <div className="text-[10px] opacity-40">
                Try adjusting the chain filter or check back later
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedTokens.map((token) => (
                <div
                  key={`${token.tokenAddress}_${token.chain}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface/30 border border-border/50 hover:bg-surface/50 transition-colors group"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full",
                          token.chain === "solana"
                            ? "bg-purple-500"
                            : "bg-blue-500",
                        )}
                      />
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
                    <div
                      className={cn(
                        "px-2 py-1 rounded text-xs font-mono font-bold",
                        getIntensityColor(token.convictionIntensity),
                      )}
                    >
                      {token.convictionIntensity}
                    </div>

                    <a
                      href={getExplorerUrl(token)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sortedTokens.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border/50">
              <div className="flex items-center justify-between text-xs text-foreground-muted">
                <span>
                  Showing {sortedTokens.length} tokens with credible conviction
                </span>
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
          )}
        </EthosGatedContent>
      </CardContent>
    </Card>
  );
}
