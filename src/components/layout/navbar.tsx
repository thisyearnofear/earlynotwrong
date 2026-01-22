"use client";

import Link from "next/link";
import { WalletConnect } from "@/components/wallet/wallet-connect";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Search } from "lucide-react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogDescription 
} from "@/components/ui/dialog";
import { WalletSearchInput } from "@/components/wallet/wallet-search-input";
import { useRouter } from "next/navigation";

export function Navbar() {
  const { theme, setTheme } = useAppStore();
  const router = useRouter();

  const handleWalletSelected = (identity: any) => {
    // For now, redirect to home or a placeholder analyze page
    // In Phase 2/3 this will trigger the full analysis flow for that wallet
    console.log("Selected wallet:", identity);
    // router.push(`/analyze/${identity.address}`);
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
          <div className="hidden md:flex items-center gap-2 text-xs font-mono text-foreground-muted mr-2">
            <span className="w-2 h-2 rounded-full bg-patience animate-pulse"></span>
            SYSTEM ONLINE
          </div>

          <Dialog>
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
                  Enter an address, ENS, or Farcaster handle to inspect conviction.
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
