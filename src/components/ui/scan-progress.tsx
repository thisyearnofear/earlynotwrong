"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import { Loader2, Database, Search, Brain, CheckCircle2, Wifi } from "lucide-react";

interface ScanProgressProps {
  className?: string;
}

const phaseConfig = {
  idle: {
    icon: null,
    label: "Ready",
    color: "text-foreground-muted",
    bgColor: "bg-surface",
  },
  connecting: {
    icon: Wifi,
    label: "Connecting",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
  },
  fetching: {
    icon: Database,
    label: "Fetching Data",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
  },
  processing: {
    icon: Search,
    label: "Processing",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
  },
  analyzing: {
    icon: Brain,
    label: "Analyzing",
    color: "text-signal",
    bgColor: "bg-signal/10",
  },
  complete: {
    icon: CheckCircle2,
    label: "Complete",
    color: "text-patience",
    bgColor: "bg-patience/10",
  },
};

export function ScanProgress({ className }: ScanProgressProps) {
  const { scanProgress } = useAppStore();

  const { phase, percent, detail, itemsProcessed, totalItems } = scanProgress;
  const config = phaseConfig[phase];
  const Icon = config.icon;

  // Don't render if idle and not analyzing
  if (phase === "idle") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "w-full rounded-lg border border-border bg-surface/80 backdrop-blur-sm overflow-hidden",
        className
      )}
    >
      {/* Progress Bar */}
      <div className="relative h-1 w-full bg-surface-hover">
        <motion.div
          className={cn(
            "absolute inset-y-0 left-0 transition-all duration-500",
            phase === "fetching" && "bg-amber-500",
            phase === "processing" && "bg-purple-500",
            phase === "analyzing" && "bg-signal",
            phase === "complete" && "bg-patience"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        {/* Animated shimmer effect during active phases */}
        {(phase === "fetching" || phase === "processing" || phase === "analyzing") && (
          <motion.div
            className="absolute inset-y-0 w-20 bg-gradient-to-r from-transparent via-white/30 to-transparent"
            animate={{ x: ["-100%", "400%"] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-center gap-3">
          {/* Phase Icon */}
          <div
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-300",
              config.bgColor
            )}
          >
            {Icon && (
              <motion.div
                animate={
                  phase !== "complete"
                    ? { rotate: 360 }
                    : { scale: [1, 1.2, 1] }
                }
                transition={
                  phase !== "complete"
                    ? { duration: 2, repeat: Infinity, ease: "linear" }
                    : { duration: 0.3 }
                }
              >
                <Icon className={cn("w-5 h-5", config.color)} />
              </motion.div>
            )}
          </div>

          {/* Text Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("text-sm font-medium", config.color)}>
                {config.label}
              </span>
              <span className="text-xs text-foreground-muted">
                {Math.round(percent)}%
              </span>
            </div>
            <p className="text-xs text-foreground-muted truncate">
              {detail}
            </p>
          </div>

          {/* Items Counter (when available) */}
          {totalItems > 0 && (
            <div className="text-right">
              <span className="text-xs font-mono text-foreground-muted">
                {itemsProcessed}/{totalItems}
              </span>
            </div>
          )}
        </div>

        {/* Animated dots for active phases */}
        {(phase === "fetching" || phase === "processing" || phase === "analyzing") && (
          <div className="flex items-center gap-1 mt-3">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className={cn("w-1.5 h-1.5 rounded-full", config.color.replace("text-", "bg-"))}
                animate={{
                  scale: [1, 1.5, 1],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.2,
                }}
              />
            ))}
            <span className="ml-2 text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
              {phase === "fetching" && "Retrieving blockchain data"}
              {phase === "processing" && "Parsing transactions"}
              {phase === "analyzing" && "Computing conviction metrics"}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
