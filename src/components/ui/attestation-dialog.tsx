"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store";
import { attestationService } from "@/lib/attestation-service";
import { useConviction } from "@/hooks/use-conviction";
import { useWalletClient } from "wagmi";
import {
    Shield,
    CheckCircle,
    AlertCircle,
    ExternalLink,
    Copy,
    Loader2,
    Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AttestationDialog() {
    const {
        attestationState,
        setAttestationState,
        showAttestationDialog,
        convictionMetrics,
        parameters,
        setUserConsent,
    } = useAppStore();

    const { activeAddress, isShowcaseMode } = useConviction();
    const { data: walletClient } = useWalletClient();
    const [eligibilityStatus, setEligibilityStatus] = React.useState<any>(null);
    const [isCheckingEligibility, setIsCheckingEligibility] = React.useState(false);
    const [shareReceipt, setShareReceipt] = React.useState<any>(null);
    const [writeReview, setWriteReview] = React.useState(false);

    // Check eligibility when dialog opens
    React.useEffect(() => {
        if (attestationState.showAttestationDialog && activeAddress && !isShowcaseMode) {
            checkEligibility();
        }
    }, [attestationState.showAttestationDialog, activeAddress, isShowcaseMode]);

    const checkEligibility = async () => {
        if (!activeAddress) return;

        setIsCheckingEligibility(true);
        try {
            const status = await attestationService.checkAttestationEligibility(activeAddress);
            setEligibilityStatus(status);
            setAttestationState({ canAttest: status.canAttest });
        } catch (error) {
            console.error('Eligibility check failed:', error);
            setEligibilityStatus({
                canAttest: false,
                reason: 'Unable to check eligibility. Please try again.',
            });
        } finally {
            setIsCheckingEligibility(false);
        }
    };

    const handleWriteAttestation = async () => {
        if (!activeAddress || !convictionMetrics || !attestationState.userConsent) return;

        setAttestationState({ isAttesting: true, attestationError: undefined });

        try {
            const chain = activeAddress.startsWith('0x') ? 'base' : 'solana';
            const response = await attestationService.writeConvictionAttestation({
                walletAddress: activeAddress,
                convictionMetrics,
                chain,
                timeHorizon: parameters.timeHorizon,
                userConsent: attestationState.userConsent,
                walletClient: walletClient ?? undefined,
                writeEthosReview: writeReview,
            });

            setAttestationState({
                attestationId: response.id,
                isAttesting: false,
            });

            // Use the new Toast system
            useAppStore.getState().showToast("Attestation submitted to Base", "success");

            // Generate share receipt with review URL if available
            const receipt = attestationService.generateConvictionReceipt(
                activeAddress,
                convictionMetrics,
                response.id
            );
            
            // Add review URL to receipt if present
            if (response.reviewUrl) {
                (receipt as any).reviewUrl = response.reviewUrl;
            }
            
            setShareReceipt(receipt);

        } catch (error) {
            console.error('Attestation failed:', error);
            setAttestationState({
                isAttesting: false,
                attestationError: error instanceof Error ? error.message : 'Attestation failed',
            });
            useAppStore.getState().showToast("Attestation failed", "error");
        }
    };

    const handleShare = async () => {
        if (!shareReceipt) return;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: shareReceipt.title,
                    text: shareReceipt.shareText,
                    url: shareReceipt.shareUrl,
                });
            } catch (error) {
                copyToClipboard(shareReceipt.shareText);
                useAppStore.getState().showToast("Copied to clipboard", "info");
            }
        } else {
            copyToClipboard(shareReceipt.shareText);
            useAppStore.getState().showToast("Copied to clipboard", "info");
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        useAppStore.getState().showToast("Copied to clipboard", "info");
    };

    const handleClose = () => {
        showAttestationDialog(false);
        setAttestationState({
            attestationId: undefined,
            attestationError: undefined,
            userConsent: false,
        });
        setShareReceipt(null);
        setEligibilityStatus(null);
    };

    if (isShowcaseMode) {
        return (
            <Dialog open={attestationState.showAttestationDialog} onOpenChange={handleClose}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-ethos">
                            <Shield className="w-5 h-5" />
                            Ethos Attestation
                        </DialogTitle>
                        <DialogDescription>
                            Write your conviction analysis to Ethos Network as permanent, portable reputation.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        <div className="flex items-center justify-center p-8 rounded-lg bg-surface/50 border border-border">
                            <div className="text-center space-y-3">
                                <AlertCircle className="w-12 h-12 text-foreground-muted mx-auto" />
                                <h3 className="text-lg font-semibold">Showcase Mode</h3>
                                <p className="text-sm text-foreground-muted max-w-sm">
                                    Connect your own wallet on Base to write conviction attestations to Ethos Network.
                                </p>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={attestationState.showAttestationDialog} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-ethos">
                        <Shield className="w-5 h-5" />
                        Ethos Attestation
                    </DialogTitle>
                    <DialogDescription>
                        Write your conviction analysis to Ethos Network as permanent, portable reputation.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Success State */}
                    {attestationState.attestationId && shareReceipt && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-center p-6 rounded-lg bg-patience/10 border border-patience/20">
                                <div className="text-center space-y-3">
                                    <CheckCircle className="w-12 h-12 text-patience mx-auto" />
                                    <h3 className="text-lg font-semibold">Attestation Recorded!</h3>
                                    <p className="text-sm text-foreground-muted">
                                        Your conviction is now verified on the Base blockchain.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-xs font-mono">
                                    <span className="text-foreground-muted uppercase tracking-widest">Transaction Hash</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-signal">{attestationState.attestationId.slice(0, 10)}...</span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => copyToClipboard(attestationState.attestationId!)}
                                        >
                                            <Copy className="w-3 h-3" />
                                        </Button>
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <Button onClick={handleShare} className="flex-1">
                                        <Share2 className="w-4 h-4 mr-2" />
                                        Share Receipt
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => window.open(`https://basescan.org/tx/${attestationState.attestationId}`, '_blank')}
                                        className="gap-2"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                        BaseScan
                                    </Button>
                                </div>
                                
                                {/* Show Ethos review link if available */}
                                {shareReceipt?.reviewUrl && (
                                    <div className="mt-3 p-3 rounded-lg bg-ethos/5 border border-ethos/20">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Shield className="w-4 h-4 text-ethos" />
                                                <span className="text-sm text-foreground">Ethos Review</span>
                                            </div>
                                            <Button
                                                variant="link"
                                                size="sm"
                                                className="text-xs text-ethos"
                                                onClick={() => window.open(shareReceipt.reviewUrl, '_blank')}
                                            >
                                                View on Ethos →
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Loading State */}
                    {isCheckingEligibility && (
                        <div className="flex items-center justify-center p-8">
                            <div className="text-center space-y-3">
                                <Loader2 className="w-8 h-8 animate-spin text-signal mx-auto" />
                                <p className="text-sm text-foreground-muted">Querying Ethos Credibility Oracle...</p>
                            </div>
                        </div>
                    )}

                    {/* Eligibility Check Results */}
                    {eligibilityStatus && !attestationState.attestationId && (
                        <div className="space-y-4">
                            {eligibilityStatus.canAttest ? (
                                <div className="space-y-4">
                                    <div className="p-4 rounded-lg bg-patience/10 border border-patience/20">
                                        <div className="flex items-start gap-3">
                                            <CheckCircle className="w-5 h-5 text-patience mt-0.5" />
                                            <div>
                                                <h4 className="font-medium text-patience">Reputation Verified</h4>
                                                <p className="text-sm text-foreground-muted mt-1">
                                                    Your Ethos score ({eligibilityStatus.requirements?.currentScore})
                                                    meets the conviction threshold.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Consent Checkbox */}
                                    <div className="space-y-3">
                                        <label className="flex items-start gap-3 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={attestationState.userConsent}
                                                onChange={(e) => setUserConsent(e.target.checked)}
                                                className="mt-1 accent-signal"
                                            />
                                            <div className="text-sm">
                                                <p className="text-foreground group-hover:text-signal transition-colors">
                                                    I consent to anchor my conviction analysis as a permanent attestation on Base.
                                                </p>
                                                <p className="text-foreground-muted mt-1 text-xs uppercase tracking-tighter">
                                                    Reputation is portable. Conviction is eternal.
                                                </p>
                                            </div>
                                        </label>
                                        
                                        {/* Ethos Review Option */}
                                        {convictionMetrics && convictionMetrics.score >= 50 && (
                                            <label className="flex items-start gap-3 cursor-pointer group">
                                                <input
                                                    type="checkbox"
                                                    checked={writeReview}
                                                    onChange={(e) => setWriteReview(e.target.checked)}
                                                    className="mt-1 accent-ethos"
                                                    disabled={!attestationState.userConsent}
                                                />
                                                <div className="text-sm">
                                                    <p className="text-foreground group-hover:text-ethos transition-colors">
                                                        Also publish my conviction as an Ethos review (optional)
                                                    </p>
                                                    <p className="text-foreground-muted mt-1 text-xs">
                                                        Makes your {convictionMetrics.score}/100 conviction score visible on Ethos Network for broader reputation building.
                                                    </p>
                                                </div>
                                            </label>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="space-y-3">
                                        <Button
                                            onClick={handleWriteAttestation}
                                            disabled={!attestationState.userConsent || attestationState.isAttesting}
                                            className="w-full relative overflow-hidden group h-12"
                                        >
                                            {attestationState.isAttesting ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                    SUBMITTING TO BASE EAS...
                                                </>
                                            ) : (
                                                <>
                                                    <Shield className="w-4 h-4 mr-2" />
                                                    WRITE ON-CHAIN ATTESTATION
                                                </>
                                            )}
                                        </Button>
                                        
                                        <div className="flex items-center justify-center gap-2 opacity-40">
                                            <span className="text-[9px] font-mono uppercase tracking-widest text-foreground-muted">
                                                Deployment:
                                            </span>
                                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-surface/50 text-[9px] font-mono text-foreground">
                                                BASE_MAINNET
                                            </div>
                                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-surface/50 text-[9px] font-mono text-foreground">
                                                EAS_PROTOCOL
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 rounded-lg bg-impatience/10 border border-impatience/20">
                                    <div className="flex items-start gap-3">
                                        <AlertCircle className="w-5 h-5 text-impatience mt-0.5" />
                                        <div>
                                            <h4 className="font-medium text-impatience">Reputation Required</h4>
                                            <p className="text-sm text-foreground-muted mt-1">
                                                {eligibilityStatus.reason}
                                            </p>
                                            <Button 
                                                variant="link" 
                                                className="p-0 h-auto text-xs text-signal mt-2"
                                                onClick={() => window.open('https://ethos.network', '_blank')}
                                            >
                                                Build your profile on Ethos →
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Error State */}
                    {attestationState.attestationError && (
                        <div className="p-4 rounded-lg bg-impatience/10 border border-impatience/20">
                            <div className="flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-impatience mt-0.5" />
                                <div>
                                    <h4 className="font-medium text-impatience">System Error</h4>
                                    <p className="text-sm text-foreground-muted mt-1">
                                        {attestationState.attestationError}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}