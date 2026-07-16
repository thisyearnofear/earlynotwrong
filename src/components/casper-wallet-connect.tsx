"use client";

/**
 * Casper Wallet connection component.
 *
 * The Casper Wallet browser extension injects `window.CasperWalletProvider`
 * (asynchronously — the content script loads after the page). This component
 * polls for it, exposes a Connect button, keeps the UI in sync with wallet
 * lifecycle events (Connected / Disconnected / ActiveKeyChanged / Locked /
 * Unlocked), and provides three user-facing actions:
 *
 *   1. Sign proof message — proves the connection is live end-to-end.
 *   2. Balance — queries the connected account's CSPR testnet balance via
 *      the agent server proxy (CSPR_CLOUD_TOKEN stays server-side).
 *   3. Anchor to Casper — builds an anchor_conviction transaction on the
 *      server, signs it with the wallet, and submits it to the live
 *      ConvictionRegistry contract. The user pays gas from their own account.
 *
 * The extension is the sole signer — no private keys leave the browser.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Copy,
  Loader2,
  Lock,
  Unlock,
  KeyRound,
  ShieldCheck,
  AlertTriangle,
  Coins,
  Anchor,
  RefreshCw,
} from "lucide-react";

// ─── Casper Wallet provider types ───────────────────────────────────────────
// Mirrors the injected globals from make-software/casper-wallet-sdk. The SDK
// is not an npm dependency — the extension injects these at runtime.

interface SignatureResponse {
  signature?: string;
  cancelled?: boolean;
  error?: string;
  errorCode?: number;
}

interface CasperWalletProvider {
  requestConnection(): Promise<boolean>;
  requestSwitchAccount(): Promise<boolean>;
  disconnectFromSite(): Promise<boolean>;
  isConnected(): Promise<boolean>;
  getActivePublicKey(): Promise<string>;
  getActivePublicKeySupports(): Promise<string[]>;
  getVersion(): Promise<string>;
  sign(transactionJson: string, signingPublicKeyHex: string): Promise<SignatureResponse>;
  signMessage(message: string, signingPublicKeyHex: string): Promise<SignatureResponse>;
  on(eventType: string, handler: (event: { detail: string }) => void): () => void;
}

type CasperWalletProviderConstructor = new (opts?: { timeout: number }) => CasperWalletProvider;

interface CasperWalletState {
  isLocked: boolean;
  isConnected: boolean | undefined;
  activeKey: string | undefined;
  activeKeySupports: string[] | undefined;
}

declare global {
  interface Window {
    CasperWalletProvider?: CasperWalletProviderConstructor;
    CasperWalletEventTypes?: Record<string, string>;
  }
}

// Casper Wallet event type names. The extension also exposes
// `window.CasperWalletEventTypes`, but the string literals are stable and we
// don't want to depend on the global being present before subscribing.
const EVENT = {
  connected: "connected",
  disconnected: "disconnected",
  activeKeyChanged: "activeKeyChanged",
  tabUpdated: "tabUpdated",
  locked: "locked",
  unlocked: "unlocked",
} as const;

const CASPER_WALLET_INSTALL_URL = "https://www.casperwallet.io/";
const CASPER_TESTNET_EXPLORER = "https://testnet.cspr.live";
const PROXY_BASE = "/api/agent/proxy";

type Status =
  | { kind: "loading" } // waiting for the extension to inject
  | { kind: "not-installed" }
  | { kind: "disconnected"; provider: CasperWalletProvider }
  | { kind: "connecting"; provider: CasperWalletProvider }
  | { kind: "connected"; provider: CasperWalletProvider; publicKey: string; version?: string }
  | { kind: "locked"; provider: CasperWalletProvider };

function shortKey(hex: string): string {
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

/** SHA-256 a string and return 0x-prefixed 32-byte hex. The contract stores
 *  any 32 bytes; we use SHA-256 (available natively via crypto.subtle) rather
 *  than keccak256 to avoid bundling a hash library in the browser. */
