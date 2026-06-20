"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/navbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fetchAgentStatus,
  fetchAgentTrades,
  fetchAgentConviction,
  type AgentStatus,
  type AgentTrades,
  type AgentConviction,
} from "@/lib/agent-client";
import {
  Activity,
  RefreshCw,
  TrendingUp,
  Shield,
  AlertTriangle,
  ExternalLink,
  Wallet,
  BarChart3,
} from "lucide-react";

const POLL_INTERVAL = 15_000; // 15 seconds

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelative(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export default function AgentDashboardPage() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [trades, setTrades] = useState<AgentTrades | null>(null);
  const [conviction, setConviction] = useState<AgentConviction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<number | null>(null);

  const pollAll = useCallback(async () => {
    try {
      const [s, t, c] = await Promise.all([
        fetchAgentStatus(),
        fetchAgentTrades(),
        fetchAgentConviction(),
      ]);
      if (s || t || c) {
        setStatus(s);
        setTrades(t);
        setConviction(c);
        setError(null);
      } else {
        setError("Cannot reach agent — is it running?");
      }
    } catch (e) {
      setError("Cannot reach agent — is it running?");
    } finally {
      setLoading(false);
      setLastPoll(Date.now());
    }
  }, []);

  useEffect(() => {
    pollAll();
    const interval = setInterval(pollAll, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [pollAll]);

  // Color coding
  const statusColor =
    status?.status === "running" ? "text-signal" :
    status?.status === "error" ? "text-red-500" :
    status?.status === "idle" ? "text-patience" :
    "text-foreground-muted";

  const statusDot = status?.status === "running" ? "animate-pulse" : "";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-signal mb-2">
                <Activity className="w-3 h-3" />
                Agent Dashboard
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
                Trading Agent Monitor
              </h1>
              <p className="mt-2 text-sm text-foreground-muted max-w-2xl">
                Live status and metrics from the autonomous TWAK trading agent.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={pollAll}
              className="gap-2"
              disabled={loading}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </motion.div>

        {/* Connection Error Banner */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-center gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-400">{error}</p>
              <p className="text-xs text-foreground-muted mt-0.5">
                Make sure the agent is running with <code className="text-[10px] px-1 py-0.5 rounded bg-surface font-mono">node dist/index.js</code>
              </p>
            </div>
          </motion.div>
        )}

        {/* Status Grid */}
        {status && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
          >
            {/* Status */}
            <Card className="glass-panel border-border/50 bg-surface/40">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-xs font-mono text-foreground-muted">
                  <Activity className="w-3.5 h-3.5" />
                  Agent Status
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full", statusColor, statusDot)} />
                  <span className="text-lg font-bold capitalize">{status.status}</span>
                </div>
                <div className="mt-2 text-xs text-foreground-muted space-y-1">
                  <p>Cycle #{status.cycle}</p>
                  <p>Last run: {formatRelative(status.lastRunAt)}</p>
                  {status.nextRunAt && (
                    <p>Next: {formatTime(status.nextRunAt)}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Portfolio */}
            <Card className="glass-panel border-border/50 bg-surface/40">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-xs font-mono text-foreground-muted">
                  <Wallet className="w-3.5 h-3.5" />
                  Portfolio
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold text-patience">
                  {formatUsd(status.portfolio.totalValueUsd)}
                </div>
                <div className="mt-2 text-xs text-foreground-muted space-y-1">
                  <p>{status.portfolio.positions} position{status.portfolio.positions !== 1 ? "s" : ""}</p>
                  <p>{status.portfolio.chains.join(", ") || "BSC"}</p>
                </div>
              </CardContent>
            </Card>

            {/* Volume */}
            <Card className="glass-panel border-border/50 bg-surface/40">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-xs font-mono text-foreground-muted">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Volume
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">
                  {formatUsd(status.totalVolumeUsd)}
                </div>
                <div className="mt-2 text-xs text-foreground-muted space-y-1">
                  <p>{status.totalTrades} total trades</p>
                  <p>{status.errors} error{status.errors !== 1 ? "s" : ""}</p>
                </div>
              </CardContent>
            </Card>

            {/* Guardrails */}
            <Card className="glass-panel border-border/50 bg-surface/40">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-xs font-mono text-foreground-muted">
                  <Shield className="w-3.5 h-3.5" />
                  Guardrails
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-mono",
                    status.guardrails.allOk
                      ? "bg-patience/10 text-patience"
                      : "bg-red-500/10 text-red-400"
                  )}>
                    {status.guardrails.allOk ? "OK" : "LIMITED"}
                  </span>
                  <span className={cn(
                    "text-lg font-bold",
                    status.guardrails.drawdownExceeded ? "text-red-500" : "text-foreground"
                  )}>
                    {status.guardrails.drawdownPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-2 text-xs text-foreground-muted space-y-1">
                  <p>{status.guardrails.tradesToday}/{status.guardrails.dailyLimit} trades today</p>
                  <p>Peak: {formatUsd(status.guardrails.peakValueUsd)}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Trades */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="glass-panel border-border/50 bg-surface/40">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-signal" />
                  <CardTitle className="text-sm font-mono uppercase tracking-wider">
                    Recent Trades
                  </CardTitle>
                </div>
                <CardDescription>
                  {trades ? `${trades.totalSessionTrades} trades this session` : "Loading..."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {trades && trades.recentTrades.length > 0 ? (
                  <div className="space-y-2">
                    {trades.recentTrades.map((trade, i) => (
                      <div
                        key={`${trade.timestamp}-${i}`}
                        className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-surface/30"
                      >
                        <div className="flex items-center gap-3">
                          <span className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono",
                            trade.success
                              ? "bg-patience/10 text-patience"
                              : "bg-red-500/10 text-red-400"
                          )}>
                            {trade.success ? "✓" : "✗"}
                          </span>
                          <div>
                            <p className="text-xs font-medium">
                              {trade.tokenIn} → {trade.tokenOut}
                            </p>
                            <p className="text-[10px] text-foreground-muted">
                              {formatTime(trade.timestamp)}
                              {trade.success && trade.txHash && (
                                <> · <span className="font-mono">{trade.txHash.slice(0, 8)}...</span></>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-mono">
                            {trade.amountIn} → {trade.amountOut.slice(0, 8)}
                          </p>
                          {trade.explorerUrl && (
                            <a
                              href={trade.explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-signal hover:underline inline-flex items-center gap-1"
                            >
                              View <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-foreground-muted">
                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-xs font-mono">No trades executed yet this session</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Right Column: Market Data + Anchoring */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-6"
          >
            {/* Market Data */}
            <Card className="glass-panel border-border/50 bg-surface/40">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-signal" />
                  <CardTitle className="text-sm font-mono uppercase tracking-wider">
                    Market Data
                  </CardTitle>
                </div>
                <CardDescription>
                  {conviction?.marketData
                    ? `${conviction.marketData.tokensTracked} tokens tracked`
                    : "No data available"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {conviction?.marketData ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border border-border/50 bg-surface/30">
                      <p className="text-[10px] font-mono text-foreground-muted uppercase mb-1">Fear & Greed</p>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-lg font-bold",
                          conviction.marketData.fearGreedIndex !== null && conviction.marketData.fearGreedIndex <= 25
                            ? "text-red-400"
                            : conviction.marketData.fearGreedIndex !== null && conviction.marketData.fearGreedIndex >= 75
                            ? "text-patience"
                            : "text-foreground"
                        )}>
                          {conviction.marketData.fearGreedIndex ?? "—"}
                        </span>
                        <span className="text-[10px] text-foreground-muted">
                          {conviction.marketData.fearGreedLabel}
                        </span>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-border/50 bg-surface/30">
                      <p className="text-[10px] font-mono text-foreground-muted uppercase mb-1">Market Cap</p>
                      <p className="text-lg font-bold">
                        {conviction.marketData.totalMarketCapUsd
                          ? `$${(conviction.marketData.totalMarketCapUsd / 1e12).toFixed(2)}T`
                          : "—"}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border border-border/50 bg-surface/30">
                      <p className="text-[10px] font-mono text-foreground-muted uppercase mb-1">BTC Funding</p>
                      <p className={cn(
                        "text-lg font-bold",
                        conviction.marketData.btcFundingRate !== null && conviction.marketData.btcFundingRate < 0
                          ? "text-patience"
                          : "text-foreground"
                      )}>
                        {conviction.marketData.btcFundingRate !== null
                          ? `${(conviction.marketData.btcFundingRate * 100).toFixed(4)}%`
                          : "—"}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border border-border/50 bg-surface/30">
                      <p className="text-[10px] font-mono text-foreground-muted uppercase mb-1">ETH Funding</p>
                      <p className={cn(
                        "text-lg font-bold",
                        conviction.marketData.ethFundingRate !== null && conviction.marketData.ethFundingRate < 0
                          ? "text-patience"
                          : "text-foreground"
                      )}>
                        {conviction.marketData.ethFundingRate !== null
                          ? `${(conviction.marketData.ethFundingRate * 100).toFixed(4)}%`
                          : "—"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-foreground-muted">
                    <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-xs font-mono">Market data unavailable</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Anchoring */}
            <Card className="glass-panel border-border/50 bg-surface/40">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-signal" />
                  <CardTitle className="text-sm font-mono uppercase tracking-wider">
                    Mantle Anchoring
                  </CardTitle>
                </div>
                <CardDescription>
                  On-chain proof-of-analysis on Mantle Sepolia
                </CardDescription>
              </CardHeader>
              <CardContent>
                {conviction?.anchoring ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded text-xs font-mono",
                        conviction.anchoring.mode === "on-chain"
                          ? "bg-patience/10 text-patience"
                          : conviction.anchoring.mode === "simulator"
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-red-500/10 text-red-400"
                      )}>
                        {conviction.anchoring.mode === "on-chain" ? "ON-CHAIN ✓" :
                         conviction.anchoring.mode === "simulator" ? "SIMULATOR" :
                         conviction.anchoring.mode}
                      </span>
                      {conviction.anchoring.gasUsed && (
                        <span className="text-[10px] text-foreground-muted">
                          Gas: {conviction.anchoring.gasUsed}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-foreground-muted space-y-1">
                      {conviction.anchoring.blockNumber && (
                        <p>Block: {conviction.anchoring.blockNumber}</p>
                      )}
                      <p className="truncate">Tx: {conviction.anchoring.hash}</p>
                    </div>
                    {conviction.anchoredUrl && (
                      <a
                        href={conviction.anchoredUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-signal hover:underline mt-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Explorer
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 text-foreground-muted">
                    <Shield className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-xs font-mono">No anchoring data yet</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Last poll time */}
            {lastPoll && (
              <p className="text-[10px] text-foreground-muted text-center font-mono">
                Updated {formatRelative(lastPoll)} · Polling every {POLL_INTERVAL / 1000}s
              </p>
            )}
          </motion.div>
        </div>
      </div>
    </main>
  );
}
