"use client";

import { motion } from "framer-motion";
import { AlertCircle, RefreshCw, Database, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ErrorPanelProps {
  errorType: "api" | "network" | "data" | "unknown";
  errorMessage: string;
  errorDetails?: string;
  canRetry: boolean;
  canUseCached: boolean;
  recoveryAction?: string;
  onRetry?: () => void;
  onUseCached?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorPanel({
  errorType,
  errorMessage,
  errorDetails,
  canRetry,
  canUseCached,
  recoveryAction,
  onRetry,
  onUseCached,
  onDismiss,
  className,
}: ErrorPanelProps) {
  const getErrorIcon = () => {
    switch (errorType) {
      case "network":
        return <AlertCircle className="w-5 h-5 text-impatience" />;
      case "api":
        return <AlertCircle className="w-5 h-5 text-warning" />;
      case "data":
        return <Database className="w-5 h-5 text-foreground-muted" />;
      default:
        return <AlertCircle className="w-5 h-5 text-foreground-muted" />;
    }
  };

  const getErrorColor = () => {
    switch (errorType) {
      case "network":
        return "border-impatience/50 bg-impatience/5";
      case "api":
        return "border-warning/50 bg-warning/5";
      case "data":
        return "border-foreground-muted/50 bg-surface/40";
      default:
        return "border-border/50 bg-surface/40";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={cn("w-full", className)}
    >
      <Card className={cn("glass-panel border", getErrorColor())}>
        <CardHeader>
          <CardTitle className="text-sm font-mono tracking-wider uppercase flex items-center gap-2">
            {getErrorIcon()}
            Analysis Error
          </CardTitle>
          <CardDescription className="font-mono text-xs">
            {errorMessage}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Error Details */}
          {errorDetails && (
            <div className="p-3 rounded-lg bg-surface/50 border border-border">
              <p className="text-xs font-mono text-foreground-muted">{errorDetails}</p>
            </div>
          )}

          {/* Recovery Action */}
          {recoveryAction && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-signal/5 border border-signal/20">
              <ArrowRight className="w-4 h-4 text-signal flex-shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">{recoveryAction}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {canRetry && onRetry && (
              <Button
                onClick={onRetry}
                variant="default"
                size="sm"
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Analysis
              </Button>
            )}

            {canUseCached && onUseCached && (
              <Button
                onClick={onUseCached}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <Database className="w-4 h-4" />
                Use Cached Data
              </Button>
            )}

            {onDismiss && (
              <Button
                onClick={onDismiss}
                variant="ghost"
                size="sm"
              >
                Dismiss
              </Button>
            )}
          </div>

          {/* Tips */}
          <div className="pt-2 border-t border-border/50">
            <p className="text-xs text-foreground-muted font-mono">
              💡 TIPS:
            </p>
            <ul className="mt-2 space-y-1 text-xs text-foreground-muted">
              {canRetry && <li>• Try again in a few moments</li>}
              {canUseCached && <li>• Check your history panel for previous analyses</li>}
              {errorType === "network" && <li>• Verify your internet connection</li>}
              {errorType === "data" && <li>• Try adjusting time horizon or minimum trade value</li>}
              <li>• Try showcase mode to see how the analysis works</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
