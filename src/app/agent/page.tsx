"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Activity,
  TrendingUp,
  Shield,
  AlertTriangle,
  DollarSign,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Zap,
  BarChart3,
  Globe,
  FileText,
} from "lucide-react";

// ─── Types ───

interface AgentStatus {
  agent: string;
  version: string;
  status: string;
  cycle: number;
  lastRunAt: number;
  nextRunAt: number;
  totalTrades: number;
  totalVolumeUsd: number;
  errors: number;
  portfolio: {
    totalValueUsd: number;
    positions: number;
    chains: string[];
  };
  guardrails: {
    drawdownPercent: number;
    peakValueUsd: number;
    tradesToday: number;
    dailyLimit: number;
    drawdownExceeded: boolean;
    allOk: boolean;
  };
}

interface Trade {
  timestamp: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  success: boolean;
}

interface TradesResponse {
  totalSessionTrades: number;
  totalVolumeUsd: number;
  recentTrades: Trade[];
}

interface ConvictionData {
  marketData: {
    fearGreedIndex: number;
    fearGreedLabel: string;
    totalMarketCapUsd: number;
    btcFundingRate: number;
    ethFundingRate: number;
    tokensTracked: number;
  };
  portfolio: {
    totalValueUsd: number;
    drawdownPercent: number;
    positions: Array<{ symbol: string; valueUsd: number }>;
  };
  anchoredHash: string;
  anchoredUrl: string;
}

// ─── Constants ───

const REFRESH_INTERVAL = 30_000; // 30s

// ─── Helpers ───

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return formatCurrency(n);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

// ─── Components ───

function StatBadge({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface/50 border border-border/50 text-xs font-mono">
      <span className="text-foreground-muted uppercase tracking-wider">{label}</span>
      <span className={cn("font-semibold", color || "text-foreground")}>{value}</span>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full shadow-[0_0_8px]",
        ok ? "bg-patience shadow-patience/50" : "bg-impatience shadow-impatience/50",
      )}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-64 bg-surface/50 rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 bg-surface/30 rounded-xl border border-border/50" />
        ))}
      </div>
      <div className="h-64 bg-surface/30 rounded-xl border border-border/50" />
    </div>
  );
}

// ─── Main Page ───

