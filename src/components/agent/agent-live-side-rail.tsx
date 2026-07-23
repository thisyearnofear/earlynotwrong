"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Radar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AgentCyclePipeline,
  AgentCyclePipelineSkeleton,
} from "@/components/agent/agent-cycle-pipeline";
import type { CycleObservability } from "@/components/agent/agent-observability-panel";

interface AgentLiveSideRailProps {
  juryPanel: ReactNode;
  observability?: CycleObservability | null;
  isRunning?: boolean;
  className?: string;
}

/** Right column on Live — jury + compact cycle pipeline so the grid stays balanced. */
export function AgentLiveSideRail({
  juryPanel,
  observability,
  isRunning = false,
  className,
}: AgentLiveSideRailProps) {
  const steps = observability?.pipelineSteps ?? [];
  const showPipeline = isRunning || steps.length > 0;

  return (
    <div className={cn("space-y-4", className)}>
      {juryPanel}

      {showPipeline && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.3 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <Radar className="w-3.5 h-3.5 text-signal" />
                Cycle pipeline
                <span className="ml-auto text-[9px] font-mono text-foreground-dim normal-case tracking-normal">
                  last run
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {isRunning ? (
                <AgentCyclePipelineSkeleton />
              ) : (
                <AgentCyclePipeline
                  steps={steps}
                  totalDurationMs={observability?.durationMs ?? 0}
                />
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
