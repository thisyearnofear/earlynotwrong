"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ExternalLink,
  Copy,
  Check,
  Radar,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatCycleDuration,
  getSignozUrl,
  signozHomeUrl,
  signozTraceUrl,
} from "@/lib/signoz";
import { buildCycleNarrative } from "@/lib/observability";
import {
  AgentCyclePipeline,
  AgentCyclePipelineSkeleton,
} from "@/components/agent/agent-cycle-pipeline";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export interface PipelineStepSnapshot {
  id: string;
  label: string;
  durationMs: number;
  status: "ok" | "warn" | "error" | "skipped";
}

export interface CycleObservability {
  cycle: number;
  completedAt: number;
  durationMs: number;
  traceId: string | null;
  spanId: string | null;
  otelEnabled: boolean;
  portfolioUsd: number;
  drawdownPercent: number;
  activePositions: number;
  regimeScore: number | null;
  tradesSucceeded: number;
  tradesFailed: number;
  guardrailsRejected: number;
  anchorOutcomes: Array<{ adapter: string; status: string }>;
  pipelineSteps: PipelineStepSnapshot[];
}

interface AgentObservabilityPanelProps {
  observability: CycleObservability | null | undefined;
  agentStatus?: string;
  nextRunAt?: number;
  prevDurationMs?: number | null;
  isDemo?: boolean;
  className?: string;
}

function MetricTile({
  label,
  value,
  sub,
  tone = "default",
  delay = 0,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "good";
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.22, ease: EASE_OUT }}
      className="rounded-lg border border-border/40 bg-surface/30 px-3 py-2.5"
    >
      <p className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim">
        {label}
      </p>
      <p
        className={cn(
          "text-sm font-semibold tabular-nums mt-0.5",
          tone === "warn" && "text-impatience",
          tone === "good" && "text-patience",
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[10px] font-mono text-foreground-dim mt-0.5">{sub}</p>
      )}
    </motion.div>
  );
}

function anchorStatusTone(status: string): string {
  if (status === "success") return "text-patience border-patience/30 bg-patience/5";
  if (status === "failed") return "text-impatience border-impatience/30 bg-impatience/5";
  return "text-foreground-dim border-border/40 bg-surface/20";
}

function minutesUntil(ts: number): number {
  return Math.max(0, Math.round((ts - Date.now()) / 60_000));
}

