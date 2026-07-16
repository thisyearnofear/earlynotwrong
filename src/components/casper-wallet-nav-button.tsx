"use client";

/**
 * Compact Casper Wallet button for the navbar.
 *
 * Shows "Connect Casper Wallet" when disconnected, the shortened public key
 * when connected, and an install link when the extension isn't detected.
 * Uses the shared CasperWalletProvider context so it stays in sync with the
 * detail card on the /agent page.
 */

import { useState } from "react";
import { useCasperWallet } from "@/components/casper-wallet-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Wallet, Loader2, ExternalLink, CheckCircle2, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";

const CASPER_WALLET_INSTALL_URL = "https://www.casperwallet.io/";

function shortKey(hex: string): string {
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

export function CasperWalletNavButton({ className }: { className?: string }) {
  const ctx = useCasperWallet();
  const [menuOpen, setMenuOpen] = useState(false);

  // No provider context (not on /agent) — render nothing.
  if (!ctx) return null;

  const { status, connect, disconnect } = ctx;

  // Loading — show a subtle spinner button
  if (status.kind === "loading") {
    return (
      <Button variant="ghost" className={cn("font-mono text-xs tracking-wider", className)} disabled>
        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        <span className="hidden sm:inline">Casper…</span>
      </Button>
    );
  }

  // Not installed — link to install page
  if (status.kind === "not-installed") {
    return (
      <a
        href={CASPER_WALLET_INSTALL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 px-3 h-10 rounded-lg border border-signal/40 bg-signal/10 text-signal font-mono text-xs tracking-wider hover:bg-signal/20 transition-colors",
          className,
        )}
      >
        <Wallet className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Install Casper</span>
        <ExternalLink className="w-3 h-3" />
      </a>
    );
  }

  // Connected — show key with disconnect dropdown
  if (status.kind === "connected") {
    return (
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-2 px-3 h-10 rounded-lg border border-signal/40 bg-signal/10 text-foreground font-mono text-xs tracking-wider hover:bg-signal/20 transition-colors",
              className,
            )}
            title="Casper Wallet connected"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-signal" />
            <span className="hidden sm:inline">{shortKey(status.publicKey)}</span>
            <span className="sm:hidden">Casper</span>
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
              Casper Wallet
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg bg-surface/40 border border-border/40 p-3 space-y-1">
              <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
                Connected account
              </p>
              <code className="block text-[11px] font-mono text-foreground break-all">
                {status.publicKey}
              </code>
              {status.version && (
                <p className="text-[10px] font-mono text-foreground-dim">
                  Wallet v{status.version}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                disconnect();
                setMenuOpen(false);
              }}
            >
              <Unlock className="w-3.5 h-3.5 mr-1.5" />
              Disconnect
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Locked — disabled button with hint
  if (status.kind === "locked") {
    return (
      <Button
        variant="outline"
        className={cn("font-mono text-xs tracking-wider text-foreground-muted", className)}
        disabled
        title="Unlock your Casper Wallet extension"
      >
        <Wallet className="w-3.5 h-3.5 mr-1.5" />
        <span className="hidden sm:inline">Unlock Casper</span>
        <span className="sm:hidden">Locked</span>
      </Button>
    );
  }

  // Disconnected or connecting — Connect button
  return (
    <Button
      variant="default"
      className={cn(
        "font-mono text-xs tracking-wider bg-signal text-black hover:bg-signal/80",
        className,
      )}
      onClick={connect}
      disabled={status.kind === "connecting"}
    >
      {status.kind === "connecting" ? (
        <>
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          <span className="hidden sm:inline">Connecting…</span>
          <span className="sm:hidden">…</span>
        </>
      ) : (
        <>
          <Wallet className="w-3.5 h-3.5 mr-1.5" />
          <span className="hidden sm:inline">Connect Casper</span>
          <span className="sm:hidden">Casper</span>
        </>
      )}
    </Button>
  );
}
