"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Activity,
  DollarSign,
  Signal,
  Shield,
  Clock,
  Radar,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCycleDuration, signozTraceUrl } from "@/lib/signoz";
import {
  AgentSectionNav,
  VIEW_CONTEXT,
  type AgentView,
  type AgentTabBadges,
} from "@/components/agent/agent-section-nav";
import { AgentHealthGrid, type AgentHealthStatus } from "@/components/agent/agent-health-grid";
import { AgentObservabilityPanel, type CycleObservability } from "@/components/agent/agent-observability-panel";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export type StripExpand = "health" | "trace" | null;

interface PulseConviction {
  regime?: { score: number; label: string } | null;
  signals: Array<{ symbol: string; score: number }>;
}

interface AgentCommandStripProps {
  status: AgentHealthStatus;
  conviction: PulseConviction | null;
  observability: CycleObservability | null;
  prevDurationMs?: number | null;
  isDemoObs?: boolean;
  active: AgentView;
  onViewChange: (view: AgentView) => void;
  tabBadges?: AgentTabBadges;
  showNav?: boolean;
  demoMode?: boolean;
  className?: string;
}

function formatPortfolio(n: number): string {
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

function MetricCell({
  icon: Icon,
  label,
  children,
  className,
  onClick,
  active,
}: {
  icon: typeof Activity;
  label: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "p-2.5 sm:p-3 min-w-0 text-left transition-colors duration-200",
        onClick && "hover:bg-surface/40 cursor-pointer",
        active && "bg-signal/5",
        className,
      )}
    >
      <div className="flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3 text-foreground-dim shrink-0" />
        <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim truncate">
          {label}
        </span>
        {onClick && (
          <ChevronDown
            className={cn(
              "w-3 h-3 ml-auto text-foreground-dim transition-transform duration-200",
              active && "rotate-180 text-signal",
            )}
          />
        )}
      </div>
      {children}
    </Tag>
  );
}

/**
 * Unified command surface — metrics, tabs, and fold-out health/trace (Japandi strip).
 */
export function AgentCommandStrip({
  status,
  conviction,
  observability,
  prevDurationMs,
  isDemoObs,
  active,
  onViewChange,
  tabBadges,
  showNav = true,
  demoMode = false,
  className,
}: AgentCommandStripProps) {
  const [expand, setExpand] = useState<StripExpand>(demoMode ? "trace" : null);

  const topSignal = conviction?.signals[0];
  const isRunning = status.status === "running";
  const traceUrl =
    observability?.traceId != null
      ? signozTraceUrl(observability.traceId)
      : null;

  const toggle = (key: StripExpand) =>
    setExpand((current) => (current === key ? null : key));

  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-surface/30 overflow-hidden",
        className,
      )}
    >
      {/* Metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-border/35">
        <MetricCell icon={Activity} label="Status">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                status.status === "idle" ? "bg-patience" : "bg-signal animate-pulse",
              )}
            />
            <span className="text-sm font-semibold capitalize truncate">{status.status}</span>
          </div>
          <p className="text-[10px] font-mono text-foreground-dim mt-0.5">#{status.cycle}</p>
        </MetricCell>

        <MetricCell icon={DollarSign} label="Portfolio">
          <p className="text-base sm:text-lg font-bold tabular-nums truncate">
            {formatPortfolio(status.portfolio.totalValueUsd)}
          </p>
          <p className="text-[10px] font-mono text-foreground-dim mt-0.5">
            {status.portfolio.positions} pos
          </p>
        </MetricCell>

        <MetricCell icon={Signal} label="Signal">
          {topSignal ? (
            <>
              <p className="text-base font-bold tabular-nums truncate">
                {topSignal.symbol}
                <span className="text-signal ml-1">{topSignal.score}</span>
              </p>
              {conviction?.regime && (
                <p className="text-[10px] font-mono text-foreground-dim mt-0.5 truncate">
                  {conviction.regime.score}/100
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-foreground-muted">—</p>
          )}
        </MetricCell>

        <MetricCell
          icon={Shield}
          label="Health"
          onClick={() => toggle("health")}
          active={expand === "health"}
          className="hidden sm:block"
        >
          <p
            className={cn(
              "text-sm font-semibold",
              status.guardrails.allOk ? "text-patience" : "text-impatience",
            )}
          >
            {status.guardrails.allOk ? "Nominal" : "Alert"}
          </p>
          <p className="text-[10px] font-mono text-foreground-dim mt-0.5">
            {status.guardrails.drawdownPercent.toFixed(1)}% DD
          </p>
        </MetricCell>

        <MetricCell icon={Clock} label="Next" className="hidden lg:block">
          <p className="text-base font-bold tabular-nums text-signal">
            ~{minutesUntil(status.nextRunAt)}m
          </p>
        </MetricCell>

        <MetricCell
          icon={Radar}
          label="Trace"
          onClick={() => toggle("trace")}
          active={expand === "trace"}
          className="col-span-2 sm:col-span-1"
        >
          {isRunning ? (
            <p className="text-sm font-semibold text-signal animate-pulse">Live</p>
          ) : observability?.durationMs ? (
            <p className="text-sm font-semibold tabular-nums">
              {formatCycleDuration(observability.durationMs)}
            </p>
          ) : (
            <p className="text-sm text-foreground-muted">—</p>
          )}
          {traceUrl ? (
            <Link
              href={traceUrl}
              target="_blank"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] font-mono text-signal hover:underline mt-0.5 inline-block"
            >
              SigNoz →
            </Link>
          ) : (
            <p className="text-[10px] font-mono text-foreground-dim mt-0.5">
              {observability?.otelEnabled ? "awaiting" : "OTel off"}
            </p>
          )}
        </MetricCell>
      </div>

      {/* Nav + mobile expand toggles */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-2 border-t border-border/35 bg-surface/15">
        {showNav && (
          <AgentSectionNav
            active={active}
            onChange={onViewChange}
            badges={tabBadges}
            embedded
            showContext={false}
            className="flex-1 min-w-0"
          />
        )}
        <div className="flex items-center gap-1 sm:hidden ml-auto">
          <button
            type="button"
            onClick={() => toggle("health")}
            className={cn(
              "px-2 py-1 rounded-md text-[10px] font-mono border transition-colors",
              expand === "health"
                ? "border-signal/40 text-signal bg-signal/10"
                : "border-border/40 text-foreground-dim",
            )}
          >
            Health
          </button>
          <button
            type="button"
            onClick={() => toggle("trace")}
            className={cn(
              "px-2 py-1 rounded-md text-[10px] font-mono border transition-colors",
              expand === "trace"
                ? "border-signal/40 text-signal bg-signal/10"
                : "border-border/40 text-foreground-dim",
            )}
          >
            Trace
          </button>
        </div>
      </div>

      <p className="px-3 pb-2 text-[10px] text-foreground-dim leading-relaxed border-t border-border/25 bg-surface/10">
        {VIEW_CONTEXT[active]}
      </p>

      {/* Murphy-desk expand */}
      <AnimatePresence initial={false}>
        {expand === "health" && (
          <motion.div
            key="health-expand"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="overflow-hidden border-t border-border/35"
          >
            <div className="p-3">
              <AgentHealthGrid status={status} animated={demoMode} />
            </div>
          </motion.div>
        )}
        {expand === "trace" && (
          <motion.div
            key="trace-expand"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="overflow-hidden border-t border-border/35"
          >
            <div className="p-3">
              <AgentObservabilityPanel
                observability={observability}
                agentStatus={status.status}
                nextRunAt={status.nextRunAt}
                prevDurationMs={prevDurationMs}
                isDemo={isDemoObs}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
