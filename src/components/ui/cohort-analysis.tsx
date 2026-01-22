"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  Users,
  TrendingUp,
  TrendingDown,
  BarChart3,
  RefreshCw,
  Crown,
  Loader2,
  ExternalLink,
} from "lucide-react";

interface TraderBenchmark {
  id: string;
  name: string;
  chain: "solana" | "base";
  ethosScore: number | null;
  farcaster?: string;
}

interface BenchmarkStats {
  traderCount: number;
  avgEthosScore: number;
  minEthosScore: number;
  maxEthosScore: number;
  traders: TraderBenchmark[];
  chains: {
    solana: number;
    base: number;
  };
}

interface CohortAnalysisProps {
  className?: string;
  onDataLoaded?: (hasData: boolean) => void;
}

export function CohortAnalysis({
  className,
  onDataLoaded,
}: CohortAnalysisProps) {
  const { ethosScore, convictionMetrics } = useAppStore();
  const [benchmark, setBenchmark] = useState<BenchmarkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBenchmark = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/cohort/benchmark");
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setBenchmark(data.benchmark);
        onDataLoaded?.(data.benchmark.traderCount > 0);
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load benchmark");
      onDataLoaded?.(false);
    } finally {
      setLoading(false);
    }
  }, [onDataLoaded]);

  useEffect(() => {
    fetchBenchmark();
  }, [fetchBenchmark]);

  const userScore = ethosScore?.score || 0;
  const userCI = convictionMetrics?.score || 0;

  const getComparisonText = (
    userValue: number,
    benchmarkValue: number,
    metric: string,
  ) => {
    if (userValue === 0) return null;
    const diff = userValue - benchmarkValue;
    const percentDiff = Math.abs(Math.round((diff / benchmarkValue) * 100));

    if (diff > 0) {
      return {
        text: `${percentDiff}% above benchmark`,
        positive: true,
      };
    } else if (diff < 0) {
      return {
        text: `${percentDiff}% below benchmark`,
        positive: false,
      };
    }
    return { text: "At benchmark", positive: true };
  };

  const ethosComparison = benchmark
    ? getComparisonText(userScore, benchmark.avgEthosScore, "Ethos")
    : null;

  return (
    <Card
      className={cn("glass-panel border-border/50 bg-surface/40", className)}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Elite Traders Benchmark
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchBenchmark}
            disabled={loading}
            className="text-xs"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <EthosGatedContent
          minScore={500}
          title="Elite Traders Benchmark"
          description="Compare your metrics against tracked high-conviction traders."
          className="min-h-[400px]"
        >
          {error ? (
            <div className="text-center py-4 text-foreground-muted bg-surface/20 rounded-lg border border-dashed border-border/30">
              <div className="text-xs font-mono uppercase tracking-tighter text-impatience mb-1">
                Benchmark Error
              </div>
              <div className="text-[10px] opacity-40 mb-2">{error}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchBenchmark}
                className="h-7 text-[10px]"
              >
                Try Again
              </Button>
            </div>
          ) : loading && !benchmark ? (
            <div className="text-center py-8 text-foreground-muted">
              <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" />
              <div className="text-sm">Loading benchmark data...</div>
            </div>
          ) : benchmark && benchmark.traderCount === 0 ? (
            <div className="text-center py-4 text-foreground-muted bg-surface/20 rounded-lg border border-dashed border-border/30">
              <div className="text-xs font-mono uppercase tracking-tighter opacity-50 mb-1">
                No Benchmark Data
              </div>
              <div className="text-[10px] opacity-40">
                Not enough high-conviction traders tracked for comparison
              </div>
            </div>
          ) : benchmark ? (
            <div className="space-y-6">
              {/* Benchmark Overview */}
              <div className="p-4 rounded-lg border border-patience/30 bg-patience/5">
                <div className="flex items-center gap-3 mb-4">
                  <Crown className="w-5 h-5 text-patience" />
                  <div>
                    <div className="font-semibold text-foreground">
                      Watchlist Benchmark
                    </div>
                    <div className="text-xs text-foreground-muted">
                      {benchmark.traderCount} tracked traders •{" "}
                      {benchmark.chains.solana} Solana • {benchmark.chains.base}{" "}
                      Base
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-mono text-patience">
                      {benchmark.avgEthosScore}
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Avg Ethos Score
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-mono text-foreground">
                      {benchmark.minEthosScore}
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Min Score
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-mono text-foreground">
                      {benchmark.maxEthosScore}
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Max Score
                    </div>
                  </div>
                </div>
              </div>

              {/* Your Comparison */}
              {userScore > 0 && (
                <div className="p-4 rounded-lg border border-signal/30 bg-signal/5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="font-semibold text-foreground">
                      Your Position
                    </div>
                    {ethosComparison && (
                      <div
                        className={cn(
                          "flex items-center gap-1 text-xs font-mono",
                          ethosComparison.positive
                            ? "text-patience"
                            : "text-impatience",
                        )}
                      >
                        {ethosComparison.positive ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {ethosComparison.text}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-foreground-muted mb-1">
                        Your Ethos Score
                      </div>
                      <div className="text-xl font-mono text-foreground">
                        {userScore}
                      </div>
                      <div className="w-full bg-border/30 rounded-full h-2 mt-2">
                        <div
                          className="bg-signal h-2 rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (userScore / benchmark.maxEthosScore) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    {userCI > 0 && (
                      <div>
                        <div className="text-xs text-foreground-muted mb-1">
                          Your Conviction Index
                        </div>
                        <div className="text-xl font-mono text-foreground">
                          {userCI.toFixed(1)}
                        </div>
                        <div className="w-full bg-border/30 rounded-full h-2 mt-2">
                          <div
                            className="bg-patience h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(100, userCI)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tracked Traders List */}
              <div>
                <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-3">
                  Tracked Traders
                </div>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {benchmark.traders.map((trader) => (
                    <div
                      key={trader.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-surface/30 border border-border/50"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "w-2 h-2 rounded-full",
                            trader.chain === "solana"
                              ? "bg-purple-500"
                              : "bg-blue-500",
                          )}
                        />
                        <span className="text-sm font-mono text-foreground">
                          {trader.name}
                        </span>
                        {trader.farcaster && (
                          <a
                            href={`https://warpcast.com/${trader.farcaster}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-foreground-muted hover:text-signal"
                          >
                            @{trader.farcaster}
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {trader.ethosScore !== null ? (
                          <span className="text-sm font-mono text-foreground">
                            {trader.ethosScore}
                          </span>
                        ) : (
                          <span className="text-xs text-foreground-muted">
                            —
                          </span>
                        )}
                        <span className="text-xs text-foreground-muted uppercase">
                          {trader.chain}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="text-xs text-foreground-muted">
              Benchmark based on {benchmark?.traderCount || 0} curated
              high-conviction traders. Ethos scores fetched in real-time.
            </div>
          </div>
        </EthosGatedContent>
      </CardContent>
    </Card>
  );
}
