"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";

interface ScanProgressProps {
  className?: string;
}

const phaseConfig = {
  idle: {
    label: "",
    color: "text-foreground-muted",
  },
  connecting: {
    label: "CONNECTING TO BLOCKCHAIN",
    color: "text-signal",
  },
  fetching: {
    label: "FETCHING TRADE HISTORY",
    color: "text-signal",
  },
  processing: {
    label: "PROCESSING POSITIONS",
    color: "text-signal",
  },
  analyzing: {
    label: "ANALYZING CONVICTION",
    color: "text-signal",
  },
  anchoring: {
    label: "ANCHORING TO MANTLE",
    color: "text-[#65b3ae]",
  },
  complete: {
    label: "ANALYSIS COMPLETE",
    color: "text-patience",
  },
};

export function ScanProgress({ className }: ScanProgressProps) {
  const { scanProgress } = useAppStore();

  const { phase, percent, detail } = scanProgress;
  const config = phaseConfig[phase];

  // Don't render if idle
  if (phase === "idle") return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn(
        "w-full font-mono text-xs border border-border rounded-lg overflow-hidden",
        className
      )}
    >
      {/* Header with phase label */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-hover border-b border-border">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className={cn(
              "w-2 h-2 rounded-full bg-signal",
              phase === "anchoring" && "bg-[#65b3ae]",
              phase === "complete" && "bg-patience"
            )}
          />
          <span className={cn("text-[10px] tracking-widest", config.color)}>
            {config.label}
          </span>
        </div>
        <span className="text-[10px] text-foreground-muted">
          {Math.round(percent)}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-1 w-full bg-surface">
        <motion.div
          className={cn(
            "absolute inset-y-0 left-0 bg-signal",
            phase === "anchoring" && "bg-[#65b3ae]",
            phase === "complete" && "bg-patience"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>

      {/* Detail text */}
      <div className="px-3 py-2 bg-surface">
        <p className="text-[10px] text-foreground-muted truncate">
          {detail}
        </p>
      </div>
    </motion.div>
  );
}
