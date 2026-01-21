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
            });

            setAttestationState({
                attestationId: response.id,
                isAttesting: false,
            });

            // Generate share receipt
            const receipt = attestationService.generateConvictionReceipt(
                activeAddress,
                convictionMetrics,
                response.id
            );
            setShareReceipt(receipt);

        } catch (error) {
            console.error('Attestation failed:', error);
            setAttestationState({
                isAttesting: false,
                attestationError: error instanceof Error ? error.message : 'Attestation failed',
            });
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
                // Fallback to clipboard
                copyToClipboard(shareReceipt.shareText);
            }
        } else {
            copyToClipboard(shareReceipt.shareText);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        // Could add a toast notification here
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
                        <DialogTitle className="flex items-center gap-2">
                            <Shield className="w-5 h-5 text-ethos" />
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
                                    Connect your own wallet to write conviction attestations to Ethos Network.
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
                    <DialogTitle className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-ethos" />
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
                                    <h3 className="text-lg font-semibold">Attestation Written!</h3>
                                    <p className="text-sm text-foreground-muted">
                                        Your conviction analysis is now permanently recorded on Ethos Network.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-foreground-muted">Attestation ID</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs">{attestationState.attestationId.slice(0, 8)}...</span>
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
                                        onClick={() => window.open(shareReceipt.shareUrl, '_blank')}
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Loading State */}
                    {isCheckingEligibility && (
                        <div className="flex items-center justify-center p-8">
                            <div className="text-center space-y-3">
                                <Loader2 className="w-8 h-8 animate-spin text-signal mx-auto" />
                                <p className="text-sm text-foreground-muted">Checking eligibility...</p>
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
                                                <h4 className="font-medium text-patience">Eligible for Attestation</h4>
                                                <p className="text-sm text-foreground-muted mt-1">
                                                    Your Ethos credibility score ({eligibilityStatus.requirements?.currentScore})
                                                    meets the minimum requirement ({eligibilityStatus.requirements?.minCredibilityScore}).
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Consent Checkbox */}
                                    <div className="space-y-3">
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={attestationState.userConsent}
                                                onChange={(e) => setUserConsent(e.target.checked)}
                                                className="mt-1 accent-signal"
                                            />
                                            <div className="text-sm">
                                                <p className="text-foreground">
                                                    I consent to writing my conviction analysis as a permanent attestation on Ethos Network.
                                                </p>
                                                <p className="text-foreground-muted mt-1">
                                                    This will create a public, immutable record of your trading behavior analysis.
                                                </p>
                                            </div>
                                        </label>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={handleWriteAttestation}
                                            disabled={!attestationState.userConsent || attestationState.isAttesting}
                                            className="flex-1"
                                        >
                                            {attestationState.isAttesting ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                    Writing Attestation...
                                                </>
                                            ) : (
                                                <>
                                                    <Shield className="w-4 h-4 mr-2" />
                                                    Write to Ethos
                                                </>
                                            )}
                                        </Button>
                                        <Button variant="outline" onClick={handleClose}>
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 rounded-lg bg-impatience/10 border border-impatience/20">
                                    <div className="flex items-start gap-3">
                                        <AlertCircle className="w-5 h-5 text-impatience mt-0.5" />
                                        <div>
                                            <h4 className="font-medium text-impatience">Not Eligible</h4>
                                            <p className="text-sm text-foreground-muted mt-1">
                                                {eligibilityStatus.reason}
                                            </p>
                                            {eligibilityStatus.requirements && (
                                                <div className="mt-3 text-xs text-foreground-muted">
                                                    <p>Required: {eligibilityStatus.requirements.minCredibilityScore} credibility score</p>
                                                    {eligibilityStatus.requirements.currentScore && (
                                                        <p>Current: {eligibilityStatus.requirements.currentScore}</p>
                                                    )}
                                                </div>
                                            )}
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
                                    <h4 className="font-medium text-impatience">Attestation Failed</h4>
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