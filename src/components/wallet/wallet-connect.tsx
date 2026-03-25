"use client";

import * as React from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LogOut, Copy, Check, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function shortenAddress(address: string | null | undefined) {
  if (!address) return "";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function WalletConnect({ className }: { className?: string }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [isClient, setIsClient] = React.useState(false);

  // Prevent hydration errors
  React.useEffect(() => {
    setIsClient(true);
  }, []);

  // EVM Hooks
  const {
    address: evmAddress,
    isConnected: isEvmConnected,
    isConnecting: isEvmConnecting,
  } = useAccount();
  const { connectors, connect: connectEvm } = useConnect();
  const { disconnect: disconnectEvm } = useDisconnect();

  // Solana Hooks
  const {
    publicKey,
    wallets,
    disconnect: disconnectSolana,
    select: selectSolanaWallet,
    connected: isSolanaConnected,
    connecting: isSolanaConnecting,
  } = useWallet();

  const solanaAddress = publicKey?.toBase58();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasAnyConnection = isEvmConnected || isSolanaConnected;
  const isAnyConnecting = isEvmConnecting || isSolanaConnecting;

  // Render nothing on server to prevent mismatch
  if (!isClient) {
    return (
      <Button
        variant="outline"
        className={cn(
          "font-mono text-xs tracking-wider opacity-50 cursor-not-allowed",
          className,
        )}
      >
        LOADING...
      </Button>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant={hasAnyConnection ? "outline" : "default"}
          className={cn("font-mono text-xs tracking-wider", className)}
        >
          {hasAnyConnection ? (
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-patience animate-pulse shadow-[0_0_8px_var(--patience)]" />
              {isEvmConnected
                ? shortenAddress(evmAddress)
                : shortenAddress(solanaAddress)}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {isAnyConnecting && <Loader2 className="w-3 h-3 animate-spin" />}
              CONNECT WALLET
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Connect Wallet</DialogTitle>
          <DialogDescription>
            Link your wallet to analyze conviction history.
            <br /> Supports Base (EVM) and Solana.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* EVM Section */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider font-mono flex items-center gap-2">
              <div className="w-1 h-3 bg-blue-500 rounded-full" />
              Base (EVM)
            </h4>

            {isEvmConnected ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-surface border border-border group hover:border-border-glow transition-colors">
                <div className="flex flex-col">
                  <span className="text-[10px] text-foreground-muted uppercase tracking-widest">
                    Connected
                  </span>
                  <span className="font-mono text-sm text-foreground">
                    {shortenAddress(evmAddress)}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => copyToClipboard(evmAddress!)}
                  >
                    {copied ? (
                      <Check className="w-3 h-3 text-patience" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-impatience/10 hover:text-impatience"
                    onClick={() => disconnectEvm()}
                  >
                    <LogOut className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {connectors
                  .filter((c) => c.id !== "injected")
                  .map((connector) => (
                    <Button
                      key={connector.uid}
                      variant="outline"
                      className="justify-between w-full font-normal border-border/50 hover:border-signal/50 hover:bg-surface-hover h-11"
                      onClick={() => {
                        connectEvm({ connector });
                        setIsOpen(false);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        {/* Placeholder icon logic could go here */}
                        {connector.name}
                      </span>
                      <ChevronRight className="w-4 h-4 text-foreground-muted" />
                    </Button>
                  ))}
                {connectors.length === 0 && (
                  <div className="text-xs text-foreground-muted text-center py-2">
                    No EVM wallets detected.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="h-px bg-border/50 w-full" />

          {/* Solana Section */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider font-mono flex items-center gap-2">
              <div className="w-1 h-3 bg-purple-500 rounded-full" />
              Solana
            </h4>

            {isSolanaConnected ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-surface border border-border group hover:border-border-glow transition-colors">
                <div className="flex flex-col">
                  <span className="text-[10px] text-foreground-muted uppercase tracking-widest">
                    Connected
                  </span>
                  <span className="font-mono text-sm text-foreground">
                    {shortenAddress(solanaAddress)}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => copyToClipboard(solanaAddress!)}
                  >
                    {copied ? (
                      <Check className="w-3 h-3 text-patience" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-impatience/10 hover:text-impatience"
                    onClick={() => disconnectSolana()}
                  >
                    <LogOut className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {wallets.map((w) => (
                  <Button
                    key={w.adapter.name}
                    variant="outline"
                    className="justify-between w-full font-normal border-border/50 hover:border-signal/50 hover:bg-surface-hover h-11"
                    onClick={() => {
                      selectSolanaWallet(w.adapter.name);
                      setIsOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {w.adapter.icon && (
                        <img
                          src={w.adapter.icon}
                          alt={w.adapter.name}
                          className="w-5 h-5 grayscale group-hover:grayscale-0 transition-all"
                        />
                      )}
                      {w.adapter.name}
                    </div>
                    <ChevronRight className="w-4 h-4 text-foreground-muted" />
                  </Button>
                ))}
                {wallets.length === 0 && (
                  <div className="text-xs text-foreground-muted text-center py-2">
                    No Solana wallets detected.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
