"use client";

import * as React from "react";
import { usePersonalWatchlist } from "@/hooks/use-personal-watchlist";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, TrendingUp, Radar, ExternalLink, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";


interface PersonalRadarProps {
  onAnalyze?: (address: string) => void;
}

export function PersonalRadar({ onAnalyze }: PersonalRadarProps) {
  const { watchlist, removeFromWatchlist } = usePersonalWatchlist();

  if (watchlist.length === 0) {
    return (
      <Card className="glass-panel border-border/50 bg-surface/40 mt-6 border-dashed">
        <CardContent className="py-6 text-center space-y-2">
          <Radar className="w-8 h-8 text-foreground-muted mx-auto opacity-50" />
          <div className="text-xs font-mono uppercase text-foreground-muted tracking-widest">
            My Radar Empty
          </div>
          <p className="text-xs text-foreground-muted max-w-[200px] mx-auto">
            Pin wallets from analysis or discovery to track their conviction scores here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isStale = (timestamp?: number) => {
    if (!timestamp) return true;
    const diff = Date.now() - timestamp;
    return diff > 7 * 24 * 60 * 60 * 1000; // 7 days
  };

  const formatLastUpdated = (timestamp?: number) => {
    if (!timestamp) return "Never analyzed";
    const diff = Date.now() - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    return `${days}d ago`;
  };

  return (
    <Card className="glass-panel border-border/50 bg-surface/40 mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
          <Radar className="w-4 h-4 text-patience" />
          My Radar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {watchlist.map((entry) => {
          const stale = isStale(entry.lastAnalyzed);

          return (
            <div
              key={`${entry.chain}:${entry.address}`}
              className="flex items-center justify-between p-2 rounded bg-surface/30 border border-border/30 group hover:bg-surface/50 transition-colors"
            >
              <div className="flex flex-col min-w-0 flex-1 mr-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium truncate">
                    {entry.name || `${entry.address.slice(0, 6)}...`}
                  </span>
                  <span className="text-[10px] px-1 rounded bg-border/20 text-foreground-muted uppercase">
                    {entry.chain}
                  </span>
                  {stale && (
                    <span className="text-[10px] flex items-center gap-1 text-amber-500/80 bg-amber-500/10 px-1 rounded">
                      <AlertCircle className="w-2.5 h-2.5" />
                      Stale
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  {entry.convictionScore !== undefined ? (
                    <Badge variant="secondary" className="h-4 text-[10px] px-1 bg-patience/10 text-patience border-patience/20">
                      CI: {entry.convictionScore}
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-foreground-muted italic">No score</span>
                  )}

                  <div className="flex items-center gap-1 text-[10px] text-foreground-muted">
                    <Clock className="w-3 h-3" />
                    {formatLastUpdated(entry.lastAnalyzed)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-6 w-6", stale && "text-signal animate-pulse")}
                  onClick={() => onAnalyze?.(entry.address)}
                  title={stale ? "Refresh Analysis" : "Analyze"}
                >
                  {stale ? <RefreshCw className="w-3 h-3" /> : <ExternalLink className="w-3 h-3 text-foreground-muted hover:text-signal" />}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => removeFromWatchlist(entry.address, entry.chain)}
                  title="Remove from Radar"
                >
                  <Trash2 className="w-3 h-3 text-foreground-muted hover:text-impatience" />
                </Button>
              </div>
            </div>
          );
        })}

        <div className="pt-2 text-[10px] text-center text-foreground-muted font-mono">
          {watchlist.length}/5 • Stored in Cloud
        </div>
      </CardContent>
    </Card>
  );
}
