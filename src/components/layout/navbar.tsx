"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { WalletConnect } from "@/components/wallet/wallet-connect";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Search, Shield, ShieldCheck, Users, Zap, Crown, TrendingUp, Activity, Menu, X } from "lucide-react";
import { NavSettingsMenu } from "@/components/layout/nav-settings-menu";
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
import { useRouter, usePathname } from "next/navigation";
import { useWallet as useAleoWallet } from "@provablehq/aleo-wallet-adaptor-react";
import {
  getEthosTier,
  getTierInfo,
  getNextTierUnlocks,
} from "@/lib/ethos-gates";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

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
  const { theme, setTheme, ethosScore, isShowcaseMode, toggleShowcaseMode, mantle } = useAppStore();
  const { connected: isAleoConnectedRaw } = useAleoWallet();
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const isAleoConnected = mounted ? isAleoConnectedRaw : false;
  const { analyzeWallet } = useConviction();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // The /agent page has its own Casper Wallet connect panel; hide the
  // Solana/EVM/Aleo WalletConnect button there to avoid confusing visitors
  // with two unrelated wallet systems.
  const isAgentPage = pathname === "/agent";

  const currentScore = mounted ? (isShowcaseMode ? 9999 : (ethosScore?.score || 0)) : 0;
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
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-md h-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 lg:gap-6">
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                href="/"
                className="font-bold text-base sm:text-lg tracking-tight text-foreground hover:opacity-80 transition-opacity flex items-center gap-1"
                onClick={() => setMobileMenuOpen(false)}
              >
                <span className="hidden sm:inline">EARLY</span>
                <span className="sm:hidden">ENW</span>
                <span className="text-foreground-muted hidden sm:inline">,</span>
                <span className="hidden sm:inline"> NOT WRONG</span>
                {isAleoConnected && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="ml-1"
                  >
                    <ShieldCheck className="w-3 h-3 text-signal" />
                  </motion.div>
                )}
                {mantle.isMantleMode && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="ml-1"
                  >
                    <Zap className="w-3 h-3 text-[#65b3ae]" />
                  </motion.div>
                )}
              </Link>
              <span className="hidden md:inline-flex items-center justify-center px-2 py-0.5 text-[10px] font-mono font-medium text-foreground-dim bg-surface border border-border rounded-full uppercase tracking-wider">
                Beta
              </span>
            </div>

            <div className="hidden lg:flex items-center gap-1">
              <Link
                href="/leaderboard"
                className="px-3 py-2.5 text-xs font-mono text-foreground-muted hover:text-foreground transition-colors flex items-center gap-2 min-h-[44px]"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Leaderboard
              </Link>
              <Link
                href="/alpha"
                className="px-3 py-2.5 text-xs font-mono text-foreground-muted hover:text-signal transition-colors flex items-center gap-2 min-h-[44px]"
              >
                <Zap className="w-3.5 h-3.5" />
                Alpha
              </Link>
              <Link
                href="/agent"
                className="px-3 py-2.5 text-xs font-mono text-foreground-muted hover:text-signal transition-colors flex items-center gap-2 min-h-[44px]"
              >
                <Activity className="w-3.5 h-3.5" />
                Agent
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* Chain status + feature toggles consolidated:
                · Per-chain connection lights live on the WalletConnect button (●●●).
                · Demo / Mantle modes live in <NavSettingsMenu/>.
                The standalone Aleo pill + inline Demo/Mantle switches were
                removed to declutter the nav. */}

            {/* Ethos Status Badge - Desktop */}
            {(currentScore > 0 || isShowcaseMode) && (
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    className={cn(
                      "hidden md:flex items-center gap-2 px-3 py-2 rounded-full border text-xs font-mono cursor-pointer hover:opacity-80 transition-opacity min-h-[44px]",
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
                  </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Your Ethos Status</DialogTitle>
                  </DialogHeader>
                  <div className="py-2">
                    <div className="text-center">
                      <div className="text-4xl font-bold text-signal">{currentScore}</div>
                      <div className="text-xs text-foreground-muted font-mono uppercase mt-1">{tier}</div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            {/* Mobile Ethos Badge - Compact */}
            {(currentScore > 0 || isShowcaseMode) && (
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    className={cn(
                      "flex md:hidden items-center justify-center w-10 h-10 rounded-full border text-xs font-mono cursor-pointer hover:opacity-80 transition-opacity",
                      tierInfo.bgColor,
                      tierInfo.borderColor,
                    )}
                  >
                    <TierIcon icon={tierInfo.icon} className={cn(tierInfo.color, "w-4 h-4")} />
                  </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Your Ethos Status</DialogTitle>
                  </DialogHeader>
                  <div className="py-2">
                    <div className="text-center">
                      <div className="text-4xl font-bold text-signal">{currentScore}</div>
                      <div className="text-xs text-foreground-muted font-mono uppercase mt-1">{tier}</div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Search wallets"
                  className="h-10 w-10 text-foreground-muted hover:text-foreground"
                >
                  <Search className="w-5 h-5" />
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
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              className="h-10 w-10 text-foreground-muted hover:text-foreground"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </Button>

            <NavSettingsMenu className="hidden md:inline-flex" />

            <WalletConnect className="h-10 px-3 hidden sm:flex" hiddenOnAgent={isAgentPage} />

            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              className="h-10 w-10 text-foreground-muted hover:text-foreground lg:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </Button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="fixed top-16 left-0 right-0 z-40 bg-background/95 backdrop-blur-md border-b border-border lg:hidden"
          >
            <div className="max-w-7xl mx-auto px-4 py-4 space-y-2">
              {/* Mobile Navigation Links */}
              <Link
                href="/leaderboard"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-mono text-foreground-muted hover:text-foreground hover:bg-surface/50 transition-colors min-h-[48px]"
              >
                <TrendingUp className="w-5 h-5" />
                Leaderboard
              </Link>
              <Link
                href="/alpha"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-mono text-foreground-muted hover:text-signal hover:bg-surface/50 transition-colors min-h-[48px]"
              >
                <Zap className="w-5 h-5" />
                Alpha Discovery
              </Link>
              <Link
                href="/agent"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-mono text-foreground-muted hover:text-signal hover:bg-surface/50 transition-colors min-h-[48px]"
              >
                <Activity className="w-5 h-5" />
                Agent Dashboard
              </Link>

              {/* Mobile Demo Toggle */}
              <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface/30 min-h-[48px]">
                <span className="text-sm font-mono text-foreground-muted">Demo Mode</span>
                <button
                  onClick={() => toggleShowcaseMode()}
                  role="switch"
                  aria-checked={isShowcaseMode}
                  aria-label="Demo Mode"
                  className={cn(
                    "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
                    isShowcaseMode ? "bg-signal" : "bg-surface"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
                      isShowcaseMode ? "translate-x-6" : "translate-x-0.5"
                    )}
                  />
                </button>
              </div>

              {/* Mobile Mantle Toggle */}
              <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface/30 min-h-[48px]">
                <span className="text-sm font-mono text-[#65b3ae]">Mantle Mode</span>
                <button
                  onClick={() => useAppStore.getState().setMantleState({ isMantleMode: !mantle.isMantleMode })}
                  role="switch"
                  aria-checked={mantle.isMantleMode}
                  aria-label="Mantle Mode"
                  className={cn(
                    "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
                    mantle.isMantleMode ? "bg-[#65b3ae]" : "bg-surface"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
                      mantle.isMantleMode ? "translate-x-6" : "translate-x-0.5"
                    )}
                  />
                </button>
              </div>

              {/* Mobile Wallet Connect — hidden on /agent (Casper Wallet panel there) */}
              {!isAgentPage && (
              <div className="px-4 py-3 sm:hidden">
                <WalletConnect className="w-full h-12 justify-center" />
              </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
