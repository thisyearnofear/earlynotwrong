"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  DollarSign,
  Shield,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { StatusDot } from "./status-dot";
import { formatCurrency, formatTime } from "./formatters";

export interface AgentHealthStatus {
  status: string;
  version: string;
  cycle: number;
  lastRunAt: number;
  nextRunAt: number;
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
  metrics?: {
    realizedPnlUsd: number;
    totalGasSpentUsd: number;
    netPnlUsd: number;
    winRate: number;
    totalEntries: number;
    totalExits: number;
    profitFactor: number;
  } | null;
  behavioralMetrics?: {
    score: number;
    archetype: string;
    winRate: number;
    avgHoldingPeriod: number;
    totalPositions: number;
    earlyExits: number;
  } | null;
}

interface AgentHealthGridProps {
  status: AgentHealthStatus;
  animated?: boolean;
}

/** Full stat cards — demo inline or simple-view disclosure. */
export function AgentHealthGrid({ status, animated = false }: AgentHealthGridProps) {
  const wrap = (delay: number, child: ReactNode) =>
    animated ? (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.35 }}
      >
        {child}
      </motion.div>
    ) : (
      child
    );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {wrap(
        0.05,
        <Card className="bg-surface/30 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-signal" />
              Agent Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <StatusDot ok={status.status === "idle"} />
              <span className="text-lg font-semibold capitalize">{status.status}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-foreground-muted">Version</span>
                <p className="text-foreground">{status.version}</p>
              </div>
              <div>
                <span className="text-foreground-muted">Cycle</span>
                <p className="text-foreground">#{status.cycle}</p>
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
        </Card>,
      )}
      {wrap(
        0.08,
        <Card className="bg-surface/30 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5 text-patience" />
              Portfolio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-2xl font-bold tabular-nums">
              {formatCurrency(status.portfolio.totalValueUsd)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-foreground-muted">Positions</span>
                <p>{status.portfolio.positions}</p>
              </div>
              <div>
                <span className="text-foreground-muted">Chains</span>
                <p>{status.portfolio.chains.join(", ")}</p>
              </div>
              <div>
                <span className="text-foreground-muted">Volume</span>
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
        </Card>,
      )}
      {wrap(
        0.11,
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
                {status.guardrails.allOk ? "Nominal" : "Breached"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-foreground-muted">Drawdown</span>
                <p className={cn(status.guardrails.drawdownExceeded ? "text-impatience" : "text-patience")}>
                  {status.guardrails.drawdownPercent.toFixed(1)}%
                </p>
              </div>
              <div>
                <span className="text-foreground-muted">Peak</span>
                <p>{formatCurrency(status.guardrails.peakValueUsd)}</p>
              </div>
              <div>
                <span className="text-foreground-muted">Today</span>
                <p className={cn(
                  status.guardrails.tradesToday >= status.guardrails.dailyLimit
                    ? "text-impatience"
                    : "text-patience",
                )}>
                  {status.guardrails.tradesToday}/{status.guardrails.dailyLimit}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>,
      )}
      {wrap(
        0.14,
        <Card className="bg-surface/30 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-patience" />
              Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className={cn(
              "text-2xl font-bold tabular-nums",
              (status.metrics?.netPnlUsd ?? 0) >= 0 ? "text-patience" : "text-impatience",
            )}>
              {formatCurrency(status.metrics?.netPnlUsd ?? 0)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-foreground-muted">Win rate</span>
                <p>{((status.metrics?.winRate ?? 0) * 100).toFixed(0)}%</p>
              </div>
              <div>
                <span className="text-foreground-muted">In / out</span>
                <p>
                  {status.metrics?.totalEntries ?? 0} / {status.metrics?.totalExits ?? 0}
                </p>
              </div>
              <div>
                <span className="text-foreground-muted">Profit factor</span>
                <p>{(status.metrics?.profitFactor ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <span className="text-foreground-muted">Gas</span>
                <p>{formatCurrency(status.metrics?.totalGasSpentUsd ?? 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>,
      )}
      {wrap(
        0.16,
        <Card className="bg-surface/30 border-border/50 md:col-span-2 lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-signal" />
              Conviction Index
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status.behavioralMetrics ? (
              <div className="space-y-2">
                <div className={cn(
                  "text-2xl font-bold tabular-nums",
                  status.behavioralMetrics.score >= 60 ? "text-patience" : "text-impatience",
                )}>
                  {status.behavioralMetrics.score}
                  <span className="text-xs font-normal text-foreground-muted ml-1">/ 100</span>
                </div>
                <p className="text-sm font-medium">{status.behavioralMetrics.archetype}</p>
                <p className="text-[10px] font-mono text-foreground-dim">
                  {status.behavioralMetrics.avgHoldingPeriod}d avg hold ·{" "}
                  {status.behavioralMetrics.earlyExits} early exits
                </p>
              </div>
            ) : (
              <p className="text-sm text-foreground-muted">
                Scores once the agent has closed positions.
              </p>
            )}
          </CardContent>
        </Card>,
      )}
    </div>
  );
}
