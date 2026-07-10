"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TerminalProps {
  logs: string[];
  className?: string;
}

export function Terminal({ logs, className }: TerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [simplified, setSimplified] = useState(false);

  // Record a real timestamp for each log line when it first appears, so the
  // audit-log times are stable across re-renders. Keyed by position in the
  // append-only `logs` array; the stream resetting truncates stale entries.
  const [timestamps, setTimestamps] = useState<string[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimestamps((prev) => {
      if (prev.length === logs.length) return prev;
      if (prev.length > logs.length) return prev.slice(0, logs.length);
      const now = new Date().toISOString().split("T")[1].split(".")[0];
      return [...prev, ...Array(logs.length - prev.length).fill(now)];
    });
  }, [logs.length]);

  // Pair each line with its original index so filtered views keep stable
  // keys and timestamps.
  const entries = useMemo(
    () => logs.map((log, index) => ({ log, index })),
    [logs],
  );

  // In simplified mode, filter to only key status lines
  const displayLogs = useMemo(() => {
    if (!simplified) return entries;
    return entries.filter(
      ({ log }) =>
        log.includes("CONVICTION_SCORE") ||
        log.includes("ETHOS_SCORE") ||
        log.includes("UNIFIED_TRUST_SCORE") ||
        log.includes("ETHOS_SCORE_FOUND") ||
        log.includes("ANALYSIS COMPLETE") ||
        log.includes("SUCCESS") ||
        log.includes("ERROR") ||
        log.includes("ABORTING") ||
        log.includes("WARNING") ||
        log.includes("COMPLETE") ||
        log.includes("> NETWORK:") ||
        log.includes("> FOUND") ||
        log.includes("> IDENTIFIED") ||
        log.includes("> TARGET:") ||
        log.includes("> TIME_HORIZON") ||
        log.includes("INSUFFICIENT") ||
        log.includes("CACHED ANALYSIS")
    );
  }, [entries, simplified]);

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      setMounted(true);
    });

    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }

    return () => cancelAnimationFrame(handle);
  }, [displayLogs]);

  return (
    <div
      className={cn(
        "flex flex-col w-full h-full bg-surface border border-border rounded-lg overflow-hidden font-mono text-xs shadow-2xl",
        className,
      )}
    >
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-hover border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50" />
        </div>
        <div className="flex items-center gap-3">
          {/* Simplified/Advanced segmented control */}
          <div
            role="group"
            aria-label="Log detail level"
            className="flex items-center rounded border border-border overflow-hidden"
          >
            <button
              onClick={() => setSimplified(true)}
              aria-pressed={simplified}
              className={cn(
                "text-[9px] tracking-wider uppercase px-2 py-0.5 transition-all",
                simplified
                  ? "bg-signal/10 text-signal"
                  : "text-foreground-muted hover:text-foreground",
              )}
            >
              Simple
            </button>
            <button
              onClick={() => setSimplified(false)}
              aria-pressed={!simplified}
              className={cn(
                "text-[9px] tracking-wider uppercase px-2 py-0.5 border-l border-border transition-all",
                !simplified
                  ? "bg-signal/10 text-signal"
                  : "text-foreground-muted hover:text-foreground",
              )}
            >
              Adv
            </button>
          </div>
          <div className="text-[10px] text-foreground-muted tracking-widest uppercase">
            Agent_Trace_Log // Multi_Chain_Oracle_v1.0
          </div>
        </div>
      </div>

      {/* Log Window */}
      <div
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto space-y-1 scroll-smooth min-h-75"
      >
        {displayLogs.length === 0 && simplified ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-2 py-12">
            <div className="w-2 h-2 bg-signal animate-pulse rounded-full" />
            <p className="text-[10px] text-foreground-muted">Waiting for key signals...</p>
            <button
              onClick={() => setSimplified(false)}
              className="text-[9px] text-signal hover:underline mt-2"
            >
              Switch to Advanced view
            </button>
          </div>
        ) : (
          displayLogs.map(({ log, index }) => {
          const isNetworkLog = log.startsWith("> NETWORK:");
          const network = isNetworkLog ? log.split(":")[1].trim() : "";

          return (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "break-all",
                log.includes("ERROR") ||
                  log.includes("ABORTING") ||
                  log.includes("WARNING")
                  ? "text-impatience"
                  : log.includes("SUCCESS") || log.includes("COMPLETE")
                    ? "text-patience"
                    : "text-signal",
              )}
            >
              <span className="opacity-50 mr-2">
                [{mounted ? timestamps[index] ?? "--:--:--" : "--:--:--"}]
              </span>
              {isNetworkLog ? (
                <>
                  {"> NETWORK: "}
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-bold",
                      network === "SOLANA_MAINNET"
                        ? "bg-purple-500/20 text-purple-400"
                        : "bg-blue-500/20 text-blue-400",
                    )}
                  >
                    {network}
                  </span>
                </>
              ) : (
                log
              )}
            </motion.div>
          );
        }))}
        <div className="h-4 w-2 bg-signal animate-pulse mt-1" />
      </div>
    </div>
  );
}
