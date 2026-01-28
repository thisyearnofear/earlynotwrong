/**
 * Unified Trust Resolution Service
 * Provider-agnostic trust scoring across Ethos (Base/ETH) and FairScale (Solana)
 * 
 * Core Principles:
 * - DRY: Single source of truth for trust data
 * - CLEAN: Provider abstraction layer
 * - MODULAR: Independent trust providers
 * - PERFORMANT: Leverages existing cache layers
 */

import { cachedEthosService } from './ethos-cache';
import { cachedFairScaleService } from './fairscale-cache';
import type { EthosScore, EthosProfile } from '@/lib/ethos';
import type { FairScaleScore, FairScaleBadge } from '@/lib/fairscale';
import { APP_CONFIG } from '@/lib/config';
import { memoryClient } from '@/lib/memory-protocol';

/**
 * Unified trust score - normalized across providers
 */
export interface UnifiedTrustScore {
  // Primary normalized score (0-100)
  score: number;

  // Provider-specific data
  providers: {
    ethos?: {
      rawScore: number;              // Raw Ethos score (0-3000+)
      normalizedScore: number;       // Normalized to 0-100
      tier: string;
      profile?: EthosProfile;
    };
    fairscale?: {
      fairscore: number;             // FairScore (already 0-100)
      walletScore: number;           // Wallet-only score
      socialScore: number;           // Social score
      tier: string;
      badges: FairScaleBadge[];
      features?: any;                // Detailed feature breakdown
    };
  };

  // Unified metadata
  tier: 'unknown' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
  credibilityLevel: 'unknown' | 'low' | 'medium' | 'high' | 'elite';

  // Feature access (normalized across providers)
  features: {
    canAccessPremium: boolean;
    canAccessWhaleAnalysis: boolean;
    canAccessAlphaSignals: boolean;
    canAccessEliteInsights: boolean;
  };

  // Metadata
  primaryProvider: 'ethos' | 'fairscale' | 'none';
  resolvedAt: string;
  solanaAddress?: string; // Explicitly included for UI visibility
}

/**
 * Trust Resolver Service
 */
export class TrustResolverService {
  /**
   * Resolve trust score for any address
   */
  async resolve(address: string, twitter?: string, knownSolanaAddress?: string): Promise<UnifiedTrustScore> {
    const isSolana = this.isSolanaAddress(address);

    // Cross-chain identity bridging: Memory Protocol → Farcaster → fallback
    let linkedEthAddress: string | null = null;
    let linkedSolAddress: string | null = knownSolanaAddress || null;
    let resolvedTwitter: string | null = twitter || null;

    // Strategy 1: Memory Protocol (best cross-chain identity graph)
    if (memoryClient.isConfigured()) {
      try {
        const memoryIdentity = await memoryClient.resolveCrossChainIdentity(address);
        if (memoryIdentity) {
          if (!linkedEthAddress && memoryIdentity.ethereumAddresses.length > 0) {
            linkedEthAddress = memoryIdentity.ethereumAddresses[0];
            console.log(`[TrustResolver] Memory found EVM: ${linkedEthAddress}`);
          }
          if (!linkedSolAddress && memoryIdentity.solanaAddresses.length > 0) {
            linkedSolAddress = memoryIdentity.solanaAddresses[0];
            console.log(`[TrustResolver] Memory found Solana: ${linkedSolAddress}`);
          }
          if (!resolvedTwitter && memoryIdentity.twitter?.username) {
            resolvedTwitter = memoryIdentity.twitter.username;
            console.log(`[TrustResolver] Memory found Twitter: ${resolvedTwitter}`);
          }
        }
      } catch (e) {
        console.warn("[TrustResolver] Memory Protocol bridge failed:", e);
      }
    }

    // Strategy 2: Farcaster fallback for additional linked addresses
    if (!linkedEthAddress || !linkedSolAddress) {
      try {
        const { ethosClient } = await import('@/lib/ethos');
        const fcIdentity = await ethosClient.resolveFarcasterIdentity(address);
        if (fcIdentity) {
          if (!resolvedTwitter) {
            resolvedTwitter = fcIdentity.username;
          }
          if (!linkedEthAddress) {
            linkedEthAddress = fcIdentity.verifiedAddresses?.ethAddresses?.[0] || null;
          }
          if (!linkedSolAddress) {
            linkedSolAddress = fcIdentity.verifiedAddresses?.solAddresses?.[0] || null;
          }
        }
      } catch (e) {
        console.warn("[TrustResolver] Farcaster bridge resolution failed:", e);
      }
    }

    if (isSolana) {
      return this.resolveSolana(address, resolvedTwitter || undefined, linkedEthAddress);
    } else {
      return this.resolveEthereum(address, linkedSolAddress);
    }
  }

