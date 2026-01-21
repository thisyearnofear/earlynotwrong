"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TerminalProps {
  logs: string[];
  className?: string;
}

export function Terminal({ logs, className }: TerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      className={cn(
        "flex flex-col w-full h-full bg-black border border-border/50 rounded-lg overflow-hidden font-mono text-xs shadow-2xl",
        className,
      )}
    >
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50" />
        </div>
        <div className="text-[10px] text-foreground-muted tracking-widest uppercase">
          Agent_Trace_Log
        </div>
      </div>

      {/* Log Window */}
      <div
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto space-y-1 scroll-smooth min-h-75"
      >
        {logs.map((log, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "break-all",
              log.includes("ERROR") || log.includes("ABORTING")
                ? "text-red-500"
                : log.includes("WARNING")
                  ? "text-impatience"
                  : log.includes("SUCCESS") || log.includes("COMPLETE")
                    ? "text-patience"
                    : "text-signal/80",
            )}
          >
            <span className="opacity-50 mr-2">
              [{new Date().toISOString().split("T")[1].split(".")[0]}]
            </span>
            {log}
          </motion.div>
        ))}
        <div className="h-4 w-2 bg-signal/50 animate-pulse mt-1" />
      </div>
    </div>
  );
}
