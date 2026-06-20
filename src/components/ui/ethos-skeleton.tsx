"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EthosReputationSkeletonProps {
  className?: string;
}

export function EthosReputationSkeleton({ className }: EthosReputationSkeletonProps) {
  return (
    <Card
      className={cn(
        "glass-panel border-border/50 bg-surface/40 flex flex-col justify-between h-full relative overflow-hidden",
        className,
      )}
    >
      <CardHeader className="pt-6">
        {/* Farcaster identity skeleton */}
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-signal/5 border border-signal/20">
          <Skeleton className="w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>

        {/* Title row */}
        <div className="flex items-center justify-between mb-2">
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase">
            Reputation
          </CardTitle>
          <Skeleton className="w-5 h-5 rounded" />
        </div>

        {/* Status badge */}
        <Skeleton className="h-8 w-36 mb-1" />
        <Skeleton className="h-3.5 w-56 mt-2" />
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Metrics block */}
        <div className="p-4 rounded-lg bg-surface/50 border border-border space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex justify-between items-center">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>

        {/* Button skeleton */}
        <Skeleton className="h-9 w-full rounded-md" />
      </CardContent>
    </Card>
  );
}
