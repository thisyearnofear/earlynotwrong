"use client";

import * as React from "react";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAppStore } from "@/lib/store";
import { usePersonalWatchlist, PersonalWatchlistEntry } from "@/hooks/use-personal-watchlist";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Star, Globe, Lock, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";



interface WatchlistButtonProps {
  wallet: {
    address: string;
    chain: "solana" | "base";
    convictionScore?: number;
    ethosScore?: number;
    archetype?: string;
    displayName?: string;
    farcasterUsername?: string;
  };
  variant?: "default" | "outline" | "ghost" | "icon";
  size?: "default" | "sm" | "icon";
  className?: string;
}

export function WatchlistButton({ wallet, variant = "outline", size = "sm", className }: WatchlistButtonProps) {
  const { address: evmAddress } = useAccount();
  const { publicKey: solanaPublicKey } = useWallet();
  const { ethosScore, showToast } = useAppStore(); // User's own Ethos score

  const { isWatched, addToWatchlist, removeFromWatchlist } = usePersonalWatchlist();

  const [openNominateDialog, setOpenNominateDialog] = useState(false);
  const [isNominating, setIsNominating] = useState(false);

  const isPinned = isWatched(wallet.address, wallet.chain);
  const userEthos = ethosScore?.score || 0;
  const canNominate = userEthos >= 1000;

  const handlePin = () => {
    if (isPinned) {
      removeFromWatchlist(wallet.address, wallet.chain);
      showToast("Removed from Personal Radar", "success");

    } else {
      addToWatchlist({
        address: wallet.address,
        chain: wallet.chain,
        name: wallet.displayName || wallet.farcasterUsername,
        convictionScore: wallet.convictionScore,
        ethosScore: wallet.ethosScore,
        archetype: wallet.archetype,
      });
      showToast("Added to Personal Radar", "success");

    }
  };

  const handleNominate = async () => {
    setIsNominating(true);
    try {
      const nominatorAddress = evmAddress || solanaPublicKey?.toBase58();

      if (!nominatorAddress) {
        showToast("Please connect your wallet to nominate", "error");
        return;
      }


      const response = await fetch("/api/community/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nominatorAddress,
          traderName: wallet.displayName || wallet.farcasterUsername || wallet.address.slice(0, 8),
          wallets: [wallet.address],
          chain: wallet.chain,
          farcaster: wallet.farcasterUsername,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to nominate");
      }

      showToast(data.message, "success");
      setOpenNominateDialog(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to nominate", "error");

    } finally {
      setIsNominating(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant === "icon" ? "ghost" : variant}
            size={variant === "icon" ? "icon" : size}
            className={cn(isPinned && "text-patience border-patience/30 bg-patience/5", className)}
          >
            <Star className={cn("w-4 h-4", isPinned ? "fill-current" : "mr-2")} />
            {variant !== "icon" && (isPinned ? "Tracked" : "Track")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-surface border-border/50 backdrop-blur-md">
          <DropdownMenuLabel>Tracking Options</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handlePin} className="cursor-pointer">
            <Star className={cn("w-4 h-4 mr-2", isPinned ? "fill-current text-patience" : "")} />
            <div className="flex flex-col">
              <span>{isPinned ? "Remove from Radar" : "Add to My Radar"}</span>
              <span className="text-[10px] text-foreground-muted">Private • Local Storage</span>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            disabled={!canNominate}
            onClick={() => canNominate && setOpenNominateDialog(true)}
            className="cursor-pointer"
          >
            {canNominate ? <Globe className="w-4 h-4 mr-2 text-signal" /> : <Lock className="w-4 h-4 mr-2 text-foreground-muted" />}
            <div className="flex flex-col">
              <span className={cn(!canNominate && "text-foreground-muted")}>Nominate to Community</span>
              <span className="text-[10px] text-foreground-muted">
                {canNominate ? "Public • Requires Approval" : "Requires 1000+ Ethos"}
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={openNominateDialog} onOpenChange={setOpenNominateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nominate to Community Watchlist</DialogTitle>
            <DialogDescription>
              Submit this trader for community review. If approved by other high-reputation members, they will be tracked globally.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="flex items-center justify-between p-3 rounded bg-surface/50 border border-border/50">
              <div className="flex flex-col">
                <span className="font-mono text-sm">{wallet.displayName || wallet.farcasterUsername || "Unknown Trader"}</span>
                <span className="text-xs text-foreground-muted font-mono">{wallet.address}</span>
              </div>
              <Badge variant="outline" className="bg-signal/10 text-signal border-signal/30">
                {wallet.convictionScore ? `CI: ${wallet.convictionScore}` : "No Score"}
              </Badge>
            </div>

            <div className="text-xs text-foreground-muted">
              <p>• Requires 1 endorsement from a Contributor (1200+ Ethos) or 2 from Nominators.</p>
              <p>• You will be recorded as the nominator.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenNominateDialog(false)}>Cancel</Button>
            <Button onClick={handleNominate} disabled={isNominating} className="bg-signal text-signal-foreground hover:bg-signal/90">
              {isNominating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Submit Nomination
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
