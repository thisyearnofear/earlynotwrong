"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWallet as useAleoWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { useAppStore } from "@/lib/store";
import { useCasperWallet, type CasperStatus } from "@/components/casper-wallet-provider";
import {
  connectionSectionId,
} from "@/lib/connections";
import { crooStoreUrl, dashboardHireUrl } from "@/lib/marketing-urls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  LogOut,
  Copy,
  Check,
  ChevronRight,
  Loader2,
  ShieldCheck,
  ExternalLink,
  Bot,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CASPER_WALLET_INSTALL_URL = "https://www.casperwallet.io/";

function shortenAddress(address: string | null | undefined) {
  if (!address) return "";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function connectionContextHint(pathname: string): string {
  if (pathname.startsWith("/analyzer")) {
    return "Paste any address to analyze. Connect Base or Solana to scan your own wallet.";
  }
  if (pathname.startsWith("/discovery")) {
    return "Discovery unlocks at Ethos ≥ 1000 — connect Base (EVM) after analyzing your wallet.";
  }
  if (pathname.startsWith("/agent")) {
    return "The agent trades on BSC autonomously. Casper is optional for your personal anchor.";
  }
  if (pathname.startsWith("/leaderboard")) {
    return "No connect required. Analyze a wallet on the analyzer to join rankings.";
  }
  return "Analyze any wallet without connecting. Connect per chain only when you need identity or signing.";
}

export function WalletConnect({ className }: { className?: string }) {
  const pathname = usePathname();
  const {
    isWalletModalOpen: isOpen,
    setWalletModalOpen: setIsOpen,
    walletModalFocus,
    setWalletModalFocus,
    mantle,
  } = useAppStore();
  const [copied, setCopied] = React.useState(false);
  const [isClient, setIsClient] = React.useState(false);

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  React.useEffect(() => {
    if (!isOpen || !walletModalFocus) return;
    const focus = walletModalFocus;
    const timer = window.setTimeout(() => {
      document
        .getElementById(connectionSectionId(focus))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      setWalletModalFocus(null);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [isOpen, walletModalFocus, setWalletModalFocus]);

  const {
    address: evmAddress,
    isConnected: isEvmConnected,
    isConnecting: isEvmConnecting,
  } = useAccount();
  const { connectors, connect: connectEvm } = useConnect();
  const { disconnect: disconnectEvm } = useDisconnect();

  const {
    publicKey,
    wallets,
    disconnect: disconnectSolana,
    select: selectSolanaWallet,
    connected: isSolanaConnected,
    connecting: isSolanaConnecting,
  } = useWallet();

  const solanaAddress = publicKey?.toBase58();
  const {
    address: aleoAddress,
    wallets: aleoWallets,
    selectWallet: selectAleoWallet,
    connected: isAleoConnected,
    connecting: isAleoConnecting,
    disconnect: disconnectAleo,
  } = useAleoWallet();

  const casper = useCasperWallet();
  const casperStatus = casper?.status;
  const isCasperConnected = casperStatus?.kind === "connected";
  const isCasperConnecting = casperStatus?.kind === "connecting";
  const casperPublicKey =
    casperStatus?.kind === "connected" ? casperStatus.publicKey : undefined;

  const evmAddressShort = shortenAddress(evmAddress);
  const solanaAddressShort = shortenAddress(solanaAddress);
  const aleoAddressShort = shortenAddress(aleoAddress);
  const casperAddressShort = shortenAddress(casperPublicKey);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasAnyConnection =
    isEvmConnected || isSolanaConnected || isAleoConnected || isCasperConnected;
  const isAnyConnecting =
    isEvmConnecting || isSolanaConnecting || isAleoConnecting || isCasperConnecting;

  const chainDots: Array<{ key: string; on: boolean; cls: string; label: string }> = [
    { key: "evm", on: isEvmConnected, cls: "bg-blue-500", label: "Base / EVM" },
    { key: "sol", on: isSolanaConnected, cls: "bg-purple-500", label: "Solana" },
    { key: "aleo", on: isAleoConnected, cls: "bg-signal", label: "Aleo" },
    { key: "casper", on: isCasperConnected, cls: "bg-teal-400", label: "Casper" },
  ];
  const connectedCount = chainDots.filter((d) => d.on).length;
  const primaryAddressShort = isEvmConnected
    ? evmAddressShort
    : isSolanaConnected
      ? solanaAddressShort
      : isAleoConnected
        ? aleoAddressShort
        : isCasperConnected
          ? casperAddressShort
          : "";

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
              <span
                className="flex items-center gap-0.5"
                title={`${connectedCount} of 4 chains connected`}
                aria-label={`${connectedCount} of 4 chains connected`}
              >
                {chainDots.map((d) => (
                  <span
                    key={d.key}
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      d.on
                        ? `${d.cls} shadow-[0_0_6px_currentColor]`
                        : "bg-foreground-dim/30",
                    )}
                    title={`${d.label}: ${d.on ? "connected" : "off"}`}
                  />
                ))}
              </span>
              <span>{primaryAddressShort}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {isAnyConnecting && <Loader2 className="w-3 h-3 animate-spin" />}
              {isAnyConnecting ? "CONNECTING…" : "CONNECTIONS"}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px] max-h-[min(90vh,720px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connections</DialogTitle>
          <DialogDescription asChild>
            <p className="text-sm text-foreground-muted leading-relaxed">
              {connectionContextHint(pathname)}
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          {/* EVM Section */}
          <div
            id={connectionSectionId("evm")}
            className={cn(
              "space-y-3 scroll-mt-4 rounded-lg -mx-1 px-1 transition-colors",
              walletModalFocus === "evm" && "ring-1 ring-blue-500/40 bg-blue-500/5",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider font-mono flex items-center gap-2">
                <div className="w-1 h-3 bg-blue-500 rounded-full" />
                Base (EVM)
              </h4>
              <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim shrink-0">
                Primary identity
              </span>
            </div>
            <p className="text-[11px] text-foreground-dim -mt-1">
              Ethos · Discovery unlock · Mantle anchor
            </p>
            {mantle.isMantleMode && (
              <div className="rounded-md border border-[#65b3ae]/30 bg-[#65b3ae]/5 px-3 py-2 text-[10px] font-mono text-[#65b3ae] leading-relaxed">
                Mantle mode is on — anchoring uses this wallet on Mantle Sepolia
                after you switch chain in the Mantle card.
              </div>
            )}
            {isEvmConnected ? (
              <ConnectedRow
                address={evmAddress!}
                copied={copied}
                onCopy={copyToClipboard}
                onDisconnect={() => disconnectEvm()}
              />
            ) : (
              <ConnectorList
                items={connectors
                  .filter((c) => c.id !== "injected")
                  .map((c) => ({
                    key: c.uid,
                    label: c.name,
                    onSelect: () => {
                      connectEvm({ connector: c });
                      setIsOpen(false);
                    },
                  }))}
                emptyMessage="No EVM wallets detected."
              />
            )}
          </div>

          <div className="h-px bg-border/50 w-full" />

          {/* Solana Section */}
          <div
            id={connectionSectionId("solana")}
            className={cn(
              "space-y-3 scroll-mt-4 rounded-lg -mx-1 px-1 transition-colors",
              walletModalFocus === "solana" && "ring-1 ring-purple-500/40 bg-purple-500/5",
            )}
          >
            <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider font-mono flex items-center gap-2">
              <div className="w-1 h-3 bg-purple-500 rounded-full" />
              Solana
            </h4>
            <p className="text-[11px] text-foreground-dim -mt-1">
              Analyze your Solana holdings
            </p>

            {isSolanaConnected ? (
              <ConnectedRow
                address={solanaAddress!}
                copied={copied}
                onCopy={copyToClipboard}
                onDisconnect={() => disconnectSolana()}
              />
            ) : (
              <ConnectorList
                items={wallets.map((w) => ({
                  key: w.adapter.name,
                  label: w.adapter.name,
                  icon: w.adapter.icon,
                  onSelect: () => {
                    selectSolanaWallet(w.adapter.name);
                    setIsOpen(false);
                  },
                }))}
                emptyMessage="No Solana wallets detected."
              />
            )}
          </div>

          <div className="h-px bg-border/50 w-full" />

          {/* Aleo Section */}
          <div
            id={connectionSectionId("aleo")}
            className={cn(
              "space-y-3 scroll-mt-4 rounded-lg -mx-1 px-1 transition-colors",
              walletModalFocus === "aleo" && "ring-1 ring-signal/40 bg-signal/5",
            )}
          >
            <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider font-mono flex items-center gap-2">
              <div className="w-1 h-3 bg-signal rounded-full" />
              Aleo
            </h4>
            <p className="text-[11px] text-foreground-dim -mt-1">
              Private thesis & Aleo conviction cards
            </p>

            {isAleoConnected ? (
              <ConnectedRow
                address={aleoAddress!}
                copied={copied}
                onCopy={copyToClipboard}
                onDisconnect={() => disconnectAleo()}
                badge={<ShieldCheck className="w-2.5 h-2.5 text-signal" />}
              />
            ) : (
              <ConnectorList
                items={aleoWallets.map((w) => ({
                  key: w.adapter.name,
                  label: w.adapter.name,
                  icon: w.adapter.icon,
                  onSelect: () => {
                    selectAleoWallet(w.adapter.name);
                    setIsOpen(false);
                  },
                }))}
                emptyMessage="No Aleo wallets detected."
              />
            )}
          </div>

          <div className="h-px bg-border/50 w-full" />

          {/* Casper Section */}
          <div
            id={connectionSectionId("casper")}
            className={cn(
              "space-y-3 scroll-mt-4 rounded-lg -mx-1 px-1 transition-colors",
              walletModalFocus === "casper" && "ring-1 ring-teal-400/40 bg-teal-400/5",
            )}
          >
            <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider font-mono flex items-center gap-2">
              <div className="w-1 h-3 bg-teal-400 rounded-full" />
              Casper
            </h4>
            <p className="text-[11px] text-foreground-dim -mt-1">
              Personal conviction anchor on testnet
            </p>

            <CasperSection
              status={casperStatus}
              connect={casper?.connect}
              disconnect={casper?.disconnect}
              copied={copied}
              onCopy={copyToClipboard}
              isConnecting={isCasperConnecting}
            />
          </div>

          <div className="h-px bg-border/50 w-full" />

          {/* Read-only info */}
          <div className="space-y-2">
            <div className="rounded-lg border border-border/40 bg-surface/30 p-3 space-y-1">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
                <Bot className="w-3 h-3" />
                Agent wallet (BSC)
              </div>
              <p className="text-[11px] text-foreground-dim leading-relaxed">
                Autonomous trading runs on the operator&apos;s BSC wallet — not yours.
              </p>
              <Link
                href="/agent"
                className="inline-flex items-center gap-1 text-[11px] font-mono text-signal hover:underline"
                onClick={() => setIsOpen(false)}
              >
                View agent dashboard
                <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="rounded-lg border border-border/40 bg-surface/30 p-3 space-y-1">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
                <Zap className="w-3 h-3" />
                Hire signals — no wallet
              </div>
              <p className="text-[11px] text-foreground-dim leading-relaxed">
                MCP (Casper x402) and CROO Store (USDC on Base) — no browser connect.
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <a
                  href={dashboardHireUrl("hire-cta")}
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-signal hover:underline"
                  onClick={() => setIsOpen(false)}
                >
                  Integration hub
                  <ChevronRight className="w-3 h-3" />
                </a>
                <a
                  href={crooStoreUrl("hire-cta", "connections-panel")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-foreground-muted hover:text-signal hover:underline"
                >
                  CROO Store
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConnectedRow({
  address,
  copied,
  onCopy,
  onDisconnect,
  badge,
}: {
  address: string;
  copied: boolean;
  onCopy: (text: string) => void;
  onDisconnect: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-surface border border-border group hover:border-border-glow transition-colors">
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-foreground-muted uppercase tracking-widest">
            Connected
          </span>
          {badge}
        </div>
        <span className="font-mono text-sm text-foreground truncate">
          {shortenAddress(address)}
        </span>
      </div>
      <div className="flex gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onCopy(address)}
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
          onClick={onDisconnect}
        >
          <LogOut className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function ConnectorList({
  items,
  emptyMessage,
}: {
  items: Array<{
    key: string;
    label: string;
    icon?: string;
    onSelect: () => void;
  }>;
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return (
      <div className="text-xs text-foreground-muted text-center py-2">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {items.map((item) => (
        <Button
          key={item.key}
          variant="outline"
          className="justify-between w-full font-normal border-border/50 hover:border-signal/50 hover:bg-surface-hover h-11"
          onClick={item.onSelect}
        >
          <span className="flex items-center gap-2">
            {item.icon && (
              <img
                src={item.icon}
                alt=""
                className="w-5 h-5 grayscale group-hover:grayscale-0 transition-all"
              />
            )}
            {item.label}
          </span>
          <ChevronRight className="w-4 h-4 text-foreground-muted" />
        </Button>
      ))}
    </div>
  );
}

function CasperSection({
  status,
  connect,
  disconnect,
  copied,
  onCopy,
  isConnecting,
}: {
  status: CasperStatus | undefined;
  connect: (() => Promise<void>) | undefined;
  disconnect: (() => Promise<void>) | undefined;
  copied: boolean;
  onCopy: (text: string) => void;
  isConnecting: boolean;
}) {
  if (!status || status.kind === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-3 text-xs text-foreground-muted font-mono">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Detecting Casper Wallet…
      </div>
    );
  }

  if (status.kind === "not-installed" || status.kind === "conflict") {
    return (
      <a
        href={CASPER_WALLET_INSTALL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between p-3 rounded-lg border border-signal/30 bg-signal/5 hover:bg-signal/10 transition-colors"
      >
        <span className="text-sm font-mono text-signal">Install Casper Wallet</span>
        <ExternalLink className="w-4 h-4 text-signal" />
      </a>
    );
  }

  if (status.kind === "locked") {
    return (
      <div className="rounded-lg border border-border/50 bg-surface/40 p-3 text-[11px] text-foreground-muted font-mono">
        Casper Wallet is locked — unlock the extension, then connect.
      </div>
    );
  }

  if (status.kind === "connected") {
    return (
      <ConnectedRow
        address={status.publicKey}
        copied={copied}
        onCopy={onCopy}
        onDisconnect={() => disconnect?.()}
      />
    );
  }

  return (
    <Button
      variant="outline"
      className="justify-between w-full font-normal border-border/50 hover:border-teal-400/50 hover:bg-surface-hover h-11"
      onClick={() => connect?.()}
      disabled={isConnecting || !connect}
    >
      <span className="flex items-center gap-2">
        {isConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
        {isConnecting ? "Connecting…" : "Connect Casper Wallet"}
      </span>
      <ChevronRight className="w-4 h-4 text-foreground-muted" />
    </Button>
  );
}