  /**
   * Resolve trust for Solana address
   */
  private async resolveSolana(
    address: string,
    twitter?: string,
    linkedEthAddress?: string | null
  ): Promise<UnifiedTrustScore> {
    // Try FairScale (native Solana)
    const fairscaleScore = cachedFairScaleService.isConfigured()
      ? await cachedFairScaleService.getScore(address, twitter)
      : null;

    // Try Ethos via linked EVM address OR Twitter UserKey
    let ethosScore = null;
    let ethosProfile = null;

    const ethAddressToQuery = linkedEthAddress || null;

    if (ethAddressToQuery) {
      [ethosScore, ethosProfile] = await Promise.all([
        cachedEthosService.getWalletEthosData(ethAddressToQuery).then(d => d.score),
        cachedEthosService.getWalletEthosData(ethAddressToQuery).then(d => d.profile),
      ]);
    } else if (twitter) {
      const userKey = `service:x.com:username:${twitter}`;
      [ethosScore, ethosProfile] = await Promise.all([
        cachedEthosService.getScoreByUserKey(userKey),
        cachedEthosService.getProfileByUserKey(userKey),
      ]);
    }

    return this.normalize({
      ethos: ethosScore ? { score: ethosScore, profile: ethosProfile } : undefined,
      fairscale: fairscaleScore || undefined,
      address,
      solanaAddress: address, // This IS the Solana address
    });
  }

  /**
   * Resolve trust for Ethereum address
   */
  private async resolveEthereum(address: string, linkedSolAddress?: string | null): Promise<UnifiedTrustScore> {
    console.log(`[TrustResolver] Resolving Ethereum trust for ${address} with linkedSolAddress: ${linkedSolAddress}`);

    // Ethos is primary for Ethereum
    const ethosData = await cachedEthosService.getWalletEthosData(address);

    // ENHANCEMENT: Also check FairScale if we have a linked Solana address
    let fairscaleScore = null;
    if (linkedSolAddress) {
      console.log(`[TrustResolver] Checking FairScale for linked address: ${linkedSolAddress}`);
      fairscaleScore = cachedFairScaleService.isConfigured()
        ? await cachedFairScaleService.getScore(linkedSolAddress)
        : null;
      console.log(`[TrustResolver] FairScale result:`, fairscaleScore ? 'Score Found' : (cachedFairScaleService.isConfigured() ? 'No Score' : 'Service Not Configured'));
    }

    return this.normalize({
      ethos: ethosData.score ? { score: ethosData.score, profile: ethosData.profile } : undefined,
      fairscale: fairscaleScore || undefined,
      address,
      solanaAddress: linkedSolAddress || undefined,
    });
  }

