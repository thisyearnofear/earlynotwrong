/**
 * Attestation Service
 * Handles writing conviction analysis to Ethos Network as permanent, portable reputation.
 * Supports both public and private (Privacy Cash) attestation modes.
 */

import { ethosClient, ConvictionAttestation, AttestationResponse } from './ethos';
import { ConvictionMetrics } from './market';
import { WalletClient } from 'viem';
import { prepareEthosReview, writeEthosReview, shouldPromptForReview, getEthosReviewURL } from './ethos-reviews';
import { privacyCashClient } from './privacy-cash';

export interface AttestationRequest {
    walletAddress: string;
    convictionMetrics: ConvictionMetrics;
    chain: 'solana' | 'base';
    timeHorizon: number;
    userConsent: boolean;
    walletClient?: WalletClient;
    writeEthosReview?: boolean; // Optional: write review to Ethos alongside attestation
    isPrivate?: boolean; // Use Privacy Cash for private attestation
}

export interface PrivateAttestationResponse {
    attestationHash: string;
    proofData: string;
    expiresAt: number;
    isPrivate: true;
    disclosureUrl?: string;
}

export interface AttestationStatus {
    canAttest: boolean;
    reason?: string;
    requirements?: {
        minCredibilityScore: number;
        currentScore?: number;
        costInEth?: number;
    };
}

export class AttestationService {
    /**
     * Check if user can write conviction attestations
     */
    async checkAttestationEligibility(walletAddress: string): Promise<AttestationStatus> {
        try {
            const [canWrite, requirements, score] = await Promise.all([
                ethosClient.canWriteAttestations(walletAddress),
                ethosClient.getAttestationRequirements(),
                ethosClient.getScoreByAddress(walletAddress).catch(() => null),
            ]);

            if (!canWrite) {
                return {
                    canAttest: false,
                    reason: score
                        ? `Insufficient credibility score. Need ${requirements.minCredibilityScore}, have ${score.score}`
                        : 'No Ethos profile found. Create an Ethos profile first.',
                    requirements: {
                        minCredibilityScore: requirements.minCredibilityScore,
                        currentScore: score?.score,
                        costInEth: requirements.costInEth,
                    },
                };
            }

            return {
                canAttest: true,
                requirements: {
                    minCredibilityScore: requirements.minCredibilityScore,
                    currentScore: score?.score,
                    costInEth: requirements.costInEth,
                },
            };
        } catch (error) {
            console.error('Attestation eligibility check failed:', error);
            return {
                canAttest: false,
                reason: 'Unable to verify eligibility. Please try again.',
            };
        }
    }

