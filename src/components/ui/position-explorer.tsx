"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { PositionAnalysis } from "@/lib/api-client";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  AlertTriangle,
  ExternalLink,
  Users,
} from "lucide-react";
import { EthosGatedContent } from "@/components/ui/ethos-gated-content";

interface PositionExplorerProps {
  positions: PositionAnalysis[];
  chain: "solana" | "base";
  className?: string;
}

interface PositionCardProps {
  position: PositionAnalysis;
  chain: "solana" | "base";
  isExpanded: boolean;
  onToggle: () => void;
}

function PositionCard({
  position,
  chain,
  isExpanded,
  onToggle,
}: PositionCardProps) {
  const isProfitable = position.realizedPnL > 0;
  const hasCounterfactual =
    position.counterfactual && position.counterfactual.missedGainDollars > 0;

  const explorerUrl =
    chain === "solana"
      ? `https://solscan.io/token/${position.tokenAddress}`
      : `https://basescan.org/token/${position.tokenAddress}`;

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: val < 1 ? 4 : 2,
    }).format(val);

  const formatPercent = (val: number) =>
    `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });

  return (
    <motion.div
      layout
      className={cn(
        "border border-border rounded-lg overflow-hidden transition-colors",
        isExpanded ? "bg-surface/60" : "bg-surface/30 hover:bg-surface/50"
      )}
    >
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-4">
          {position.metadata?.logoUri ? (
            <img
              src={position.metadata.logoUri}
              alt={position.tokenSymbol || "Token"}
              className="w-10 h-10 rounded-full bg-surface"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-surface-hover flex items-center justify-center text-xs font-mono text-foreground-muted">
              {position.tokenSymbol?.slice(0, 3) || "???"}
            </div>
          )}

          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                {position.metadata?.name || position.tokenSymbol || "Unknown"}
              </span>
              <span className="text-xs font-mono text-foreground-muted">
                {position.tokenSymbol}
              </span>
              {position.isEarlyExit && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-impatience/20 text-impatience rounded">
                  EARLY EXIT
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-foreground-muted mt-1">
              <span>
                <Clock className="w-3 h-3 inline mr-1" />
                {position.holdingPeriodDays}d held
              </span>
              <span>
                Entry: {formatCurrency(position.entryDetails.avgPrice)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div
              className={cn(
                "font-mono font-semibold",
                isProfitable ? "text-patience" : "text-impatience"
              )}
            >
              {formatCurrency(position.realizedPnL)}
            </div>
            <div
              className={cn(
                "text-xs font-mono",
                isProfitable ? "text-patience/70" : "text-impatience/70"
              )}
            >
              {formatPercent(position.realizedPnLPercent)}
            </div>
          </div>

          {hasCounterfactual && (
            <div className="text-right border-l border-border pl-4">
              <div className="text-xs text-foreground-muted uppercase tracking-wider">
                Missed
              </div>
              <div className="font-mono text-impatience">
                {formatCurrency(position.counterfactual!.missedGainDollars)}
              </div>
            </div>
          )}

          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-foreground-muted" />
          ) : (
            <ChevronDown className="w-5 h-5 text-foreground-muted" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 border-t border-border">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
                <div>
                  <div className="text-xs text-foreground-muted uppercase tracking-wider mb-1">
                    Total Invested
                  </div>
                  <div className="font-mono text-foreground">
                    {formatCurrency(position.entryDetails.totalValue)}
                  </div>
                  <div className="text-xs text-foreground-muted">
                    {position.entryDetails.totalAmount.toLocaleString()} tokens
                  </div>
                </div>

                <div>
                  <div className="text-xs text-foreground-muted uppercase tracking-wider mb-1">
                    Total Realized
                  </div>
                  <div className="font-mono text-foreground">
                    {position.exitDetails
                      ? formatCurrency(position.exitDetails.totalValue)
                      : "—"}
                  </div>
                  <div className="text-xs text-foreground-muted">
                    {position.exitDetails
                      ? `${position.exitDetails.totalAmount.toLocaleString()} tokens`
                      : "Active position"}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-foreground-muted uppercase tracking-wider mb-1">
                    Current Price
                  </div>
                  <div className="font-mono text-foreground">
                    {formatCurrency(position.currentPrice)}
                  </div>
                  <div
                    className={cn(
                      "text-xs font-mono",
                      position.priceChange24h >= 0
                        ? "text-patience"
                        : "text-impatience"
                    )}
                  >
                    {formatPercent(position.priceChange24h)} 24h
                  </div>
                </div>

                <div>
                  <div className="text-xs text-foreground-muted uppercase tracking-wider mb-1">
                    Patience Tax
                  </div>
                  <div
                    className={cn(
                      "font-mono",
                      position.patienceTax > 0
                        ? "text-impatience"
                        : "text-foreground"
                    )}
                  >
                    {formatCurrency(position.patienceTax)}
                  </div>
                  {position.maxMissedGain > 0 && (
                    <div className="text-xs text-foreground-muted">
                      {formatPercent(position.maxMissedGain)} max missed
                    </div>
                  )}
                </div>
              </div>

              {hasCounterfactual && (
                <div className="mt-2 p-3 rounded-lg bg-impatience/10 border border-impatience/20">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-impatience shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <span className="text-foreground">
                        If you held until{" "}
                        {formatDate(position.maxMissedGainDate)}, this position
                        would be worth{" "}
                      </span>
                      <span className="font-mono font-semibold text-foreground">
                        {formatCurrency(position.counterfactual!.wouldBeValue)}
                      </span>
                      <span className="text-foreground-muted">
                        {" "}
                        — a{" "}
                        <span className="text-impatience font-mono">
                          {formatCurrency(
                            position.counterfactual!.missedGainDollars
                          )}
                        </span>{" "}
                        patience tax.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-foreground-muted">
                  <span>
                    Entry: {formatDate(position.entryDetails.firstEntry)}
                  </span>
                  {position.exitDetails && (
                    <>
                      <span>→</span>
                      <span>
                        Exit: {formatDate(position.exitDetails.lastExit)}
                      </span>
                    </>
                  )}
                </div>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-signal hover:text-signal/80 transition-colors"
                >
                  View on Explorer
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function PositionExplorer({
  positions,
  chain,
  className,
}: PositionExplorerProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"pnl" | "patienceTax" | "date">("pnl");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const sortedPositions = [...positions].sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case "pnl":
        comparison = a.realizedPnL - b.realizedPnL;
        break;
      case "patienceTax":
        comparison = a.patienceTax - b.patienceTax;
        break;
      case "date":
        comparison = a.entryDetails.firstEntry - b.entryDetails.firstEntry;
        break;
    }
    return sortOrder === "desc" ? -comparison : comparison;
  });

  const totalPnL = positions.reduce((sum, p) => sum + p.realizedPnL, 0);
  const totalPatienceTax = positions.reduce((sum, p) => sum + p.patienceTax, 0);
  const earlyExitCount = positions.filter((p) => p.isEarlyExit).length;

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(val);

  const toggleSort = (key: typeof sortBy) => {
    if (sortBy === key) {
      setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    } else {
      setSortBy(key);
      setSortOrder("desc");
    }
  };

  if (positions.length === 0) {
    return (
      <div
        className={cn(
          "text-center py-12 text-foreground-muted font-mono",
          className
        )}
      >
        No positions to display
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Existing Summary Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-foreground-muted">Total P&L: </span>
            <span
              className={cn(
                "font-mono font-semibold",
                totalPnL >= 0 ? "text-patience" : "text-impatience"
              )}
            >
              {formatCurrency(totalPnL)}
            </span>
          </div>
          <div>
            <span className="text-foreground-muted">Patience Tax: </span>
            <span className="font-mono font-semibold text-impatience">
              {formatCurrency(totalPatienceTax)}
            </span>
          </div>
          <div>
            <span className="text-foreground-muted">Early Exits: </span>
            <span className="font-mono font-semibold text-foreground">
              {earlyExitCount}/{positions.length}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-foreground-muted">Sort:</span>
          <button
            onClick={() => toggleSort("pnl")}
            className={cn(
              "px-2 py-1 rounded transition-colors",
              sortBy === "pnl"
                ? "bg-signal/20 text-signal"
                : "text-foreground-muted hover:text-foreground"
            )}
          >
            P&L {sortBy === "pnl" && (sortOrder === "desc" ? "↓" : "↑")}
          </button>
          <button
            onClick={() => toggleSort("patienceTax")}
            className={cn(
              "px-2 py-1 rounded transition-colors",
              sortBy === "patienceTax"
                ? "bg-signal/20 text-signal"
                : "text-foreground-muted hover:text-foreground"
            )}
          >
            Tax {sortBy === "patienceTax" && (sortOrder === "desc" ? "↓" : "↑")}
          </button>
          <button
            onClick={() => toggleSort("date")}
            className={cn(
              "px-2 py-1 rounded transition-colors",
              sortBy === "date"
                ? "bg-signal/20 text-signal"
                : "text-foreground-muted hover:text-foreground"
            )}
          >
            Date {sortBy === "date" && (sortOrder === "desc" ? "↓" : "↑")}
          </button>
        </div>
      </div>

      {/* Position Cards List */}
      <div className="space-y-2">
        {sortedPositions.map((position, index) => (
          <PositionCard
            key={position.tokenAddress}
            position={position}
            chain={chain}
            isExpanded={expandedIndex === index}
            onToggle={() =>
              setExpandedIndex(expandedIndex === index ? null : index)
            }
          />
        ))}
      </div>

      {/* Ethos Gated Cohort Analysis */}
      <div className="pt-8">
        <EthosGatedContent
            minScore={500}
            title="Whale Cohort Analysis"
            description="Unlock comparative insights to see how your conviction stacks up against top-performing whales."
        >
            <div className="rounded-lg border border-ethos/20 bg-ethos/5 p-6">
                <div className="flex items-center gap-2 mb-6">
                    <Users className="w-5 h-5 text-ethos" />
                    <h3 className="font-semibold text-foreground">Whale Cohort Benchmarks</h3>
                    <span className="px-2 py-0.5 rounded-full bg-ethos/20 text-ethos text-[10px] font-mono border border-ethos/30">
                        VERIFIED BY ETHOS
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        <div className="text-xs text-foreground-muted uppercase tracking-wider">
                            Patience Score
                        </div>
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-mono font-bold text-ethos">Top 15%</span>
                            <span className="text-xs text-foreground-muted mb-1">of cohort</span>
                        </div>
                        <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                            <div className="h-full bg-ethos w-[85%]" />
                        </div>
                        <p className="text-xs text-foreground-muted">
                            You hold winners 2.4x longer than the average trader.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <div className="text-xs text-foreground-muted uppercase tracking-wider">
                            Panic Selling
                        </div>
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-mono font-bold text-patience">Low</span>
                            <span className="text-xs text-foreground-muted mb-1">frequency</span>
                        </div>
                        <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                            <div className="h-full bg-patience w-[20%]" />
                        </div>
                        <p className="text-xs text-foreground-muted">
                            You exit specifically during drawdowns 40% less often than peers.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <div className="text-xs text-foreground-muted uppercase tracking-wider">
                            Conviction Tax
                        </div>
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-mono font-bold text-impatience">-$12.4k</span>
                            <span className="text-xs text-foreground-muted mb-1">missed</span>
                        </div>
                        <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                            <div className="h-full bg-impatience w-[45%]" />
                        </div>
                        <p className="text-xs text-foreground-muted">
                            Better than 55% of traders (Avg tax: -$28k).
                        </p>
                    </div>
                </div>
            </div>
        </EthosGatedContent>
      </div>
    </div>
  );
}