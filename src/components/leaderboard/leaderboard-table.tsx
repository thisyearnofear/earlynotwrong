"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ConvictionBadge, type Archetype } from "@/components/ui/conviction-badge";
import { TrendingUp, ArrowUpRight, BarChart3 } from "lucide-react";
import type { StoredAnalysis } from "@/lib/db/postgres";

type ChainFilter = "all" | "solana" | "base";

interface LeaderboardTableProps {
  initialEntries: StoredAnalysis[];
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

export function LeaderboardTable({ initialEntries }: LeaderboardTableProps) {
  const [filter, setFilter] = useState<ChainFilter>("all");

  const entries = useMemo(() => {
    if (filter === "all") return initialEntries;
    return initialEntries.filter((e) => e.chain === filter);
  }, [initialEntries, filter]);

  const tabs: { key: ChainFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "solana", label: "Solana" },
    { key: "base", label: "Base" },
  ];

  if (initialEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
        <BarChart3 className="w-12 h-12 text-foreground-muted/30" />
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            No conviction data yet
          </h3>
          <p className="text-sm text-foreground-muted max-w-sm">
            Be the first to scan a wallet and populate the leaderboard.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-signal text-background text-sm font-semibold hover:bg-signal/90 transition-colors"
        >
          Analyze a Wallet →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-1 p-1 rounded-full bg-surface border border-border w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs font-mono transition-all",
              filter === tab.key
                ? "bg-foreground text-background"
                : "text-foreground-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-surface/50 border-b border-border text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
          <div className="col-span-1">#</div>
          <div className="col-span-4">Wallet</div>
          <div className="col-span-1 hidden sm:block">Chain</div>
          <div className="col-span-2 text-right">Score</div>
          <div className="col-span-2 hidden md:block">Archetype</div>
          <div className="col-span-1 text-right hidden lg:block">Tax</div>
          <div className="col-span-1 text-right hidden lg:block">Capture</div>
        </div>

        {/* Rows */}
        {entries.map((entry, i) => (
          <motion.div
            key={`${entry.address}-${entry.chain}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.03 }}
          >
            <Link
              href={`/?wallet=${entry.address}`}
              className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-border/50 hover:bg-surface/30 transition-colors group items-center"
            >
              {/* Rank */}
              <div className="col-span-1">
                <span
                  className={cn(
                    "font-mono text-sm font-bold",
                    i === 0
                      ? "text-signal"
                      : i === 1
                        ? "text-foreground"
                        : i === 2
                          ? "text-impatience"
                          : "text-foreground-muted",
                  )}
                >
                  {i + 1}
                </span>
              </div>

              {/* Wallet + Identity */}
              <div className="col-span-4 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-foreground truncate group-hover:text-signal transition-colors">
                    {entry.farcasterUsername
                      ? `@${entry.farcasterUsername}`
                      : entry.ensName || shortenAddress(entry.address)}
                  </span>
                  <ArrowUpRight className="w-3 h-3 text-foreground-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
                {entry.farcasterUsername || entry.ensName ? (
                  <span className="font-mono text-[10px] text-foreground-muted">
                    {shortenAddress(entry.address)}
                  </span>
                ) : null}
              </div>

              {/* Chain */}
              <div className="col-span-1 hidden sm:block">
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded uppercase font-mono",
                    entry.chain === "solana"
                      ? "bg-purple-500/10 text-purple-400"
                      : "bg-blue-500/10 text-blue-400",
                  )}
                >
                  {entry.chain}
                </span>
              </div>

              {/* Score */}
              <div className="col-span-2 text-right">
                <span className="font-mono text-lg font-bold text-foreground">
                  {entry.score}
                </span>
              </div>

              {/* Archetype */}
              <div className="col-span-2 hidden md:block">
                {entry.archetype ? (
                  <ConvictionBadge
                    archetype={entry.archetype as Archetype}
                    size="sm"
                  />
                ) : (
                  <span className="text-xs text-foreground-muted">—</span>
                )}
              </div>

              {/* Patience Tax */}
              <div className="col-span-1 text-right hidden lg:block">
                <span className="font-mono text-xs text-impatience">
                  {entry.patienceTax > 0
                    ? `-${formatCurrency(entry.patienceTax)}`
                    : "—"}
                </span>
              </div>

              {/* Upside Capture */}
              <div className="col-span-1 text-right hidden lg:block">
                <span className="font-mono text-xs text-patience">
                  {entry.upsideCapture > 0 ? `${entry.upsideCapture}%` : "—"}
                </span>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] font-mono text-foreground-muted px-1">
        <span>
          {entries.length} wallet{entries.length !== 1 ? "s" : ""} ranked
        </span>
        <span>
          <TrendingUp className="w-3 h-3 inline-block mr-1" />
          Sorted by conviction score
        </span>
      </div>
    </div>
  );
}