    /**
     * Write conviction analysis as permanent attestation
     */
    async writeConvictionAttestation(request: AttestationRequest): Promise<AttestationResponse> {
        if (!request.userConsent) {
            throw new Error('User consent required for writing attestations');
        }

        // Check eligibility first
        const eligibility = await this.checkAttestationEligibility(request.walletAddress);
        if (!eligibility.canAttest) {
            throw new Error(eligibility.reason || 'Not eligible to write attestations');
        }

        // Prepare attestation data
        const attestation: ConvictionAttestation = {
            subject: request.walletAddress,
            convictionScore: request.convictionMetrics.score,
            patienceTax: request.convictionMetrics.patienceTax,
            upsideCapture: request.convictionMetrics.upsideCapture,
            archetype: request.convictionMetrics.archetype || 'Unknown',
            totalPositions: request.convictionMetrics.totalPositions || 0,
            winRate: request.convictionMetrics.winRate || 0,
            analysisDate: new Date().toISOString(),
            timeHorizon: request.timeHorizon,
            chain: request.chain,
        };

        try {
            // REAL ON-CHAIN IMPLEMENTATION (BASE)
            if (request.chain === 'base' && request.walletClient) {
                console.log('Initiating Real On-Chain Attestation on Base...');
                const txHash = await ethosClient.submitOnChainAttestation(attestation, request.walletClient);
                
                const response: AttestationResponse = {
                    id: txHash, // Use tx hash as ID
                    hash: txHash,
                    status: 'pending', // It's submitted to the mempool
                    message: 'On-chain attestation submitted successfully',
                };

                // Optional: Write Ethos review alongside attestation
                if (request.writeEthosReview && shouldPromptForReview(request.convictionMetrics.score)) {
                    try {
                        const ethosReview = prepareEthosReview(request.walletAddress, request.convictionMetrics);
                        const reviewResponse = await writeEthosReview(ethosReview);
                        
                        if (reviewResponse.success) {
                            response.reviewId = reviewResponse.reviewId;
                            response.reviewUrl = reviewResponse.reviewUrl;
                            console.log('Ethos review written successfully:', reviewResponse.reviewId);
                        } else {
                            // Review writing failed, but attestation succeeded
                            // Provide fallback URL for manual review
                            console.warn('Ethos review writing failed:', reviewResponse.error);
                            response.reviewUrl = getEthosReviewURL(request.walletAddress, request.convictionMetrics);
                        }
                    } catch (reviewError) {
                        console.error('Ethos review integration error:', reviewError);
                        // Don't fail the entire attestation if review fails
                        response.reviewUrl = getEthosReviewURL(request.walletAddress, request.convictionMetrics);
                    }
                }
                
                return response;
            }

            // FALLBACK / SOLANA SIMULATION
            // TODO: Implement real Solana attestations
            let signature = '0x';
            if (request.walletClient && request.chain === 'base') {
                // This path shouldn't be reached for Base anymore due to the block above,
                // but kept for safety or if we want just signature without on-chain write
                signature = await ethosClient.signAttestation(attestation, request.walletClient);
            }

            const response = await ethosClient.writeConvictionAttestation(
                attestation,
                signature
            );

            return response;
        } catch (error) {
            console.error('Attestation writing failed:', error);
            throw new Error(`Failed to write attestation: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get historical conviction attestations for a wallet
     */
    async getConvictionHistory(walletAddress: string): Promise<{
        attestations: ConvictionAttestation[];
        summary: {
            totalAttestations: number;
            latestScore?: number;
            scoreImprovement?: number;
            chains: string[];
        };
    }> {
        try {
            const attestations = await ethosClient.getConvictionAttestations(walletAddress);

            // Sort by date (newest first)
            attestations.sort((a, b) => new Date(b.analysisDate).getTime() - new Date(a.analysisDate).getTime());

            const summary = {
                totalAttestations: attestations.length,
                latestScore: attestations[0]?.convictionScore,
                scoreImprovement: attestations.length > 1
                    ? attestations[0].convictionScore - attestations[attestations.length - 1].convictionScore
                    : undefined,
                chains: [...new Set(attestations.map(a => a.chain))],
            };

            return { attestations, summary };
        } catch (error) {
            console.error('Failed to fetch conviction history:', error);
            return {
                attestations: [],
                summary: {
                    totalAttestations: 0,
                    chains: [],
                },
            };
        }
    }

    /**
     * Generate shareable conviction receipt
     */
    generateConvictionReceipt(
        walletAddress: string,
        convictionMetrics: ConvictionMetrics,
        attestationId?: string
    ): {
        title: string;
        description: string;
        shareText: string;
        shareUrl: string;
        imageUrl?: string;
    } {
        const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
        const archetype = convictionMetrics.archetype || 'Trader';

        const title = `${archetype} Conviction Receipt`;
        const description = `Wallet ${shortAddress} achieved ${convictionMetrics.score}/100 conviction score with ${convictionMetrics.upsideCapture}% upside capture`;

        const shareText = `🎯 My conviction analysis is in: ${convictionMetrics.score}/100 score as "${archetype}"
    
📊 ${convictionMetrics.upsideCapture}% upside capture
💎 ${convictionMetrics.convictionWins} conviction wins
⚡ ${convictionMetrics.totalPositions} positions analyzed

${attestationId ? '✅ Verified on @EthosNetwork' : '📋 Analyzed by @EarlyNotWrong'}

Being early feels like being wrong. Until it doesn't.`;

        const shareUrl = attestationId
            ? `https://ethos.network/attestation/${attestationId}`
            : `https://early-not-wrong.com/analysis/${walletAddress}`;

        return {
            title,
            description,
            shareText,
            shareUrl,
        };
    }

    /**
     * Check if attestation should be updated (significant score change)
     */
    async shouldUpdateAttestation(
        walletAddress: string,
        newMetrics: ConvictionMetrics
    ): Promise<{
        shouldUpdate: boolean;
        reason?: string;
        lastAttestation?: ConvictionAttestation;
    }> {
        try {
            const history = await this.getConvictionHistory(walletAddress);

            if (history.attestations.length === 0) {
                return {
                    shouldUpdate: true,
                    reason: 'No previous attestations found',
                };
            }

            const lastAttestation = history.attestations[0];
            const scoreDifference = Math.abs(newMetrics.score - lastAttestation.convictionScore);
            const daysSinceLastAttestation = (Date.now() - new Date(lastAttestation.analysisDate).getTime()) / (24 * 60 * 60 * 1000);

            // Update if score changed significantly (>5 points) or it's been >30 days
            if (scoreDifference >= 5) {
                return {
                    shouldUpdate: true,
                    reason: `Significant score change: ${lastAttestation.convictionScore} → ${newMetrics.score}`,
                    lastAttestation,
                };
            }

            if (daysSinceLastAttestation >= 30) {
                return {
                    shouldUpdate: true,
                    reason: 'Monthly update (30+ days since last attestation)',
                    lastAttestation,
                };
            }

            return {
                shouldUpdate: false,
                reason: `Recent attestation found (${Math.floor(daysSinceLastAttestation)} days ago, score change: ${scoreDifference.toFixed(1)})`,
                lastAttestation,
            };
        } catch (error) {
            console.error('Failed to check attestation update status:', error);
            return {
                shouldUpdate: true,
                reason: 'Unable to check previous attestations',
            };
        }
    }

    /**
     * Create a private attestation using Privacy Cash
     * The attestation is encrypted and can be selectively disclosed
     */
    async writePrivateAttestation(
        convictionMetrics: ConvictionMetrics
    ): Promise<PrivateAttestationResponse> {
        // Check if privacy session is active
        if (!privacyCashClient.isSessionValid()) {
            throw new Error('Privacy mode not enabled. Please enable privacy mode first.');
        }

        try {
            const archetype = convictionMetrics.archetype || 'Unknown';
            
            // Create private attestation via Privacy Cash
            const privateAttestation = await privacyCashClient.createPrivateAttestation(
                convictionMetrics.score,
                archetype
            );

            // Generate disclosure URL (can be shared to prove conviction without revealing wallet)
            const disclosureUrl = this.generateDisclosureUrl(privateAttestation.attestationHash);

            return {
                attestationHash: privateAttestation.attestationHash,
                proofData: privateAttestation.proofData,
                expiresAt: privateAttestation.expiresAt,
                isPrivate: true,
                disclosureUrl,
            };
        } catch (error) {
            console.error('Private attestation failed:', error);
            throw new Error(`Failed to create private attestation: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Verify a private attestation proof
     */
    async verifyPrivateAttestation(
        attestationHash: string,
        proofData: string
    ): Promise<{
        isValid: boolean;
        score?: number;
        archetype?: string;
        timestamp?: number;
    }> {
        try {
            // Verify the proof matches the hash
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(proofData);
            const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            if (computedHash !== attestationHash) {
                return { isValid: false };
            }

            // For full verification, we'd need to decrypt the proofData
            // This requires the encryption key which only the owner has
            // For public verification, we can only confirm the hash matches

            return {
                isValid: true,
                // Score and archetype would be revealed if the user provides their key
            };
        } catch (error) {
            console.error('Attestation verification failed:', error);
            return { isValid: false };
        }
    }

    /**
     * Generate a shareable disclosure URL for a private attestation
     */
    private generateDisclosureUrl(attestationHash: string): string {
        const baseUrl = typeof window !== 'undefined' 
            ? window.location.origin 
            : 'https://early-not-wrong.com';
        
        return `${baseUrl}/verify/${attestationHash}`;
    }

    /**
     * Check if private attestation is available
     */
    canCreatePrivateAttestation(): boolean {
        return privacyCashClient.isSessionValid();
    }
}

export const attestationService = new AttestationService();