export default function AgentDashboard() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [trades, setTrades] = useState<TradesResponse | null>(null);
  const [conviction, setConviction] = useState<ConvictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, tradesRes, convictionRes] = await Promise.all([
        fetch("/api/agent/proxy?endpoint=status"),
        fetch("/api/agent/proxy?endpoint=trades"),
        fetch("/api/agent/proxy?endpoint=conviction"),
      ]);

      if (!statusRes.ok) throw new Error(`/status returned ${statusRes.status}`);
      if (!tradesRes.ok) throw new Error(`/trades returned ${tradesRes.status}`);
      if (!convictionRes.ok) throw new Error(`/conviction returned ${convictionRes.status}`);

      setStatus(await statusRes.json());
      setTrades(await tradesRes.json());
      setConviction(await convictionRes.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect to agent");
    } finally {
      setLoading(false);
      setLastFetch(new Date());
      setCountdown(REFRESH_INTERVAL / 1000);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Auto-refresh countdown
  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchAll();
          return REFRESH_INTERVAL / 1000;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loading, fetchAll]);

  const cycleActive = status && status.status === "running";
  const cycleIdle = status && status.status === "idle";

  return (
    <div className="min-h-screen text-foreground selection:bg-signal/20 overflow-x-hidden relative">
      <Navbar />
      <main className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-signal mb-2">
                <Activity className="w-3 h-3" />
                Autonomous Trading Agent
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Early, Not Wrong
              </h1>
              <p className="mt-1 text-sm text-foreground-muted">
                Live dashboard for the BNB Hack autonomous trading agent
              </p>
            </div>
            <div className="flex items-center gap-3">
              {status && (
                <StatBadge
                  label="Cycle"
                  value={`#${status.cycle}`}
                  color="text-signal"
                />
              )}
              {status && (
                <StatBadge
                  label="Trades"
                  value={status.totalTrades}
                  color="text-patience"
                />
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-full text-xs font-mono"
                onClick={fetchAll}
                disabled={loading}
              >
                <RefreshCw className={cn("w-3 h-3 mr-1.5", loading && "animate-spin")} />
                {countdown}s
              </Button>
            </div>
          </div>

          {lastFetch && (
            <p className="text-[10px] font-mono text-foreground-dim mt-2">
              Last updated: {lastFetch.toLocaleTimeString()} · Auto-refresh every {REFRESH_INTERVAL / 1000}s
            </p>
          )}
        </motion.div>

        {loading && <LoadingSkeleton />}

        {error && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center space-y-4"
          >
            <AlertTriangle className="w-12 h-12 text-impatience/60" />
            <div>
              <h2 className="text-xl font-bold mb-1">Agent Unreachable</h2>
              <p className="text-sm text-foreground-muted max-w-md">
                Could not connect to the trading agent on the VPS.
                The VPS may be offline or the agent may have stopped.
              </p>
              <p className="text-xs font-mono text-impatience mt-2">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchAll} className="rounded-full">
              <RefreshCw className="w-3 h-3 mr-1.5" />
              Retry
            </Button>
          </motion.div>
        )}

        {!loading && !error && status && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {/* Row 1: Agent Status + Portfolio + Guardrails */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Agent Status Card */}
              <Card className="bg-surface/30 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-signal" />
                    Agent Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StatusDot ok={cycleIdle ?? false} />
                    <span className="text-lg font-semibold capitalize">{status.status}</span>
                    {cycleActive && (
                      <span className="text-xs font-mono text-signal animate-pulse">
                        RUNNING...
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div>
                      <span className="text-foreground-muted">Version</span>
                      <p className="text-foreground">{status.version}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Status</span>
                      <p className="text-foreground">{status.status}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Last Run</span>
                      <p className="text-foreground">{formatTime(status.lastRunAt)}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Next Run</span>
                      <p className="text-foreground">{formatTime(status.nextRunAt)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Portfolio Card */}
              <Card className="bg-surface/30 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                    <DollarSign className="w-3.5 h-3.5 text-patience" />
                    Portfolio
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-2xl sm:text-3xl font-bold tabular-nums text-foreground">
                    {formatCurrency(status.portfolio.totalValueUsd)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div>
                      <span className="text-foreground-muted">Positions</span>
                      <p className="text-foreground">{status.portfolio.positions}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Chains</span>
                      <p className="text-foreground">{status.portfolio.chains.join(", ")}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Volume (total)</span>
                      <p className="text-patience">{formatCurrency(status.totalVolumeUsd)}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Errors</span>
                      <p className={cn(status.errors > 0 ? "text-impatience" : "text-patience")}>
                        {status.errors}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Guardrails Card */}
              <Card className="bg-surface/30 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-impatience" />
                    Guardrails
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StatusDot ok={status.guardrails.allOk} />
                    <span className={cn(
                      "text-lg font-semibold",
                      status.guardrails.allOk ? "text-patience" : "text-impatience",
                    )}>
                      {status.guardrails.allOk ? "All Systems Nominal" : "Limit Breached"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div>
                      <span className="text-foreground-muted">Drawdown</span>
                      <p className={cn(
                        status.guardrails.drawdownExceeded ? "text-impatience" : "text-patience"
                      )}>
                        {status.guardrails.drawdownPercent.toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Peak Value</span>
                      <p className="text-foreground">{formatCurrency(status.guardrails.peakValueUsd)}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Today's Trades</span>
                      <p className={cn(
                        status.guardrails.tradesToday >= status.guardrails.dailyLimit
                          ? "text-impatience"
                          : "text-patience"
                      )}>
                        {status.guardrails.tradesToday}/{status.guardrails.dailyLimit}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Row 2: Recent Trades + Market Data */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Trades */}
              <Card className="bg-surface/30 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                    <BarChart3 className="w-3.5 h-3.5 text-patience" />
                    Recent Trades
                    {trades && (
                      <span className="ml-auto text-foreground-dim text-[10px]">
                        {trades.totalSessionTrades} total · {formatCurrency(trades.totalVolumeUsd)} volume
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {trades && trades.recentTrades.length > 0 ? (
                    <div className="space-y-2">
                      {trades.recentTrades.map((trade, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="flex items-center justify-between p-3 rounded-lg bg-surface/40 border border-border/40 hover:border-signal/20 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex items-center gap-1 text-sm font-semibold">
                              <span className="text-impatience">{trade.tokenIn}</span>
                              <ChevronRight className="w-3 h-3 text-foreground-muted shrink-0" />
                              <span className="text-patience">{trade.tokenOut}</span>
                            </div>
                            <span className="text-xs font-mono text-foreground-muted">
                              ${trade.amountIn}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {trade.success ? (
                              <span className="flex items-center gap-1 text-xs text-patience">
                                <CheckCircle2 className="w-3 h-3" />
                                Executed
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-impatience">
                                <XCircle className="w-3 h-3" />
                                Failed
                              </span>
                            )}
                            <span className="text-[10px] text-foreground-dim font-mono">
                              {formatTime(trade.timestamp)}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-foreground-muted">
                      <BarChart3 className="w-8 h-8 mb-2 opacity-40" />
                      <p className="text-xs font-mono">No trades yet this session</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Market Data */}
              <Card className="bg-surface/30 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-signal" />
                    Market Data
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {conviction && (
                    <>
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-bold tabular-nums">{conviction.marketData.fearGreedIndex}</span>
                          <span className={cn(
                            "text-xs font-mono px-2 py-0.5 rounded-full",
                            conviction.marketData.fearGreedIndex <= 25
                              ? "bg-impatience/10 text-impatience border border-impatience/20"
                              : conviction.marketData.fearGreedIndex >= 75
                              ? "bg-patience/10 text-patience border border-patience/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20",
                          )}>
                            {conviction.marketData.fearGreedLabel}
                          </span>
                        </div>
                        <span className="text-xs text-foreground-muted font-mono">
                          Fear & Greed Index
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                        <div>
                          <span className="text-foreground-muted">Market Cap</span>
                          <p className="text-foreground">{formatCompact(conviction.marketData.totalMarketCapUsd)}</p>
                        </div>
                        <div>
                          <span className="text-foreground-muted">Tokens Tracked</span>
                          <p className="text-foreground">{conviction.marketData.tokensTracked}</p>
                        </div>
                        <div>
                          <span className="text-foreground-muted">BTC Funding</span>
                          <p className="text-foreground">{(conviction.marketData.btcFundingRate * 100).toFixed(4)}%</p>
                        </div>
                        <div>
                          <span className="text-foreground-muted">ETH Funding</span>
                          <p className="text-foreground">{(conviction.marketData.ethFundingRate * 100).toFixed(4)}%</p>
                        </div>
                      </div>
                      {conviction.anchoredHash && conviction.anchoredHash !== "0x0000000000000000000000000000000000000000000000000000000000000000" && (
                        <div className="pt-2 border-t border-border/50">
                          <div className="flex items-center gap-2 text-[10px] font-mono text-foreground-muted">
                            <FileText className="w-3 h-3" />
                            <span>Anchored on Mantle:</span>
                            <a
                              href={conviction.anchoredUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-signal hover:underline truncate"
                            >
                              {conviction.anchoredHash.slice(0, 18)}...
                              <ExternalLink className="w-2.5 h-2.5 inline ml-0.5" />
                            </a>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Row 3: Architecture Pipeline */}
            <Card className="bg-surface/30 border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-signal" />
                  Pipeline Architecture
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                  {[
                    { label: "CMC Data", icon: Globe, desc: "Market data, F&G, funding", color: "text-blue-400" },
                    { label: "Conviction", icon: TrendingUp, desc: "Token scoring (0-100)", color: "text-signal" },
                    { label: "Liquidity", icon: Activity, desc: "DEX check via TWAK", color: "text-emerald-400" },
                    { label: "Sizing", icon: BarChart3, desc: "Adaptive 0.8^n decay", color: "text-amber-400" },
                    { label: "Guardrails", icon: Shield, desc: "8-layer risk check", color: "text-impatience" },
                    { label: "TWAK Swap", icon: Zap, desc: "Agent Wallet Mode", color: "text-purple-400" },
                    { label: "Mantle", icon: FileText, desc: "ERC-8004 anchor", color: "text-cyan-400" },
                    { label: "HTTP API", icon: Activity, desc: "/status /trades /conviction", color: "text-foreground-muted" },
                  ].map((step, i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center text-center p-3 rounded-lg bg-surface/40 border border-border/40 hover:border-signal/20 transition-colors gap-2"
                    >
                      <step.icon className={cn("w-5 h-5", step.color)} />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-foreground">{step.label}</span>
                      <span className="text-[8px] text-foreground-muted">{step.desc}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Row 4: Demo Video + Links */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Demo */}
              <Card className="bg-surface/30 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-signal" />
                    Demo Recording
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg overflow-hidden border border-border/50 bg-surface/50">
                    <div className="p-4 text-center">
                      <p className="text-sm text-foreground-muted mb-3">
                        Watch the live terminal replay showing all three endpoints
                      </p>
                      <a
                        href="https://asciinema.org/a/lMVdIaBr9G2KK9Ni"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="default" size="sm" className="rounded-full">
                          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                          Watch Demo (asciinema)
                        </Button>
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Links */}
              <Card className="bg-surface/30 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                    <ExternalLink className="w-3.5 h-3.5 text-signal" />
                    Resources
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    {
                      label: "GitHub Repository",
                      href: "https://github.com/thisyearnofear/earlynotwrong",
                      desc: "Full source code",
                    },
                    {
                      label: "BNB Hack Submission",
                      href: "https://dorahacks.io/hackathon/bnbhack-twt-cmc/detail",
                      desc: "Track 2 — Strategy Skills",
                    },
                    {
                      label: "Agent Wallet",
                      href: "https://testnet.bscscan.com/address/0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a",
                      desc: "0xA1Dd482E...5888a",
                    },
                    {
                      label: "Mantle Registry",
                      href: "https://explorer.sepolia.mantle.xyz/address/0x81226e8894D334c790D9a972855592E6C4eeB15C",
                      desc: "0x81226e88...eeB15C",
                    },
                  ].map((link, i) => (
                    <a
                      key={i}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-3 rounded-lg bg-surface/40 border border-border/40 hover:border-signal/20 transition-colors group"
                    >
                      <div>
                        <p className="text-xs font-semibold text-foreground group-hover:text-signal transition-colors">
                          {link.label}
                        </p>
                        <p className="text-[10px] text-foreground-muted font-mono mt-0.5">{link.desc}</p>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-foreground-muted group-hover:text-signal shrink-0" />
                    </a>
                  ))}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
