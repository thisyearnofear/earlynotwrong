"use client";

/**
 * Casper Wallet detail card.
 *
 * Renders the full Casper Wallet interaction surface: balance, anchor-to-Casper
 * form (primary), and sign-proof (secondary). Uses the shared
 * CasperWalletProvider context for connection state — the navbar button handles
 * connect/disconnect; this card shows the details once connected.
 *
 * The anchor form can be pre-filled from the agent's live conviction data —
 * the same signals the agent uses to trade — so a judge can anchor the exact
 * record the agent just scored.
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
  KeyRound,
  ShieldCheck,
  AlertTriangle,
  Coins,
  Anchor,
  RefreshCw,
  Zap,
  ChevronDown,
} from "lucide-react";
import { useCasperWallet } from "@/components/casper-wallet-provider";

const CASPER_WALLET_INSTALL_URL = "https://www.casperwallet.io/";
const CASPER_TESTNET_EXPLORER = "https://testnet.cspr.live";
const PROXY_BASE = "/api/agent/proxy";

function shortKey(hex: string): string {
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

/** SHA-256 a string → 0x-prefixed 32-byte hex. Uses crypto.subtle (no
 *  keccak library needed in the browser). */
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

// ─── Agent conviction signal type (subset of /conviction response) ──────────

interface ConvictionSignal {
  symbol: string;
  score: number;
  rationale: string;
}

interface ConvictionResponse {
  signals: ConvictionSignal[];
}

