"use client";

import { motion } from "framer-motion";
import { Flame, Users, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TokenHeatmapEntry } from "@/lib/db/postgres";

interface TokenHeatmapProps {
  tokens: TokenHeatmapEntry[];
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const intensityToColor = (intensity: number) => {
  if (intensity >= 80) return "from-signal/40 to-signal/20 border-signal/50";
  if (intensity >= 60) return "from-signal/25 to-signal/10 border-signal/40";
  if (intensity >= 40) return "from-patience/20 to-patience/5 border-patience/30";
  if (intensity >= 20) return "from-foreground/10 to-foreground/5 border-border";
  return "from-surface to-surface border-border";
};

export function TokenHeatmap({ tokens }: TokenHeatmapProps) {
  if (tokens.length === 0) {
    return (
      <div className="text-center py-12 text-foreground-muted text-sm font-mono">
        No token conviction data yet. Scan a wallet to populate the heatmap.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {tokens.map((token, i) => {
        const symbol = token.tokenSymbol || shortenAddress(token.tokenAddress);
        const explorerUrl =
          token.chain === "base"
            ? `https://basescan.org/token/${token.tokenAddress}`
            : `https://solscan.io/token/${token.tokenAddress}`;

        return (
          <motion.a
            key={`${token.chain}-${token.tokenAddress}`}
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.03, duration: 0.25 }}
            className={cn(
              "relative block rounded-xl border bg-gradient-to-br p-4 hover:scale-[1.02] transition-transform",
              intensityToColor(token.convictionIntensity),
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="min-w-0">
                <div className="font-bold text-foreground truncate text-base">
                  {symbol}
                </div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-foreground-muted mt-0.5">
                  {token.chain}
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-foreground-dim shrink-0" />
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <div className="text-[9px] font-mono uppercase tracking-wider text-foreground-muted">
                  Intensity
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Flame className="w-3 h-3 text-signal" />
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {token.convictionIntensity}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-wider text-foreground-muted">
                  Holders
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Users className="w-3 h-3 text-foreground-dim" />
                  <span className="text-sm font-mono tabular-nums text-foreground">
                    {token.holderCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-border/30">
              <div className="flex items-center justify-between">
                <div className="text-[9px] font-mono uppercase tracking-wider text-foreground-muted">
                  Avg Conviction
                </div>
                <div className="text-xs font-mono tabular-nums text-foreground">
                  {token.avgConvictionScore.toFixed(0)}
                </div>
              </div>
            </div>

            {/* Intensity bar */}
            <div className="absolute bottom-0 left-0 right-0 h-1 rounded-b-xl bg-background/20 overflow-hidden">
              <div
                className="h-full bg-signal"
                style={{ width: `${token.convictionIntensity}%` }}
              />
            </div>
          </motion.a>
        );
      })}
    </div>
  );
}
