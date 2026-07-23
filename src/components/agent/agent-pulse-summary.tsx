"use client";

import type { ReactNode } from "react";
import {
  Activity,
  DollarSign,
  Signal,
  TrendingUp,
  Shield,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PulseStatus {
  status: string;
  cycle: number;
  nextRunAt: number;
  portfolio: { totalValueUsd: number; positions: number };
  guardrails: { allOk: boolean; drawdownPercent: number };
  metrics?: { netPnlUsd: number; winRate: number } | null;
  behavioralMetrics?: { score: number; archetype: string } | null;
}

interface PulseConviction {
  regime?: { score: number; label: string } | null;
  signals: Array<{ symbol: string; score: number }>;
  heldPositions: unknown[];
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function minutesUntil(ts: number): number {
  return Math.max(0, Math.round((ts - Date.now()) / 60_000));
}

interface AgentPulseSummaryProps {
  status: PulseStatus;
  conviction: PulseConviction | null;
}

/** At-a-glance strip — replaces five stat cards in simple view. */
export function AgentPulseSummary({ status, conviction }: AgentPulseSummaryProps) {
  const topSignal = conviction?.signals[0];
  const netPnl = status.metrics?.netPnlUsd ?? 0;

  return (
    <div className="rounded-xl border border-border/50 bg-surface/30 overflow-hidden">
      <div className="grid grid-cols-2 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-border/40">
        <PulseCell
          icon={Activity}
          label="Status"
          className="col-span-1"
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "w-2 h-2 rounded-full shrink-0",
                status.status === "idle" ? "bg-patience" : "bg-signal animate-pulse",
              )}
            />
            <span className="text-sm font-semibold capitalize truncate">{status.status}</span>
          </div>
          <p className="text-[10px] font-mono text-foreground-dim mt-0.5">
            Cycle #{status.cycle}
          </p>
        </PulseCell>

        <PulseCell icon={DollarSign} label="Portfolio">
          <p className="text-lg sm:text-xl font-bold tabular-nums">
            {formatCurrency(status.portfolio.totalValueUsd)}
          </p>
          <p className="text-[10px] font-mono text-foreground-dim mt-0.5">
            {status.portfolio.positions} positions
          </p>
        </PulseCell>

        <PulseCell icon={Signal} label="Top signal">
          {topSignal ? (
            <>
              <p className="text-lg font-bold tabular-nums">
                <span className="text-foreground">{topSignal.symbol}</span>
                <span className="text-signal ml-1.5">{topSignal.score}</span>
              </p>
              {conviction?.regime && (
                <p className="text-[10px] font-mono text-foreground-dim mt-0.5 truncate">
                  {conviction.regime.label} · {conviction.regime.score}/100
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-foreground-muted">—</p>
          )}
        </PulseCell>

        <PulseCell icon={TrendingUp} label="Net PnL">
          <p
            className={cn(
              "text-lg font-bold tabular-nums",
              netPnl >= 0 ? "text-patience" : "text-impatience",
            )}
          >
            {netPnl >= 0 ? "+" : ""}
            {formatCurrency(netPnl).replace("$", "$")}
          </p>
          {status.metrics && (
            <p className="text-[10px] font-mono text-foreground-dim mt-0.5">
              {(status.metrics.winRate * 100).toFixed(0)}% win rate
            </p>
          )}
        </PulseCell>

        <PulseCell icon={Shield} label="Guardrails">
          <p
            className={cn(
              "text-sm font-semibold",
              status.guardrails.allOk ? "text-patience" : "text-impatience",
            )}
          >
            {status.guardrails.allOk ? "Nominal" : "Breached"}
          </p>
          <p className="text-[10px] font-mono text-foreground-dim mt-0.5">
            {status.guardrails.drawdownPercent.toFixed(1)}% drawdown
          </p>
        </PulseCell>

        <PulseCell icon={Clock} label="Next cycle" className="col-span-2 lg:col-span-1">
          <p className="text-lg font-bold tabular-nums text-signal">
            ~{minutesUntil(status.nextRunAt)}m
          </p>
          {status.behavioralMetrics && (
            <p className="text-[10px] font-mono text-foreground-dim mt-0.5 truncate">
              Conviction {status.behavioralMetrics.score}/100
            </p>
          )}
        </PulseCell>
      </div>
    </div>
  );
}

function PulseCell({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: typeof Activity;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("p-3 sm:p-4 min-w-0", className)}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3 h-3 text-foreground-dim shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim truncate">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