export function CasperWalletConnect() {
  const ctx = useCasperWallet();

  // Sign proof state
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [showSignProof, setShowSignProof] = useState(false);

  // Balance state
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // Agent conviction signals (for pre-filling the anchor form)
  const [signals, setSignals] = useState<ConvictionSignal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsSource, setSignalsSource] = useState<"agent" | "default">("default");

  // Anchor state
  const [anchorSubject, setAnchorSubject] = useState("FET — Fetch.ai on BSC");
  const [anchorThesis, setAnchorThesis] = useState("Contrarian entry: quality AI asset down 7d during fear");
  const [anchorScore, setAnchorScore] = useState(72);
  const [anchoring, setAnchoring] = useState(false);
  const [anchorResult, setAnchorResult] = useState<{
    txHash: string;
    explorerUrl: string;
    subject: string;
    score: number;
    archetype: string;
  } | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const status = ctx?.status;
  const connected = status?.kind === "connected";
  const publicKey = status?.kind === "connected" ? status.publicKey : undefined;

  // ── Fetch balance ──
  const fetchBalance = useCallback(async (pubKey: string) => {
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const res = await fetch(`${PROXY_BASE}?endpoint=casper/balance&publicKey=${pubKey}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { balanceCspr: string };
      setBalance(data.balanceCspr);
    } catch (err) {
      setBalanceError(err instanceof Error ? err.message : "Failed to fetch balance.");
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  // ── Fetch agent's live conviction signals ──
  const fetchSignals = useCallback(async () => {
    setSignalsLoading(true);
    try {
      const res = await fetch(`${PROXY_BASE}?endpoint=conviction`);
      if (!res.ok) return;
      const data = (await res.json()) as ConvictionResponse;
      if (data.signals && data.signals.length > 0) {
        setSignals(data.signals);
      }
    } catch {
      /* best-effort — form still works with default values */
    } finally {
      setSignalsLoading(false);
    }
  }, []);

  // Fetch signals on mount (regardless of connection — so they're ready)
  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  // Auto-fetch balance on connect
  useEffect(() => {
    if (publicKey) {
      fetchBalance(publicKey);
    } else {
      setBalance(null);
      setBalanceError(null);
    }
  }, [publicKey, fetchBalance]);

  // Clear ephemeral state on disconnect
  useEffect(() => {
    if (!connected) {
      setSignature(null);
      setSignError(null);
      setAnchorResult(null);
      setAnchorError(null);
    }
  }, [connected]);

  // ── Pre-fill anchor form from agent's latest conviction ──
  const useAgentConviction = useCallback(
    (signal: ConvictionSignal) => {
      setAnchorSubject(signal.symbol);
      setAnchorThesis(signal.rationale || `Contrarian conviction signal for ${signal.symbol}`);
      setAnchorScore(signal.score);
      setSignalsSource("agent");
      setAnchorResult(null);
      setAnchorError(null);
    },
    [],
  );

  // ── Actions ──

  const signProof = useCallback(async () => {
    if (!ctx || status?.kind !== "connected") return;
    setSigning(true);
    setSignError(null);
    setSignature(null);
    try {
      const message = `Early, Not Wrong — Casper reputation proof @ ${new Date().toISOString()}`;
      const res = await ctx.signMessage(message);
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
  }, [ctx, status]);

  const anchorToCasper = useCallback(async () => {
    if (!ctx || status?.kind !== "connected") return;
    const pubKey = status.publicKey;
    setAnchoring(true);
    setAnchorError(null);
    setAnchorResult(null);
    try {
      const subjectHash = await hashTo0x32(anchorSubject);
      const thesisHash = await hashTo0x32(anchorThesis);
      const record = {
        subjectHash,
        thesisHash,
        convictionScore: anchorScore,
        archetype: archetypeForScore(anchorScore),
        timestamp: Date.now(),
      };

      // 1. Server builds the unsigned transaction.
      const buildRes = await fetch(`${PROXY_BASE}?endpoint=casper/build-anchor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: pubKey, record }),
      });
      if (!buildRes.ok) {
        const body = await buildRes.json().catch(() => ({}));
        throw new Error(body.error || `Build failed: HTTP ${buildRes.status}`);
      }
      const { transaction } = (await buildRes.json()) as { transaction: unknown };

      // 2. Wallet signs the transaction.
      const signRes = await ctx.signTransaction(JSON.stringify(transaction));
      if (signRes.cancelled) {
        setAnchorError("Signing cancelled in the wallet.");
        return;
      }
      if (signRes.error || !signRes.signature) {
        throw new Error(signRes.error ?? "Wallet returned no signature.");
      }

      // 3. Server submits the signed transaction.
      const submitRes = await fetch(`${PROXY_BASE}?endpoint=casper/submit-anchor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction, signature: signRes.signature, publicKey: pubKey }),
      });
      if (!submitRes.ok) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(body.error || `Submit failed: HTTP ${submitRes.status}`);
      }
      const result = (await submitRes.json()) as { txHash: string; explorerUrl: string };
      setAnchorResult({
        ...result,
        subject: anchorSubject,
        score: anchorScore,
        archetype: archetypeForScore(anchorScore),
      });
      fetchBalance(pubKey); // refresh balance after gas spend
    } catch (err) {
      setAnchorError(err instanceof Error ? err.message : "Anchoring failed.");
    } finally {
      setAnchoring(false);
    }
  }, [ctx, status, anchorSubject, anchorThesis, anchorScore, fetchBalance]);

  const copyKey = useCallback(() => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [publicKey]);

  // ── Render ──

  return (
    <Card className="bg-surface/30 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Wallet className="w-3.5 h-3.5 text-signal" />
          Casper Wallet
          <span className="ml-auto text-[10px] text-foreground-dim">
            {connected ? "Connected" : status?.kind === "not-installed" ? "Not installed" : status?.kind === "conflict" ? "Conflict" : "Testnet"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AnimatePresence mode="wait">
          {/* Loading */}
          {(!status || status.kind === "loading") && (
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
          {status?.kind === "not-installed" && (
            <motion.div
              key="not-installed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <p className="text-[11px] text-foreground-muted leading-relaxed">
                Connect your Casper Wallet to anchor conviction records on-chain.
              </p>
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

          {/* Conflict — another extension (HashPack) overwrote the global */}
          {status?.kind === "conflict" && (
            <motion.div
              key="conflict"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2 text-[11px] font-mono text-impatience">
                <AlertTriangle className="w-3.5 h-3.5" />
                Wallet extension conflict detected.
              </div>
              <p className="text-[10px] font-mono text-foreground-muted leading-relaxed">
                Another wallet extension (likely HashPack) is overwriting the
                Casper Wallet provider. To connect:
              </p>
              <ol className="text-[10px] font-mono text-foreground-muted leading-relaxed list-decimal list-inside space-y-1">
                <li>Disable HashPack (or other Casper wallet extensions) in your browser</li>
                <li>Refresh this page</li>
                <li>Connect with the Casper Wallet extension</li>
              </ol>
              <p className="text-[10px] font-mono text-foreground-dim">
                You can re-enable HashPack after connecting.
              </p>
            </motion.div>
          )}

          {/* Disconnected / locked / connecting → one-liner + hint */}
          {(status?.kind === "disconnected" || status?.kind === "locked" || status?.kind === "connecting") && (
            <motion.div
              key="connect-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <p className="text-[11px] text-foreground-muted leading-relaxed">
                Connect your Casper Wallet to anchor conviction records on-chain.
              </p>
              {status.kind === "locked" && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-impatience">
                  <Lock className="w-3.5 h-3.5" />
                  Wallet is locked — unlock it, then connect.
                </div>
              )}
              {status.kind === "disconnected" && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-foreground-muted">
                  <Wallet className="w-3.5 h-3.5 text-signal" />
                  Click <span className="text-signal">Connect Casper</span> in the header to start.
                </div>
              )}
              {status.kind === "connecting" && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-foreground-muted">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
                  Connecting…
                </div>
              )}
              {ctx?.error && (
                <p className="text-[10px] font-mono text-impatience flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {ctx.error}
                </p>
              )}
            </motion.div>
          )}

          {/* Connected → account + balance + anchor (primary) + sign proof (secondary) */}
          {status?.kind === "connected" && (
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

              {/* ── Anchor to Casper (PRIMARY action) ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
                  <Anchor className="w-3 h-3 text-signal" />
                  Anchor conviction to Casper
                </div>

                {/* Pre-fill from agent's live signals */}
                {signals.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-foreground-dim">
                      <Zap className="w-3 h-3 text-signal" />
                      Anchor the agent's live conviction:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {signals.slice(0, 5).map((s) => (
                        <button
                          key={s.symbol}
                          type="button"
                          onClick={() => useAgentConviction(s)}
                          disabled={anchoring}
                          className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                            anchorSubject === s.symbol && signalsSource === "agent"
                              ? "border-signal/50 bg-signal/15 text-signal"
                              : "border-border/40 bg-surface/40 text-foreground-muted hover:border-signal/30 hover:text-signal"
                          }`}
                          title={s.rationale}
                        >
                          {s.symbol} · {s.score}
                        </button>
                      ))}
                    </div>
                    {signalsSource === "agent" && (
                      <p className="text-[9px] font-mono text-foreground-dim">
                        Pre-filled from agent's latest cycle. Edit fields below or pick another signal.
                      </p>
                    )}
                  </div>
                )}
                {signalsLoading && signals.length === 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-foreground-dim">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading agent conviction signals…
                  </div>
                )}

                {/* Anchor form */}
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Subject</label>
                    <input
                      type="text"
                      value={anchorSubject}
                      onChange={(e) => {
                        setAnchorSubject(e.target.value);
                        setSignalsSource("default");
                      }}
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
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className="rounded-xl border-2 border-patience/50 bg-patience/10 p-4 space-y-3 shadow-[0_0_25px_-8px_var(--patience-dim)]"
                  >
                    <div className="flex items-center gap-2 text-xs font-mono text-patience uppercase tracking-wider">
                      <CheckCircle2 className="w-4 h-4" />
                      Conviction record anchored to Casper Testnet
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-surface/40 border border-border/30 p-2">
                        <p className="text-[9px] font-mono text-foreground-dim uppercase tracking-wider">Subject</p>
                        <p className="text-[11px] font-mono text-foreground truncate" title={anchorResult.subject}>
                          {anchorResult.subject}
                        </p>
                      </div>
                      <div className="rounded-lg bg-surface/40 border border-border/30 p-2">
                        <p className="text-[9px] font-mono text-foreground-dim uppercase tracking-wider">Score</p>
                        <p className="text-lg font-bold font-mono text-signal tabular-nums">
                          {anchorResult.score}
                        </p>
                      </div>
                      <div className="rounded-lg bg-surface/40 border border-border/30 p-2">
                        <p className="text-[9px] font-mono text-foreground-dim uppercase tracking-wider">Archetype</p>
                        <p className="text-[9px] font-mono text-foreground-muted leading-tight">
                          {anchorResult.archetype}
                        </p>
                      </div>
                    </div>
                    <a
                      href={anchorResult.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border border-signal/40 bg-signal/10 text-signal text-[11px] font-mono hover:bg-signal/20 transition-colors"
                    >
                      View transaction on cspr.live
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <p className="text-[9px] font-mono text-foreground-dim text-center break-all">
                      {anchorResult.txHash}
                    </p>
                  </motion.div>
                )}
                {anchorError && (
                  <p className="text-[10px] font-mono text-impatience flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {anchorError}
                  </p>
                )}
              </div>

              {/* ── Sign proof (SECONDARY — collapsible) ── */}
              <div className="pt-1 border-t border-border/30">
                <button
                  type="button"
                  onClick={() => setShowSignProof((v) => !v)}
                  className="w-full flex items-center gap-2 text-[10px] font-mono text-foreground-muted uppercase tracking-wider hover:text-foreground transition-colors py-1"
                >
                  <ShieldCheck className="w-3 h-3" />
                  Sign proof message
                  <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showSignProof ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence initial={false}>
                  {showSignProof && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden space-y-2"
                    >
                      <p className="text-[10px] text-foreground-dim leading-relaxed pt-1">
                        Prove wallet ownership by signing a timestamped message.
                      </p>
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
                            Sign proof
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
