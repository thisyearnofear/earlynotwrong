"use client";

import { useState, useEffect } from "react";
import { useAleoConviction } from "@/hooks/use-aleo-conviction";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Search, Shield, ShieldCheck, Lock, Loader2, CheckCircle2, ExternalLink, Zap } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { APP_CONFIG } from "@/lib/config";

interface AleoProofDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Pull a numeric field out of an Aleo record plaintext, dropping the Leo type
 * suffix (`85u32` → 85). Returns null if the field isn't present.
 *
 * Plaintext looks like:
 *   { owner: aleo1..., score: 85u32, patience_tax: 100u64, archetype: 0u8, ... }
 */
function parseRecordField(plaintext: string, field: string): number | null {
  const match = plaintext.match(new RegExp(`${field}:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

const ARCHETYPE_LABELS = ["DIAMOND_HAND", "IRON_PILLAR", "PROFIT_PHANTOM", "EXIT_VOYAGER"];

export function AleoProofDialog({ isOpen, onClose }: AleoProofDialogProps) {
  const {
    verifyArchetype,
    verifyScoreThreshold,
    verifyEfficientTrading,
    listConvictionRecords,
    isAleoConnected,
  } = useAleoConviction();

  const { convictionMetrics } = useAppStore();
  const [step, setStep] = useState<"select" | "proving" | "result">("select");
  const [proofType, setProofType] = useState<"archetype" | "score" | "efficiency" | null>(null);
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    verified: boolean;
    status: string;
    program?: string;
    message?: string;
  } | null>(null);

  // The user's on-chain ConvictionRecord — fetched from the Shield wallet on
  // dialog open. Without it, the verify_* calls have no record to prove
  // against (the bug we replaced: `const record = ""`). null = not yet
  // fetched; [] = wallet returned zero records.
  const [records, setRecords] = useState<{ plaintext: string }[] | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const latestRecord = records && records.length > 0 ? records[0] : null;
  const latestScore = latestRecord ? parseRecordField(latestRecord.plaintext, "score") : null;
  const latestArchetype = latestRecord ? parseRecordField(latestRecord.plaintext, "archetype") : null;
  const latestPatienceTax = latestRecord ? parseRecordField(latestRecord.plaintext, "patience_tax") : null;

  useEffect(() => {
    if (!isOpen) return;
    setStep("select");
    setLastTxId(null);
    setVerificationResult(null);
    setRecordsError(null);
    setRecords(null);

    if (!isAleoConnected) return;
    // Fetch records on open. If the wallet denies decryption, surface the
    // error inline rather than letting the proof flow fail mid-transaction.
    let stale = false;
    (async () => {
      try {
        const list = await listConvictionRecords();
        if (!stale) setRecords(list ?? []);
      } catch (err) {
        if (!stale) {
          setRecordsError(err instanceof Error ? err.message : "Failed to load records");
          setRecords([]);
        }
      }
    })();
    return () => {
      stale = true;
    };
  }, [isOpen, isAleoConnected, listConvictionRecords]);

  const handleVerifyOnBackend = async () => {
    if (!lastTxId) return;
    setIsVerifying(true);
    try {
      const result = await apiClient.verifyAleoProof(lastTxId);
      setVerificationResult(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleGenerateProof = async (type: "archetype" | "score" | "efficiency") => {
    if (!latestRecord) {
      // Defensive — the proof buttons are disabled when there's no record,
      // but if something slipped through we don't want to send `record=""`
      // again (that was the bug — wallet adaptor returns "invalid input").
      setRecordsError("No ConvictionRecord found in your Aleo wallet — mint one first.");
      return;
    }

    setProofType(type);
    setStep("proving");

    try {
      // Pass the user's actual record plaintext to the verifier. The Leo
      // function takes it as `input r0 as ConvictionRecord.record` — the
      // wallet adaptor decodes the plaintext + computes the proof locally,
      // then submits the transition to Aleo.
      const recordInput = latestRecord.plaintext;
      let txId: string | undefined;

      if (type === "archetype") {
        // Prove the record's archetype matches the score-derived label.
        // We use the record's own archetype field so the proof always
        // succeeds for the actual minted value (verify_archetype asserts
        // equality; mismatched values panic on-chain).
        const archetypeValue = latestArchetype ?? 0;
        txId = await verifyArchetype(recordInput, archetypeValue);
      } else if (type === "score") {
        txId = await verifyScoreThreshold(recordInput, 80); // Prove score >= 80
      } else if (type === "efficiency") {
        txId = await verifyEfficientTrading(recordInput, 1000); // Prove tax <= $1000
      }

      if (txId) {
        setLastTxId(txId);
        setStep("result");
      }
    } catch (err) {
      console.error(err);
      setStep("select");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="glass-panel border-signal/30 bg-black/90 text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-signal">
            <Shield className="w-5 h-5" />
            Selective Disclosure
          </DialogTitle>
          <DialogDescription className="text-foreground-muted">
            Generate a zero-knowledge proof for specific metrics without revealing your full trade history.
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 py-4">
            {/* Record context strip — shows what we're proving WITH. Without
                a minted ConvictionRecord, every verify_* call would fail at
                the wallet boundary, so we gate the proof buttons on this. */}
            {records === null ? (
              <div className="p-3 rounded-lg bg-surface/50 border border-border/50 text-[10px] font-mono text-foreground-muted">
                <Loader2 className="w-3 h-3 inline mr-2 animate-spin" />
                Loading your private records from the Shield wallet…
              </div>
            ) : records.length === 0 ? (
              <div className="p-3 rounded-lg bg-impatience/10 border border-impatience/30 text-[11px] space-y-2">
                <p className="font-bold text-impatience uppercase font-mono tracking-wider">
                  <Lock className="w-3 h-3 inline mr-1" />
                  No private record yet
                </p>
                <p className="text-foreground-muted leading-relaxed">
                  Mint a Conviction Index record first — selective-disclosure proofs
                  need an on-chain record to prove things about. Close this dialog
                  and use the {`"MINT PRIVATE CI RECORD"`} button on the Private
                  Proofs card.
                </p>
                {recordsError && (
                  <p className="text-[10px] text-impatience/80 font-mono mt-1">
                    {recordsError}
                  </p>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-patience/5 border border-patience/30 text-[10px] font-mono">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-patience uppercase tracking-wider font-bold">
                    Proving with your latest record
                  </span>
                  {records.length > 1 && (
                    <span className="text-foreground-dim">
                      {records.length} records · using newest
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-foreground">
                  <div>
                    <span className="text-foreground-muted">SCORE</span>
                    <p className="text-sm font-bold">{latestScore ?? "—"}</p>
                  </div>
                  <div>
                    <span className="text-foreground-muted">ARCHETYPE</span>
                    <p className="text-sm font-bold">
                      {latestArchetype !== null ? ARCHETYPE_LABELS[latestArchetype] ?? `#${latestArchetype}` : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-foreground-muted">PATIENCE TAX</span>
                    <p className="text-sm font-bold">${latestPatienceTax ?? "—"}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-3">
              {(() => {
                const noRecordHint = "Mint a Conviction Index record first.";
                const scoreIneligible = latestRecord !== null && (latestScore ?? 0) < 80;
                const efficiencyIneligible =
                  latestRecord !== null && (latestPatienceTax ?? 9999) > 1000;
                const scoreHint = !latestRecord
                  ? noRecordHint
                  : scoreIneligible
                    ? `Score must be ≥ 80 to prove elite status (yours: ${latestScore ?? "—"}).`
                    : undefined;
                const efficiencyHint = !latestRecord
                  ? noRecordHint
                  : efficiencyIneligible
                    ? `Patience tax must be ≤ $1000 (yours: $${latestPatienceTax ?? "—"}).`
                    : undefined;
                const archetypeHint = !latestRecord ? noRecordHint : undefined;
                return (
                  <>
                    <Button
                      variant="outline"
                      className="flex items-center justify-between h-auto p-4 border-border/50 hover:border-signal/50 bg-surface/30 disabled:cursor-not-allowed"
                      onClick={() => handleGenerateProof("archetype")}
                      disabled={!latestRecord}
                      title={archetypeHint}
                    >
                      <div className="text-left">
                        <div className="text-sm font-bold">Prove Archetype</div>
                        <div className="text-[10px] text-foreground-muted">
                          Verify you are a &quot;{latestArchetype !== null ? ARCHETYPE_LABELS[latestArchetype] ?? convictionMetrics?.archetype : convictionMetrics?.archetype}&quot;
                        </div>
                      </div>
                      <Zap className="w-4 h-4 text-signal" />
                    </Button>

                    <Button
                      variant="outline"
                      className="flex items-center justify-between h-auto p-4 border-border/50 hover:border-signal/50 bg-surface/30 disabled:cursor-not-allowed"
                      onClick={() => handleGenerateProof("score")}
                      disabled={!latestRecord || scoreIneligible}
                      title={scoreHint}
                    >
                      <div className="text-left">
                        <div className="text-sm font-bold">Prove Elite Status</div>
                        <div className="text-[10px] text-foreground-muted">
                          Verify Conviction Score {">="} 80
                          {scoreIneligible && (
                            <span className="text-impatience/80 ml-1">· yours: {latestScore ?? "—"}</span>
                          )}
                        </div>
                      </div>
                      <ShieldCheck className="w-4 h-4 text-patience" />
                    </Button>

                    <Button
                      variant="outline"
                      className="flex items-center justify-between h-auto p-4 border-border/50 hover:border-signal/50 bg-surface/30 disabled:cursor-not-allowed"
                      onClick={() => handleGenerateProof("efficiency")}
                      disabled={!latestRecord || efficiencyIneligible}
                      title={efficiencyHint}
                    >
                      <div className="text-left">
                        <div className="text-sm font-bold">Prove Trading Efficiency</div>
                        <div className="text-[10px] text-foreground-muted">
                          Verify Patience Tax {"<="} $1000
                          {efficiencyIneligible && (
                            <span className="text-impatience/80 ml-1">· yours: ${latestPatienceTax ?? "—"}</span>
                          )}
                        </div>
                      </div>
                      <Lock className="w-4 h-4 text-signal" />
                    </Button>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {step === "proving" && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 text-signal animate-spin" />
            <div className="text-center">
              <div className="text-sm font-bold uppercase tracking-widest text-signal">Generating ZK-Proof</div>
              <p className="text-[10px] text-foreground-muted mt-1 font-mono">
                {">"} ENCRYPTING LOCAL STATE...<br/>
                {">"} COMPUTING PREDICATE...<br/>
                {">"} SHIELDING OUTPUT.
              </p>
            </div>
          </div>
        )}

        {step === "result" && (
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            <div className="relative">
              <CheckCircle2 className="w-16 h-16 text-patience" />
              <ShieldCheck className="w-6 h-6 text-signal absolute -bottom-1 -right-1" />
            </div>
            
            <div className="text-center">
              <h3 className="text-lg font-bold">Proof Generated</h3>
              <p className="text-[11px] text-foreground-muted max-w-xs mx-auto mt-1">
                A zero-knowledge proof of your {proofType} has been successfully verified on-chain.
              </p>
            </div>

            <div className="w-full p-3 rounded-lg bg-surface/50 border border-patience/20 font-mono text-[10px] break-all">
              <span className="text-patience/70 mr-2">TX_ID:</span>
              {lastTxId}
            </div>

            {verificationResult ? (
              <div className={cn(
                "w-full p-3 rounded-lg text-[10px] border",
                verificationResult.verified ? "bg-patience/10 border-patience/30 text-patience" : "bg-destructive/10 border-destructive/30 text-destructive"
              )}>
                <div className="font-bold uppercase flex items-center gap-1.5 mb-1">
                  {verificationResult.verified ? <ShieldCheck className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
                  {verificationResult.verified ? "Proof Verified by Oracle" : "Verification Pending"}
                </div>
                <div className="opacity-80">
                  {verificationResult.message || `Status: ${verificationResult.status}. Program: ${verificationResult.program}`}
                </div>
              </div>
            ) : lastTxId?.startsWith("shield_") ? (
              <div className="w-full p-3 rounded-lg bg-signal/10 border border-signal/30 text-signal text-[10px]">
                <div className="font-bold uppercase flex items-center gap-1.5 mb-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Shield Wallet Processing
                </div>
                <div className="opacity-80">
                  This transaction has a temporary ID and is currently being assigned a permanent on-chain hash. Verification will be available in a few seconds.
                </div>
              </div>
            ) : (
              <Button 
                variant="outline" 
                className="w-full border-signal/30 text-signal hover:bg-signal/10 text-[11px] h-9"
                onClick={handleVerifyOnBackend}
                disabled={isVerifying}
              >
                {isVerifying ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-2" />}
                VERIFY PROOF STATUS
              </Button>
            )}

            <div className="flex w-full gap-2">
              <Button 
                variant="outline" 
                className="flex-1 text-[11px] h-9"
                disabled={!lastTxId || lastTxId.startsWith("shield_")}
                onClick={() => window.open(`${APP_CONFIG.chains.aleo.explorerUrl}/transaction/${lastTxId}`, "_blank")}
              >
                {lastTxId?.startsWith("shield_") ? (
                  <>PROPAGATING...</>
                ) : (
                  <>
                    <ExternalLink className="w-3.5 h-3.5 mr-2" />
                    EXPLORER
                  </>
                )}
              </Button>
              <Button 
                className="flex-1 bg-signal hover:bg-signal/80 text-black font-bold text-[11px] h-9"
                onClick={onClose}
              >
                DONE
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
