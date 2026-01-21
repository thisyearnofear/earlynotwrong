"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConvictionMetrics } from "@/lib/market";
import {
  encodeShareData,
  getShareUrl,
  getOgImageUrl,
  getTwitterShareUrl,
  getFarcasterShareUrl,
  copyToClipboard,
  ShareData,
} from "@/lib/share";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";

import { APP_CONFIG } from "@/lib/config";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metrics: ConvictionMetrics;
  chain: "solana" | "base";
}

export function ShareDialog({
  open,
  onOpenChange,
  metrics,
  chain,
}: ShareDialogProps) {
  const showToast = useAppStore((state) => state.showToast);
  const [copied, setCopied] = useState(false);

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : APP_CONFIG.baseUrl;

  const shareData: ShareData = {
    id: Math.random().toString(36).substring(2, 10),
    score: metrics.score,
    archetype: metrics.archetype || "Diamond Hand",
    percentile: metrics.percentile,
    patienceTax: metrics.patienceTax,
    upsideCapture: metrics.upsideCapture,
    chain,
    timestamp: Date.now(),
  };

  const shareUrl = getShareUrl(shareData, baseUrl);
  const ogImageUrl = getOgImageUrl(shareData, baseUrl);
  const twitterUrl = getTwitterShareUrl(shareData, baseUrl);
  const farcasterUrl = getFarcasterShareUrl(shareData, baseUrl);

  const handleCopy = async () => {
    const success = await copyToClipboard(shareUrl);
    if (success) {
      setCopied(true);
      showToast("Share link copied to clipboard", "success");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm text-foreground-muted tracking-widest uppercase">
            Share Your Conviction Score
          </DialogTitle>
          <DialogDescription>
            Share your analysis on social media or copy the link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Preview Card */}
          <div className="relative rounded-lg overflow-hidden border border-border">
            <img
              src={ogImageUrl}
              alt={`Conviction Score: ${metrics.score}`}
              className="w-full aspect-[1200/630] object-cover"
            />
          </div>

          {/* Share Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-12 font-mono text-xs"
              onClick={() => window.open(twitterUrl, "_blank")}
            >
              <svg
                className="w-4 h-4 mr-2"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Share on X
            </Button>

            <Button
              variant="outline"
              className="h-12 font-mono text-xs"
              onClick={() => window.open(farcasterUrl, "_blank")}
            >
              <svg
                className="w-4 h-4 mr-2"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M3 3h18v18H3V3zm15.5 14.5v-9h-3v3h-7v-3h-3v9h3v-4h7v4h3z" />
              </svg>
              Share on Farcaster
            </Button>
          </div>

          {/* Copy Link */}
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border font-mono text-xs text-foreground-muted truncate">
              {shareUrl}
            </div>
            <Button
              variant="outline"
              size="icon"
              className={cn("shrink-0", copied && "text-patience border-patience")}
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* Direct Link */}
          <div className="text-center">
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-signal hover:underline"
            >
              Open share page
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
