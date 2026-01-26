"use client";

import * as React from "react";
import { useAppStore } from "@/lib/store";
import { Clock, DollarSign, Filter } from "lucide-react";
import { Button } from "@/components/ui/button"; // Button exists
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

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
                                        step="30" // Steps of 30 ensures 30, 60, 90...
                                        // Store expects 30 | 90 | 180 | 365
                                        // We'll map nearest valid value or allow flexible if store permits
                                        value={parameters.timeHorizon}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            // Snap to valid values
                                            let snapVal: 30 | 90 | 180 | 365 = 180;
                                            if (val <= 60) snapVal = 30;
                                            else if (val <= 135) snapVal = 90;
                                            else if (val <= 270) snapVal = 180;
                                            else snapVal = 365;

                                            setParameters({ timeHorizon: snapVal });
                                        }}
                                        className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-signal"
                                    />
                                    <div className="flex justify-between text-[10px] text-foreground-muted font-mono">
                                        <span>30d</span>
                                        <span>365d</span>
                                    </div>
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
                                    <div className="flex justify-between text-[10px] text-foreground-muted font-mono">
                                        <span>$0</span>
                                        <span>$5k+</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
