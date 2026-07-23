"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { PipelineStep } from "@/lib/observability";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

function stepBarTone(status: PipelineStep["status"], isRunning?: boolean): string {
  if (isRunning) return "bg-signal/40 animate-pulse";
  if (status === "error") return "bg-impatience";
  if (status === "warn") return "bg-amber-400/90";
  if (status === "skipped") return "bg-foreground-dim/30";
  return "bg-signal";
}

function stepLabelTone(status: PipelineStep["status"], isRunning?: boolean): string {
  if (isRunning) return "text-signal";
  if (status === "error") return "text-impatience";
  if (status === "warn") return "text-amber-400";
  return "text-foreground-muted";
}

function formatStepMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

interface AgentCyclePipelineProps {
  steps: PipelineStep[];
  totalDurationMs: number;
  isRunning?: boolean;
  className?: string;
}

/** Mini 8-step waterfall — proportional bars, mobile scroll. */
export function AgentCyclePipeline({
  steps,
  totalDurationMs,
  isRunning = false,
  className,
}: AgentCyclePipelineProps) {
  const maxMs = Math.max(...steps.map((s) => s.durationMs), 1);

  return (
    <div className={cn("overflow-x-auto -mx-1 px-1 pb-1", className)}>
      <div className="flex gap-1 min-w-[520px]">
        {steps.map((step, i) => {
          const heightPct = isRunning
            ? 35
            : Math.max(12, Math.round((step.durationMs / maxMs) * 100));
          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.22, ease: EASE_OUT }}
              className="flex-1 min-w-0 flex flex-col items-center gap-1.5"
              title={
                isRunning
                  ? step.label
                  : `${step.label}: ${formatStepMs(step.durationMs)}`
              }
            >
              <div className="w-full h-14 flex items-end justify-center rounded-md bg-surface/40 border border-border/30 px-0.5 pt-1">
                <div
                  className={cn(
                    "w-full max-w-[2.5rem] rounded-sm transition-all duration-300",
                    stepBarTone(step.status, isRunning),
                  )}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span
                className={cn(
                  "text-[9px] font-mono uppercase tracking-wide truncate w-full text-center",
                  stepLabelTone(step.status, isRunning),
                )}
              >
                {step.label}
              </span>
              {!isRunning && step.durationMs > 0 && (
                <span className="text-[8px] font-mono text-foreground-dim tabular-nums">
                  {formatStepMs(step.durationMs)}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
      {!isRunning && totalDurationMs > 0 && (
        <p className="text-[9px] font-mono text-foreground-dim mt-2 text-center">
          {steps.length} steps · {formatStepMs(totalDurationMs)} total
        </p>
      )}
    </div>
  );
}

/** Ghost pipeline while a cycle is in flight. */
export function AgentCyclePipelineSkeleton({ className }: { className?: string }) {
  const labels = [
    "Portfolio",
    "Market",
    "Score",
    "Jury",
    "Positions",
    "Trade",
    "Anchor",
    "Wrap",
  ];
  return (
    <div className={cn("overflow-x-auto -mx-1 px-1", className)}>
      <div className="flex gap-1 min-w-[520px]">
        {labels.map((label) => (
          <div key={label} className="flex-1 flex flex-col items-center gap-1.5">
            <div className="w-full h-14 rounded-md bg-surface/30 border border-border/25 flex items-end justify-center p-1">
              <div className="w-full max-w-[2.5rem] h-[35%] rounded-sm bg-signal/25 animate-pulse" />
            </div>
            <span className="text-[9px] font-mono text-signal/80 uppercase tracking-wide animate-pulse">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