export function AgentObservabilityPanel({
  observability,
  agentStatus = "idle",
  nextRunAt,
  prevDurationMs,
  isDemo = false,
  className,
}: AgentObservabilityPanelProps) {
  const signozUrl = getSignozUrl();
  const [copied, setCopied] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);

  const isRunning = agentStatus === "running";
  const traceUrl =
    observability?.traceId != null
      ? signozTraceUrl(observability.traceId)
      : null;

  const copyTraceId = useCallback(async () => {
    if (!observability?.traceId) return;
    try {
      await navigator.clipboard.writeText(observability.traceId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }, [observability?.traceId]);

  const otelOn = observability?.otelEnabled === true;
  const hasSnapshot =
    observability != null &&
    observability.cycle > 0 &&
    (observability.pipelineSteps?.length ?? 0) > 0;

  const narrative =
    hasSnapshot && observability
      ? buildCycleNarrative(observability, prevDurationMs)
      : null;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
        <span className="inline-flex items-center gap-1.5 text-foreground-muted">
          <span
            className={cn(
              "inline-block w-2 h-2 rounded-full",
              isRunning && "animate-pulse",
              isRunning || otelOn
                ? "bg-signal shadow-[0_0_8px_var(--signal)]"
                : "bg-foreground-dim",
            )}
          />
          {isRunning ? "Cycle tracing…" : otelOn ? "OTel export on" : "OTel export off"}
        </span>
        {isDemo && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-signal/25 text-signal bg-signal/5">
            demo snapshot
          </span>
        )}
        {signozUrl && (
          <a
            href={signozHomeUrl() ?? signozUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-signal hover:underline"
          >
            Open SigNoz
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {isRunning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2"
        >
          <p className="text-sm text-foreground-muted">
            Pipeline in progress — spans export to SigNoz when the cycle completes.
          </p>
          <AgentCyclePipelineSkeleton />
        </motion.div>
      )}

      {!isRunning && !hasSnapshot && (
        <div className="rounded-lg border border-dashed border-border/50 bg-surface/15 p-4 space-y-3">
          <AgentCyclePipelineSkeleton />
          <p className="text-sm text-foreground-muted leading-relaxed">
            {otelOn
              ? "Waiting for the first traced cycle."
              : "Enable OTel on the agent to see step timings and trace links here."}
            {nextRunAt != null && nextRunAt > Date.now() && (
              <>
                {" "}
                Next run in ~{minutesUntil(nextRunAt)}m.
              </>
            )}
          </p>
        </div>
      )}

      {!isRunning && hasSnapshot && observability && (
        <>
          {narrative && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="text-sm text-foreground leading-relaxed border-l-2 border-signal/40 pl-3"
            >
              {narrative}
            </motion.p>
          )}

          {observability.pipelineSteps.length > 0 && (
            <AgentCyclePipeline
              steps={observability.pipelineSteps}
              totalDurationMs={observability.durationMs}
            />
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricTile
              label="Drawdown"
              value={`${observability.drawdownPercent.toFixed(1)}%`}
              sub="cap 25%"
              tone={observability.drawdownPercent >= 15 ? "warn" : "default"}
              delay={0.05}
            />
            <MetricTile
              label="Regime"
              value={
                observability.regimeScore != null
                  ? `${observability.regimeScore}/100`
                  : "—"
              }
              sub={`${observability.activePositions} positions`}
              delay={0.1}
            />
            <MetricTile
              label="Trades"
              value={`${observability.tradesSucceeded} ok`}
              sub={
                observability.tradesFailed > 0
                  ? `${observability.tradesFailed} failed`
                  : observability.guardrailsRejected > 0
                    ? `${observability.guardrailsRejected} blocked`
                    : "none this cycle"
              }
              tone={
                observability.tradesFailed > 0
                  ? "warn"
                  : observability.tradesSucceeded > 0
                    ? "good"
                    : "default"
              }
              delay={0.15}
            />
            <MetricTile
              label="Duration"
              value={formatCycleDuration(observability.durationMs)}
              sub={
                prevDurationMs != null && observability.durationMs < prevDurationMs
                  ? `↓ ${formatCycleDuration(prevDurationMs - observability.durationMs)}`
                  : undefined
              }
              delay={0.2}
            />
          </div>

          {observability.anchorOutcomes.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              <p className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim mb-2">
                Anchors
              </p>
              <div className="flex flex-wrap gap-1.5">
                {observability.anchorOutcomes.map((a) => (
                  <span
                    key={`${a.adapter}-${a.status}`}
                    className={cn(
                      "text-[10px] font-mono px-2 py-0.5 rounded-full border transition-shadow duration-300",
                      anchorStatusTone(a.status),
                      a.status === "success" &&
                        "shadow-[0_0_12px_-4px_var(--patience)]",
                    )}
                  >
                    {a.adapter} · {a.status}
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          {(traceUrl || observability.traceId) && (
            <div className="rounded-lg border border-signal/20 bg-signal/[0.04] p-3 space-y-3">
              {traceUrl ? (
                <a
                  href={traceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-lg bg-signal/15 border border-signal/30 text-sm font-medium text-signal hover:bg-signal/20 transition-colors active:scale-[0.98]"
                >
                  <Radar className="w-4 h-4" />
                  Watch cycle #{observability.cycle} in SigNoz
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </a>
              ) : (
                <p className="text-xs text-foreground-dim font-mono">
                  Trace captured — set NEXT_PUBLIC_SIGNOZ_URL for one-click links.
                </p>
              )}

              {observability.traceId && (
                <div>
                  <button
                    type="button"
                    onClick={() => setTraceOpen((v) => !v)}
                    className="flex items-center gap-1 text-[10px] font-mono text-foreground-dim hover:text-foreground-muted"
                  >
                    <ChevronDown
                      className={cn(
                        "w-3 h-3 transition-transform duration-200",
                        traceOpen && "rotate-180",
                      )}
                    />
                    Trace ID
                  </button>
                  <AnimatePresence initial={false}>
                    {traceOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <code className="text-[10px] font-mono text-foreground/80 break-all flex-1 min-w-0">
                            {observability.traceId}
                          </code>
                          <button
                            type="button"
                            onClick={() => void copyTraceId()}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/50 text-[10px] font-mono text-foreground-muted hover:text-signal transition-colors"
                          >
                            {copied ? (
                              <Check className="w-3 h-3 text-patience" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            {copied ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