  /**
   * Normalize different trust providers to unified format
   */
  private normalize(data: {
    ethos?: { score: EthosScore; profile: EthosProfile | null };
    fairscale?: FairScaleScore;
    address: string;
    solanaAddress?: string;
  }): UnifiedTrustScore {
    const { ethos, fairscale, solanaAddress } = data;

    // Normalize scores to 0-100
    const ethosNormalized = ethos ? this.normalizeEthosScore(ethos.score.score) : 0;
    const fairscaleNormalized = fairscale ? fairscale.fairscore : 0;

    // Select primary score (prefer higher score)
    const primaryScore = Math.max(ethosNormalized, fairscaleNormalized);
    const primaryProvider =
      ethosNormalized > fairscaleNormalized ? 'ethos' :
        fairscaleNormalized > 0 ? 'fairscale' : 'none';

    // Determine unified tier and credibility
    const { tier, credibilityLevel } = this.determineTierAndCredibility(primaryScore);

    // Calculate feature access
    const features = this.calculateFeatureAccess(primaryScore);

    return {
      score: primaryScore,
      providers: {
        ethos: ethos ? {
          rawScore: ethos.score.score,
          normalizedScore: ethosNormalized,
          tier: this.getEthosTier(ethos.score.score),
          profile: ethos.profile || undefined,
        } : undefined,
        fairscale: fairscale ? {
          fairscore: fairscale.fairscore,
          walletScore: fairscale.fairscore_base,
          socialScore: fairscale.social_score,
          tier: fairscale.tier,
          badges: fairscale.badges,
          features: fairscale.features,
        } : undefined,
      },
      tier,
      credibilityLevel,
      features,
      primaryProvider,
      resolvedAt: new Date().toISOString(),
      solanaAddress,
    };
  }

  /**
   * Normalize Ethos score (0-3000) to 0-100 scale
   */
  private normalizeEthosScore(ethosScore: number): number {
    // Ethos scores typically range 0-3000, with 2000+ being elite
    // We'll use a logarithmic scale for better distribution
    const normalized = Math.min(100, (ethosScore / 30));
    return Math.round(normalized);
  }

  /**
   * Get Ethos tier based on raw score
   */
  private getEthosTier(score: number): string {
    const thresholds = APP_CONFIG.reputation.ethosScoreThresholds;

    if (score >= thresholds.elite) return 'elite';
    if (score >= thresholds.high) return 'high';
    if (score >= thresholds.medium) return 'medium';
    if (score >= thresholds.low) return 'low';
    return 'unknown';
  }

  /**
   * Determine unified tier and credibility level from normalized score
   */
  private determineTierAndCredibility(normalizedScore: number): {
    tier: 'unknown' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
    credibilityLevel: 'unknown' | 'low' | 'medium' | 'high' | 'elite';
  } {
    if (normalizedScore >= 90) {
      return { tier: 'diamond', credibilityLevel: 'elite' };
    } else if (normalizedScore >= 75) {
      return { tier: 'platinum', credibilityLevel: 'high' };
    } else if (normalizedScore >= 60) {
      return { tier: 'gold', credibilityLevel: 'high' };
    } else if (normalizedScore >= 40) {
      return { tier: 'silver', credibilityLevel: 'medium' };
    } else if (normalizedScore >= 20) {
      return { tier: 'bronze', credibilityLevel: 'low' };
    } else {
      return { tier: 'unknown', credibilityLevel: 'unknown' };
    }
  }

  /**
   * Calculate feature access based on normalized score
   */
  private calculateFeatureAccess(normalizedScore: number): {
    canAccessPremium: boolean;
    canAccessWhaleAnalysis: boolean;
    canAccessAlphaSignals: boolean;
    canAccessEliteInsights: boolean;
  } {
    // Unified thresholds (normalized 0-100 scale)
    return {
      canAccessPremium: normalizedScore >= 35,       // ~1000 Ethos or 40 FairScale
      canAccessWhaleAnalysis: normalizedScore >= 50, // ~1400 Ethos or 60 FairScale
      canAccessAlphaSignals: normalizedScore >= 65,  // ~1700 Ethos or 75 FairScale
      canAccessEliteInsights: normalizedScore >= 80, // ~2000 Ethos or 90 FairScale
    };
  }

  /**
   * Batch resolve trust scores
   */
  async resolveBatch(
    addresses: Array<{ address: string; twitter?: string }>,
  ): Promise<Map<string, UnifiedTrustScore>> {
    const results = await Promise.all(
      addresses.map(async ({ address, twitter }) => ({
        address,
        trust: await this.resolve(address, twitter),
      }))
    );

    return new Map(results.map(r => [r.address, r.trust]));
  }

  /**
   * Check if address is Solana
   */
  private isSolanaAddress(address: string): boolean {
    // Solana addresses are 32-44 base58 characters, no 0x prefix
    return !address.startsWith('0x') && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
}

// Singleton instance
export const trustResolver = new TrustResolverService();