async function hashTo0x32(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return "0x" + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function archetypeForScore(score: number): string {
  if (score >= 80) return "DEEP FEAR — PRIME CONTRARIAN";
  if (score >= 60) return "FEAR — CONTRARIAN WINDOW";
  if (score >= 40) return "NEUTRAL — WAIT";
  if (score >= 20) return "GREED — CAUTION";
  return "EXTREME GREED — AVOID";
}

export function CasperWalletConnect() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sign proof state
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  // Balance state
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // Anchor state
  const [anchorSubject, setAnchorSubject] = useState("FET — Fetch.ai on BSC");
  const [anchorThesis, setAnchorThesis] = useState("Contrarian entry: quality AI asset down 7d during fear");
  const [anchorScore, setAnchorScore] = useState(72);
  const [anchoring, setAnchoring] = useState(false);
  const [anchorResult, setAnchorResult] = useState<{ txHash: string; explorerUrl: string } | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);

  // ── Resolve the injected provider (async) ──
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 40; // ~8s at 200ms intervals

    const poll = setInterval(() => {
      attempts += 1;
      if (typeof window !== "undefined" && window.CasperWalletProvider) {
        clearInterval(poll);
        if (cancelled) return;
        const provider = new window.CasperWalletProvider();
        // Sync initial state.
        provider
          .isConnected()
          .then(async (connected) => {
            if (cancelled) return;
            if (!connected) {
              setStatus({ kind: "disconnected", provider });
              return;
            }
            try {
              const publicKey = await provider.getActivePublicKey();
              if (cancelled) return;
              let version: string | undefined;
              try {
                version = await provider.getVersion();
              } catch {
                /* version is best-effort */
              }
              setStatus({ kind: "connected", provider, publicKey, version });
            } catch (err) {
              // Connected but locked, or not yet site-approved.
              if (cancelled) return;
              if (isLockedError(err)) {
                setStatus({ kind: "locked", provider });
              } else {
                setStatus({ kind: "disconnected", provider });
              }
            }
          })
          .catch(() => {
            if (!cancelled) setStatus({ kind: "disconnected", provider });
          });
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
        if (!cancelled) setStatus({ kind: "not-installed" });
      }
    }, 200);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  // ── Subscribe to wallet lifecycle events ──
  useEffect(() => {
    if (status.kind === "loading" || status.kind === "not-installed") return;
    const provider = status.provider;

    const unsubscribers: Array<() => void> = [];

    const parse = (event: { detail: string }): CasperWalletState | null => {
      try {
        return JSON.parse(event.detail) as CasperWalletState;
      } catch {
        return null;
      }
    };

    const syncFromState = (state: CasperWalletState | null) => {
      if (!state) return;
      if (state.isLocked) {
        setStatus({ kind: "locked", provider });
        return;
      }
      if (!state.isConnected || !state.activeKey) {
        setStatus({ kind: "disconnected", provider });
        return;
      }
      setStatus({ kind: "connected", provider, publicKey: state.activeKey });
    };

    unsubscribers.push(provider.on(EVENT.connected, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.disconnected, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.activeKeyChanged, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.tabUpdated, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.locked, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.unlocked, (e) => syncFromState(parse(e))));

    return () => {
      for (const off of unsubscribers) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
    };
  }, [status]);

  // ── Fetch balance when connected ──
  const fetchBalance = useCallback(async (publicKey: string) => {
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const res = await fetch(`${PROXY_BASE}?endpoint=casper/balance&publicKey=${publicKey}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { balanceCspr: string; balanceMotes: string };
      setBalance(data.balanceCspr);
    } catch (err) {
      setBalanceError(err instanceof Error ? err.message : "Failed to fetch balance.");
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  // Auto-fetch balance on connect
  useEffect(() => {
    if (status.kind === "connected") {
      fetchBalance(status.publicKey);
    } else {
      setBalance(null);
      setBalanceError(null);
    }
  }, [status, fetchBalance]);

  const connect = useCallback(async () => {
    if (status.kind !== "disconnected" && status.kind !== "locked") return;
    const provider = status.provider;
    setStatus({ kind: "connecting", provider });
    setError(null);
    try {
      const accepted = await provider.requestConnection();
      if (!accepted) {
        setStatus({ kind: "disconnected", provider });
        setError("Connection request was declined in the wallet.");
        return;
      }
      const publicKey = await provider.getActivePublicKey();
      let version: string | undefined;
      try {
        version = await provider.getVersion();
      } catch {
        /* best-effort */
      }
      setStatus({ kind: "connected", provider, publicKey, version });
    } catch (err) {
      setStatus({ kind: "disconnected", provider });
      setError(err instanceof Error ? err.message : "Failed to connect.");
    }
  }, [status]);

  const disconnect = useCallback(async () => {
    if (status.kind !== "connected") return;
    const provider = status.provider;
    try {
      await provider.disconnectFromSite();
    } catch {
      /* ignore — UI syncs via the Disconnected event anyway */
    }
    setStatus({ kind: "disconnected", provider });
    setSignature(null);
    setSignError(null);
    setAnchorResult(null);
    setAnchorError(null);
  }, [status]);

  const signProof = useCallback(async () => {
    if (status.kind !== "connected") return;
    const { provider, publicKey } = status;
    setSigning(true);
    setSignError(null);
    setSignature(null);
    try {
      const message = `Early, Not Wrong — Casper reputation proof @ ${new Date().toISOString()}`;
      const res = await provider.signMessage(message, publicKey);
      if (res.cancelled) {
        setSignError("Signing cancelled in the wallet.");
      } else if (res.error) {
        setSignError(`${res.error}${res.errorCode != null ? ` (code ${res.errorCode})` : ""}`);
      } else if (res.signature) {
        setSignature(res.signature);
      } else {
        setSignError("Wallet returned no signature.");
      }
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Signing failed.");
    } finally {
      setSigning(false);
    }
  }, [status]);

  const anchorToCasper = useCallback(async () => {
    if (status.kind !== "connected") return;
    const { provider, publicKey } = status;
    setAnchoring(true);
    setAnchorError(null);
    setAnchorResult(null);
    try {
      // 1. Hash subject + thesis to 32-byte hex (SHA-256 via crypto.subtle).
      const subjectHash = await hashTo0x32(anchorSubject);
      const thesisHash = await hashTo0x32(anchorThesis);
      const record = {
        subjectHash,
        thesisHash,
        convictionScore: anchorScore,
        archetype: archetypeForScore(anchorScore),
        timestamp: Date.now(),
      };

      // 2. Ask the server to build the unsigned transaction.
      const buildRes = await fetch(`${PROXY_BASE}?endpoint=casper/build-anchor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, record }),
      });
      if (!buildRes.ok) {
        const body = await buildRes.json().catch(() => ({}));
        throw new Error(body.error || `Build failed: HTTP ${buildRes.status}`);
      }
      const { transaction } = (await buildRes.json()) as { transaction: unknown };

      // 3. Ask the wallet to sign the transaction.
      const signRes = await provider.sign(JSON.stringify(transaction), publicKey);
      if (signRes.cancelled) {
        setAnchorError("Signing cancelled in the wallet.");
        return;
      }
      if (signRes.error || !signRes.signature) {
        throw new Error(signRes.error ?? "Wallet returned no signature.");
      }

      // 4. Submit the signed transaction via the server.
      const submitRes = await fetch(`${PROXY_BASE}?endpoint=casper/submit-anchor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction, signature: signRes.signature, publicKey }),
      });
      if (!submitRes.ok) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(body.error || `Submit failed: HTTP ${submitRes.status}`);
      }
      const result = (await submitRes.json()) as { txHash: string; explorerUrl: string };
      setAnchorResult(result);
      // Refresh balance after anchoring (gas was spent).
      fetchBalance(publicKey);
    } catch (err) {
      setAnchorError(err instanceof Error ? err.message : "Anchoring failed.");
    } finally {
      setAnchoring(false);
    }
  }, [status, anchorSubject, anchorThesis, anchorScore, fetchBalance]);

  const copyKey = useCallback(() => {
    if (status.kind !== "connected") return;
    navigator.clipboard.writeText(status.publicKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [status]);

  // ── Render ──
  const connected = status.kind === "connected";

  return (
    <Card className="bg-surface/30 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Wallet className="w-3.5 h-3.5 text-signal" />
          Casper Wallet
          <span className="ml-auto text-[10px] text-foreground-dim">
            {connected ? "Connected" : status.kind === "not-installed" ? "Not installed" : "Testnet"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-foreground-muted leading-relaxed">
          Connect your Casper Wallet to check your CSPR balance, sign a proof
          message, and anchor your own conviction record to the live
          ConvictionRegistry contract on Casper Testnet. The wallet extension
          is the sole signer — no keys leave the browser.
        </p>

        <AnimatePresence mode="wait">
          {/* Loading — extension still injecting */}
          {status.kind === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 text-[11px] font-mono text-foreground-muted"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
              Looking for the Casper Wallet extension…
            </motion.div>
          )}

          {/* Not installed */}
          {status.kind === "not-installed" && (
            <motion.div
              key="not-installed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2 text-[11px] font-mono text-impatience">
                <XCircle className="w-3.5 h-3.5" />
                Casper Wallet extension not detected.
              </div>
              <a
                href={CASPER_WALLET_INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-mono text-signal hover:underline"
              >
                Install Casper Wallet
                <ExternalLink className="w-3 h-3" />
              </a>
            </motion.div>
          )}

          {/* Disconnected / locked / connecting → Connect button */}
          {(status.kind === "disconnected" || status.kind === "locked" || status.kind === "connecting") && (
            <motion.div
              key="connect"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {status.kind === "locked" && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-impatience">
                  <Lock className="w-3.5 h-3.5" />
                  Wallet is locked — unlock it, then connect.
                </div>
              )}
              <Button
                size="sm"
                variant="default"
                onClick={connect}
                disabled={status.kind === "connecting"}
                className="w-full"
              >
                {status.kind === "connecting" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  <>
                    <Wallet className="w-3.5 h-3.5 mr-1.5" />
                    Connect Casper Wallet
                  </>
                )}
              </Button>
              {error && (
                <p className="text-[10px] font-mono text-impatience flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {error}
                </p>
              )}
            </motion.div>
          )}

          {/* Connected → account + balance + actions */}
          {status.kind === "connected" && (
            <motion.div
              key="connected"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              {/* Account info */}
              <div className="rounded-lg bg-surface/40 border border-border/40 p-3 space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
                  <CheckCircle2 className="w-3 h-3 text-patience" />
                  Active account
                  {status.version && (
                    <span className="ml-auto text-foreground-dim normal-case">v{status.version}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-signal shrink-0" />
                  <code className="text-[11px] font-mono text-foreground truncate flex-1">
                    {shortKey(status.publicKey)}
                  </code>
                  <button
                    type="button"
                    onClick={copyKey}
                    className="text-foreground-muted hover:text-signal transition-colors shrink-0"
                    title="Copy public key"
                  >
                    {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-patience" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {/* Balance row */}
                <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                  <Coins className="w-3.5 h-3.5 text-patience shrink-0" />
                  <span className="text-[11px] font-mono text-foreground-muted">Balance</span>
                  <span className="text-[11px] font-mono text-foreground tabular-nums ml-auto">
                    {balanceLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin inline" />
                    ) : balance !== null ? (
                      `${balance} CSPR`
                    ) : balanceError ? (
                      <span className="text-impatience">{balanceError}</span>
                    ) : (
                      "—"
                    )}
                  </span>
                  {!balanceLoading && (
                    <button
                      type="button"
                      onClick={() => fetchBalance(status.publicKey)}
                      className="text-foreground-muted hover:text-signal transition-colors shrink-0"
                      title="Refresh balance"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <a
                  href={`${CASPER_TESTNET_EXPLORER}/account/${status.publicKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-mono text-signal hover:underline"
                >
                  View on cspr.live
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>

              {/* Sign proof */}
              <div className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={signProof}
                  disabled={signing}
                  className="w-full"
                >
                  {signing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Awaiting wallet approval…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                      Sign proof message
                    </>
                  )}
                </Button>

                {signature && (
                  <div className="rounded-lg border border-patience/40 bg-patience/5 p-2.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-patience uppercase tracking-wider">
                      <CheckCircle2 className="w-3 h-3" />
                      Signature verified
                    </div>
                    <code className="block text-[10px] font-mono text-foreground-muted break-all leading-relaxed">
                      {signature.slice(0, 96)}…
                    </code>
                  </div>
                )}
                {signError && (
                  <p className="text-[10px] font-mono text-impatience flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {signError}
                  </p>
                )}
              </div>

              {/* Anchor to Casper */}
              <div className="space-y-2 pt-2 border-t border-border/30">
                <div className="flex items-center gap-2 text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
                  <Anchor className="w-3 h-3 text-signal" />
                  Anchor conviction to Casper
                </div>
                <p className="text-[10px] text-foreground-muted leading-relaxed">
                  Build a transaction on the server, sign it with your wallet,
                  and submit it to the live ConvictionRegistry. You pay gas
                  from your connected account.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Subject</label>
                    <input
                      type="text"
                      value={anchorSubject}
                      onChange={(e) => setAnchorSubject(e.target.value)}
                      disabled={anchoring}
                      className="w-full mt-0.5 px-2 py-1.5 rounded bg-surface/60 border border-border/50 text-[11px] font-mono text-foreground focus:outline-none focus:border-signal/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Thesis</label>
                    <input
                      type="text"
                      value={anchorThesis}
                      onChange={(e) => setAnchorThesis(e.target.value)}
                      disabled={anchoring}
                      className="w-full mt-0.5 px-2 py-1.5 rounded bg-surface/60 border border-border/50 text-[11px] font-mono text-foreground focus:outline-none focus:border-signal/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
                      Conviction score: <span className="text-signal">{anchorScore}</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={anchorScore}
                      onChange={(e) => setAnchorScore(Number(e.target.value))}
                      disabled={anchoring}
                      className="w-full mt-1 accent-signal"
                    />
                    <p className="text-[10px] font-mono text-foreground-dim mt-0.5">
                      Archetype: {archetypeForScore(anchorScore)}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="default"
                  onClick={anchorToCasper}
                  disabled={anchoring}
                  className="w-full"
                >
                  {anchoring ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Awaiting wallet approval…
                    </>
                  ) : (
                    <>
                      <Anchor className="w-3.5 h-3.5 mr-1.5" />
                      Anchor to Casper Testnet
                    </>
                  )}
                </Button>
                {anchorResult && (
                  <div className="rounded-lg border border-patience/40 bg-patience/5 p-2.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-patience uppercase tracking-wider">
                      <CheckCircle2 className="w-3 h-3" />
                      Anchored successfully
                    </div>
                    <a
                      href={anchorResult.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-signal hover:underline"
                    >
                      {anchorResult.txHash.slice(0, 20)}…
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                )}
                {anchorError && (
                  <p className="text-[10px] font-mono text-impatience flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {anchorError}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={disconnect} className="text-foreground-muted">
                  <Unlock className="w-3 h-3 mr-1.5" />
                  Disconnect
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

// Casper Wallet throws errors with a numeric `code` when locked (1) or not
// site-approved (2). We treat code 1 as "locked" so we can show a tailored
// prompt instead of a generic failure.
function isLockedError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: number }).code;
  return code === 1;
}
