/**
 * Unified Trust Resolution Service
 * Provider-agnostic trust scoring - currently Ethos-only
 */

import { cachedEthosService } from './ethos-cache';
import type { EthosScore, EthosProfile } from '@/lib/ethos';
import { APP_CONFIG } from '@/lib/config';

/**
 * Unified trust score - normalized across providers
 */
export interface UnifiedTrustScore {
  score: number;
  providers: {
    ethos?: {
      rawScore: number;
      normalizedScore: number;
      tier: string;
      profile?: EthosProfile;
    };
  };
  tier: 'unknown' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
  credibilityLevel: 'unknown' | 'low' | 'medium' | 'high' | 'elite';
  features: {
    canAccessPremium: boolean;
    canAccessWhaleAnalysis: boolean;
    canAccessAlphaSignals: boolean;
    canAccessEliteInsights: boolean;
  };
  primaryProvider: 'ethos' | 'none';
  resolvedAt: string;
  solanaAddress?: string;
}

/**
 * Trust Resolver Service
 */
export class TrustResolverService {
  async resolve(address: string): Promise<UnifiedTrustScore> {
    const isSolana = this.isSolanaAddress(address);

    if (isSolana) {
      return this.resolveSolana(address);
    } else {
      return this.resolveEthereum(address);
    }
  }

  private async resolveSolana(address: string): Promise<UnifiedTrustScore> {
    return this.normalize({
      address,
      solanaAddress: address,
    });
  }

  private async resolveEthereum(address: string): Promise<UnifiedTrustScore> {
    const ethosData = await cachedEthosService.getWalletEthosData(address);

    return this.normalize({
      ethos: ethosData.score ? { score: ethosData.score, profile: ethosData.profile } : undefined,
      address,
    });
  }

  private normalize(data: {
    ethos?: { score: EthosScore; profile: EthosProfile | null };
    address: string;
    solanaAddress?: string;
  }): UnifiedTrustScore {
    const { ethos, solanaAddress } = data;

    const ethosNormalized = ethos ? this.normalizeEthosScore(ethos.score.score) : 0;
    const primaryScore = ethosNormalized;
    const primaryProvider = ethosNormalized > 0 ? 'ethos' : 'none';
    const { tier, credibilityLevel } = this.determineTierAndCredibility(primaryScore);
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
      },
      tier,
      credibilityLevel,
      features,
      primaryProvider,
      resolvedAt: new Date().toISOString(),
      solanaAddress,
    };
  }

  private normalizeEthosScore(ethosScore: number): number {
    return Math.min(100, Math.round(ethosScore / 30));
  }

  private getEthosTier(score: number): string {
    const thresholds = APP_CONFIG.reputation.ethosScoreThresholds;
    if (score >= thresholds.elite) return 'elite';
    if (score >= thresholds.high) return 'high';
    if (score >= thresholds.medium) return 'medium';
    if (score >= thresholds.low) return 'low';
    return 'unknown';
  }

  private determineTierAndCredibility(normalizedScore: number): {
    tier: 'unknown' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
    credibilityLevel: 'unknown' | 'low' | 'medium' | 'high' | 'elite';
  } {
    if (normalizedScore >= 90) return { tier: 'diamond', credibilityLevel: 'elite' };
    if (normalizedScore >= 75) return { tier: 'platinum', credibilityLevel: 'high' };
    if (normalizedScore >= 60) return { tier: 'gold', credibilityLevel: 'high' };
    if (normalizedScore >= 40) return { tier: 'silver', credibilityLevel: 'medium' };
    if (normalizedScore >= 20) return { tier: 'bronze', credibilityLevel: 'low' };
    return { tier: 'unknown', credibilityLevel: 'unknown' };
  }

  private calculateFeatureAccess(normalizedScore: number) {
    return {
      canAccessPremium: normalizedScore >= 35,
      canAccessWhaleAnalysis: normalizedScore >= 50,
      canAccessAlphaSignals: normalizedScore >= 65,
      canAccessEliteInsights: normalizedScore >= 80,
    };
  }

  private isSolanaAddress(address: string): boolean {
    return !address.startsWith('0x') && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
}

export const trustResolver = new TrustResolverService();
