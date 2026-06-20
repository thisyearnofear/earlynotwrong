"use client";

import * as React from "react";
import { useAppStore } from "@/lib/store";
import { Clock, DollarSign, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// Tick positions for the time horizon slider (showing valid snap values)
const TIME_TICKS = [
  { value: 30, label: "30d" },
  { value: 90, label: "3mo" },
  { value: 180, label: "6mo" },
  { value: 365, label: "1y" },
];

// Tick positions for the min trade value slider
const VALUE_TICKS = [
  { value: 0, label: "$0" },
  { value: 1000, label: "$1K" },
  { value: 2000, label: "$2K" },
  { value: 3000, label: "$3K" },
  { value: 4000, label: "$4K" },
  { value: 5000, label: "$5K+" },
];

function SliderTicks({
  ticks,
  min,
  max,
  currentValue,
  onSelect,
}: {
  ticks: { value: number; label: string }[];
  min: number;
  max: number;
  currentValue: number;
  onSelect?: (value: number) => void;
}) {
  const range = max - min;
  // Inset from the container edges to align with the visible range input track
  // (native range inputs inset the track by ~8px on each side for the thumb)
  return (
    <div className="relative w-full h-4 px-[10px]">
      {/* Clickable tick marks */}
      <div className="relative w-full h-full">
        {ticks.map((tick) => {
          const pct = ((tick.value - min) / range) * 100;
          const isActive = currentValue >= tick.value;
          return (
            <div
              key={tick.value}
              className="absolute flex flex-col items-center"
              style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
            >
              <button
                type="button"
                onClick={() => onSelect?.(tick.value)}
                className={cn(
                  "flex flex-col items-center group cursor-pointer transition-all",
                )}
              >
                <div
                  className={cn(
                    "w-px h-1.5 transition-all",
                    isActive ? "bg-foreground/40" : "bg-foreground/15",
                    "group-hover:h-2.5 group-hover:bg-foreground/60",
                  )}
                />
                <span
                  className={cn(
                    "text-[8px] font-mono mt-0.5 whitespace-nowrap transition-all",
                    isActive
                      ? "text-foreground-muted/70"
                      : "text-foreground-dim/50",
                    "group-hover:text-foreground/80 group-hover:scale-110",
                  )}
                >
                  {tick.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AnalysisFilters({ className }: { className?: string }) {
    const { parameters, setParameters } = useAppStore();
    const [isOpen, setIsOpen] = React.useState(false);

    // Presets for quick selection
    const presets = {
        conservative: { timeHorizon: 365 as const, minTradeValue: 1000 },
        active: { timeHorizon: 90 as const, minTradeValue: 100 },
        degen: { timeHorizon: 30 as const, minTradeValue: 0 },
    };

    return (
        <div className={cn("w-full space-y-2", className)}>
            <div className="flex justify-center">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsOpen(!isOpen)}
                    className={cn(
                        "text-xs font-mono text-foreground-muted hover:text-foreground flex items-center gap-2",
                        isOpen && "text-signal bg-signal/10"
                    )}
                >
                    <Filter className="w-3 h-3" />
                    {isOpen ? "HIDE FILTERS" : "ADVANCED FILTERS"}
                </Button>
            </div>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="p-4 rounded-xl border border-border bg-surface/50 backdrop-blur-sm space-y-6">

                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setParameters(presets.active)}
                                    className="text-[10px] font-mono border-border/50 hover:border-signal/50 h-7"
                                >
                                    Active Trader
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setParameters(presets.degen)}
                                    className="text-[10px] font-mono border-border/50 hover:border-signal/50 h-7"
                                >
                                    Degen Scan
                                </Button>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs font-mono text-foreground-muted">
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-3 h-3 text-signal" />
                                            <span>TIME HORIZON</span>
                                        </div>
                                        <span className="text-foreground">{parameters.timeHorizon} DAYS</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="30"
                                        max="365"
                                        step="30"
                                        value={parameters.timeHorizon}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            let snapVal: 30 | 90 | 180 | 365 = 180;
                                            if (val <= 60) snapVal = 30;
                                            else if (val <= 135) snapVal = 90;
                                            else if (val <= 270) snapVal = 180;
                                            else snapVal = 365;

                                            setParameters({ timeHorizon: snapVal });
                                        }}
                                        className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-signal"
                                    />
                                    <SliderTicks
                                        ticks={TIME_TICKS}
                                        min={30}
                                        max={365}
                                        currentValue={parameters.timeHorizon}
                                        onSelect={(val) => setParameters({ timeHorizon: val as 30 | 90 | 180 | 365 })}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs font-mono text-foreground-muted">
                                        <div className="flex items-center gap-2">
                                            <DollarSign className="w-3 h-3 text-signal" />
                                            <span>MIN TRADE VALUE</span>
                                        </div>
                                        <span className="text-foreground">${parameters.minTradeValue}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="5000"
                                        step="50"
                                        value={parameters.minTradeValue}
                                        onChange={(e) =>
                                            setParameters({ minTradeValue: parseInt(e.target.value) })
                                        }
                                        className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-signal"
                                    />
                                    <SliderTicks
                                        ticks={VALUE_TICKS}
                                        min={0}
                                        max={5000}
                                        currentValue={parameters.minTradeValue}
                                        onSelect={(val) => setParameters({ minTradeValue: val })}
                                    />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
