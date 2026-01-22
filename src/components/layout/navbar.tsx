"use client";

import { useState } from "react";
import Link from "next/link";
import { WalletConnect } from "@/components/wallet/wallet-connect";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Search, Shield, Users, Zap, Crown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { WalletSearchInput } from "@/components/wallet/wallet-search-input";
import type { ResolvedIdentity } from "@/lib/services/identity-resolver";
import { useConviction } from "@/hooks/use-conviction";
import { useRouter } from "next/navigation";
import {
  getEthosTier,
  getTierInfo,
  getNextTierUnlocks,
} from "@/lib/ethos-gates";
import { cn } from "@/lib/utils";
import { ReputationPerks } from "@/components/ui/reputation-perks";

const TierIcon = ({
  icon,
  className,
}: {
  icon: "shield" | "users" | "zap" | "crown";
  className?: string;
}) => {
  const iconClass = cn("w-3 h-3", className);
  switch (icon) {
    case "crown":
      return <Crown className={iconClass} />;
    case "zap":
      return <Zap className={iconClass} />;
    case "users":
      return <Users className={iconClass} />;
    default:
      return <Shield className={iconClass} />;
  }
};

export function Navbar() {
  const { theme, setTheme, ethosScore } = useAppStore();
  const { analyzeWallet } = useConviction();
  const [searchOpen, setSearchOpen] = useState(false);
  const router = useRouter();

  const currentScore = ethosScore?.score || 0;
  const tier = getEthosTier(currentScore);
  const tierInfo = getTierInfo(tier);
  const nextUnlocks = getNextTierUnlocks(currentScore);

  const handleWalletSelected = async (identity: ResolvedIdentity) => {
    console.log("Selected wallet:", identity);
    setSearchOpen(false);

    // Update store with resolved identity data
    const { setEthosData, setFarcasterIdentity } = useAppStore.getState();

    // Update Ethos data (score and profile together)
    setEthosData(
      identity.ethos?.score || null,
      identity.ethos?.profile || null,
    );

    // Update Farcaster identity if available
    if (identity.farcaster) {
      setFarcasterIdentity(identity.farcaster);
    }

    // Trigger conviction analysis
    await analyzeWallet(identity.address);

    // If we're not on the home page, navigate there
    if (typeof window !== "undefined" && window.location.pathname !== "/") {
      router.push("/");
    }

    // Scroll to results after analysis starts
    setTimeout(() => {
      const resultsSection = document.getElementById("conviction-results");
      resultsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 500);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-md h-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="font-bold text-lg tracking-tight text-foreground hover:text-white transition-colors flex items-center gap-1"
          >
            EARLY<span className="text-foreground-muted">,</span> NOT WRONG
          </Link>
          <span className="hidden md:inline-flex items-center justify-center px-2 py-0.5 text-[10px] font-mono font-medium text-foreground-dim bg-surface border border-border rounded-full uppercase tracking-wider">
            Beta
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Ethos Status Badge */}
          {currentScore > 0 && (
            <Dialog>
              <DialogTrigger asChild>
                <div
                  className={cn(
                    "hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono cursor-pointer hover:opacity-80 transition-opacity",
                    tierInfo.bgColor,
                    tierInfo.borderColor,
                  )}
                  title={`Ethos ${currentScore} • ${tierInfo.name}${nextUnlocks ? ` • ${nextUnlocks.pointsAway} to ${nextUnlocks.nextTier}` : ""}`}
                >
                  <TierIcon icon={tierInfo.icon} className={tierInfo.color} />
                  <span className={tierInfo.color}>{currentScore}</span>
                  <span className="text-foreground-muted">•</span>
                  <span className="text-foreground-dim uppercase">
                    {tierInfo.name}
                  </span>
                  {nextUnlocks && (
                    <>
                      <span className="text-foreground-muted">→</span>
                      <span className="text-foreground-muted">
                        {nextUnlocks.requiredScore}
                      </span>
                    </>
                  )}
                </div>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Your Ethos Status</DialogTitle>
                </DialogHeader>
                <div className="py-2">
                  <ReputationPerks />
                </div>
              </DialogContent>
            </Dialog>
          )}

          {currentScore === 0 && (
            <div className="hidden md:flex items-center gap-2 text-xs font-mono text-foreground-muted mr-2">
              <span className="w-2 h-2 rounded-full bg-patience animate-pulse"></span>
              SYSTEM ONLINE
            </div>
          )}

          <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-foreground-muted hover:text-foreground"
              >
                <Search className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Analyze Any Wallet</DialogTitle>
                <DialogDescription>
                  Enter an address, ENS, or Farcaster handle to inspect
                  conviction.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <WalletSearchInput
                  onWalletSelected={handleWalletSelected}
                  className="max-w-none"
                />
              </div>
            </DialogContent>
          </Dialog>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-foreground-muted hover:text-foreground"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </Button>
          <WalletConnect className="h-8 px-3" />
        </div>
      </div>
    </nav>
  );
}
