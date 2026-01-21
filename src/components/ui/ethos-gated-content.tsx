"use client";

import * as React from "react";
import { useAppStore } from "@/lib/store";
import { Lock, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EthosGatedContentProps {
  minScore: number;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export function EthosGatedContent({
  minScore,
  children,
  fallback,
  title = "Restricted Access",
  description = "Higher Ethos credibility is required to view this content.",
  className,
}: EthosGatedContentProps) {
  const { ethosScore, isShowcaseMode } = useAppStore();
  
  // In showcase mode, we simulate a high score so the demo looks good
  // Otherwise, we check the real score
  const currentScore = isShowcaseMode ? 9999 : (ethosScore?.score || 0);
  const isUnlocked = currentScore >= minScore;

  if (isUnlocked) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-border bg-surface/30 p-8 text-center", className)}>
      <div className="absolute inset-0 bg-grid-white/[0.02] [mask-image:linear-gradient(0deg,transparent,black)]" />
      
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface border border-border">
          <Lock className="h-5 w-5 text-foreground-muted" />
        </div>
        
        <div className="space-y-1">
          <h3 className="font-semibold text-foreground flex items-center justify-center gap-2">
            <Shield className="w-4 h-4 text-ethos" />
            {title}
          </h3>
          <p className="text-sm text-foreground-muted max-w-sm mx-auto">
            {description}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-foreground-muted bg-surface/50 px-3 py-1.5 rounded-full border border-border">
          <span>Required Score: {minScore}</span>
          <span className="text-border">|</span>
          <span className={ethosScore ? "text-impatience" : "text-foreground-muted"}>
            Your Score: {ethosScore?.score ?? "---"}
          </span>
        </div>

        <Button 
          variant="outline" 
          size="sm" 
          className="mt-2"
          onClick={() => window.open("https://ethos.network", "_blank")}
        >
          Build Reputation on Ethos
        </Button>
      </div>

      {/* Blur effect for "content underneath" illusion */}
      <div className="absolute inset-0 -z-10 blur-xl opacity-20 bg-gradient-to-br from-ethos/20 via-transparent to-transparent" />
    </div>
  );
}
