"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowUp, ArrowDown, Minus, ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ConvictionBadge, type Archetype } from "@/components/ui/conviction-badge";
import { getEthosTier, getTierInfo } from "@/lib/ethos-gates";
import type { AlphaTrader } from "@/lib/db/postgres";

interface AlphaTraderCardProps {
  trader: AlphaTrader;
  rank?: number;
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function AlphaTraderCard({ trader, rank }: AlphaTraderCardProps) {
  const [copied, setCopied] = useState(false);
  const ethosTier = getEthosTier(trader.ethosScore);
  const tierInfo = getTierInfo(ethosTier);

  const display = trader.farcaster
    ? `@${trader.farcaster}`
    : trader.ens
    ? trader.ens
    : trader.displayName
    ? trader.displayName
    : shortenAddress(trader.address);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(trader.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const explorerUrl =
    trader.chain === "base"
      ? `https://basescan.org/address/${trader.address}`
      : `https://solscan.io/account/${trader.address}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex items-center gap-4 rounded-xl border border-border bg-surface/40 p-4 hover:bg-surface/60 transition-colors"
    >
      {/* Rank */}
      {rank !== undefined && (
        <div className="shrink-0 w-8 text-center">
          <div
            className={cn(
              "text-sm font-mono font-bold tabular-nums",
              rank <= 3 ? "text-signal" : "text-foreground-dim",
            )}
          >
            #{rank}
          </div>
        </div>
      )}

      {/* Identity */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-foreground truncate">
            {display}
          </span>
          {trader.farcaster && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-signal/10 text-signal border border-signal/20">
              FC
            </span>
          )}
          <span
            className={cn(
              "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
              tierInfo.bgColor,
              tierInfo.borderColor,
              tierInfo.color,
            )}
          >
            {tierInfo.name}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={handleCopy}
            className="text-xs font-mono text-foreground-dim hover:text-foreground transition-colors flex items-center gap-1"
          >
            {shortenAddress(trader.address)}
            {copied ? (
              <Check className="w-3 h-3 text-patience" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
          <span className="text-foreground-dim">·</span>
          <span className="text-xs text-foreground-dim uppercase">
            {trader.chain}
          </span>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground-dim hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
          <span className="text-foreground-dim">·</span>
          <Link
            href={`/analyzer?wallet=${encodeURIComponent(trader.address)}`}
            className="text-xs font-mono text-signal hover:underline"
          >
            Analyze
          </Link>
        </div>
      </div>

      {/* Metrics */}
      <div className="shrink-0 flex items-center gap-4">
        <div className="text-right hidden sm:block">
          <div className="text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
            Conviction
          </div>
          <div className="text-lg font-bold tabular-nums text-foreground">
            {trader.convictionScore}
          </div>
        </div>

        <div
          className="text-right hidden md:block"
          title="Behavioral conviction score — how this wallet trades: holds through drawdown, avoids the patience tax, lets winners run. Ethos (social credibility) only gates access to this view; it never reorders it."
        >
          <div className="text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
            Patience Tax
          </div>
          <div className="text-sm font-mono tabular-nums text-foreground-muted">
            {trader.patienceTax.toFixed(1)}%
          </div>
        </div>

        <div className="text-right hidden lg:block">
          <div className="text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
            Win Rate
          </div>
          <div className="text-sm font-mono tabular-nums text-foreground">
            {trader.winRate.toFixed(1)}%
          </div>
        </div>

        <div className="hidden sm:block">
          <ConvictionBadge
            archetype={(trader.archetype as Archetype) ?? "Unclassified"}
            size="sm"
          />
        </div>

        {/* Rank change */}
        {rank !== undefined && (
          <div className="shrink-0 w-6 flex justify-center">
            {trader.rankChange > 0 ? (
              <ArrowUp className="w-3.5 h-3.5 text-patience" />
            ) : trader.rankChange < 0 ? (
              <ArrowDown className="w-3.5 h-3.5 text-foreground-muted" />
            ) : (
              <Minus className="w-3.5 h-3.5 text-foreground-dim" />
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
