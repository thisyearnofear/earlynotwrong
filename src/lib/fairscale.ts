/**
 * FairScale API Client
 * Solana-native wallet scoring and reputation system
 * 
 * Core Principles:
 * - CLEAN: Clear separation from Ethos, provider-agnostic design
 * - MODULAR: Independent, testable client
 * - PERFORMANT: Will be wrapped with caching layer
 */

const FAIRSCALE_API_URL = 'https://api.fairscale.xyz';
const FAIRSCALE_API_KEY = process.env.FAIRSCALE_API_KEY;

/**
 * FairScale Badge
 */
export interface FairScaleBadge {
  id: string;
  label: string;
  description: string;
  tier: string;
}

/**
 * FairScale Action - improvement suggestions
 */
export interface FairScaleAction {
  id: string;
  label: string;
  description: string;
  priority: string;
  cta: string;
}

/**
 * FairScale Features - detailed behavioral metrics
 */
export interface FairScaleFeatures {
  lst_percentile_score: number;
  major_percentile_score: number;
  native_sol_percentile: number;
  stable_percentile_score: number;
  tx_count: number;
  active_days: number;
  median_gap_hours: number;
  tempo_cv: number;
  burst_ratio: number;
  net_sol_flow_30d: number;
  median_hold_days: number;
  no_instant_dumps: number;
  conviction_ratio: number;
  platform_diversity: number;
  wallet_age_days: number;
}

/**
 * Complete FairScale Score Response
 */
export interface FairScaleScore {
  wallet: string;
  fairscore_base: number;      // Wallet-only score (0-100)
  social_score: number;         // Twitter/social score (0-100)
  fairscore: number;            // Combined score (0-100)
  tier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
  badges: FairScaleBadge[];
  actions?: FairScaleAction[];   // Improvement suggestions
  timestamp: string;
  features: FairScaleFeatures;
}

/**
 * FairScale API Client
 */
export class FairScaleClient {
  private baseUrl: string;
  private apiKey: string | undefined;

  constructor(baseUrl = FAIRSCALE_API_URL, apiKey = FAIRSCALE_API_KEY) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  /**
   * Make authenticated request to FairScale API
   */
  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error('FairScale API key not configured');
    }

    const url = `${this.baseUrl}${path}`;
    const headers = {
      'fairkey': this.apiKey,
      'Accept': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 429) {
      throw new Error('FairScale API rate limit exceeded');
    }

    if (response.status === 401) {
      throw new Error('FairScale API authentication failed');
    }

    if (!response.ok) {
      throw new Error(
        `FairScale API error: ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
  }

  /**
   * Get complete FairScore with full metadata
   */
  async getScore(
    wallet: string,
    twitter?: string,
  ): Promise<FairScaleScore | null> {
    try {
      const params = new URLSearchParams({ wallet });
      if (twitter) {
        params.append('twitter', twitter);
      }

      const score = await this.fetch<FairScaleScore>(
        `/score?${params.toString()}`,
      );

      // Validate and normalize actions field
      if (score.actions && !Array.isArray(score.actions)) {
        console.warn('FairScale actions field is not an array, normalizing');
        score.actions = undefined;
      }

      return score;
    } catch (error) {
      console.warn('FairScale score fetch failed:', error);
      return null;
    }
  }

  /**
   * Get wallet score only (excluding social factors)
   */
  async getWalletScore(
    wallet: string,
    twitter?: string,
  ): Promise<number | null> {
    try {
      const params = new URLSearchParams({ wallet });
      if (twitter) {
        params.append('twitter', twitter);
      }

      const response = await this.fetch<{ wallet_score: number }>(
        `/walletScore?${params.toString()}`,
      );

      return response.wallet_score;
    } catch (error) {
      console.warn('FairScale wallet score fetch failed:', error);
      return null;
    }
  }

  /**
   * Get social score only (Twitter/X based)
   */
  async getSocialScore(
    wallet: string,
    twitter: string,
  ): Promise<number | null> {
    try {
      const params = new URLSearchParams({ wallet, twitter });

      const response = await this.fetch<{ social_score: number }>(
        `/socialScore?${params.toString()}`,
      );

      return response.social_score;
    } catch (error) {
      console.warn('FairScale social score fetch failed:', error);
      return null;
    }
  }

  /**
   * Get just the FairScore value (lightweight)
   */
  async getFairScore(
    wallet: string,
    twitter?: string,
  ): Promise<number | null> {
    try {
      const params = new URLSearchParams({ wallet });
      if (twitter) {
        params.append('twitter', twitter);
      }

      const response = await this.fetch<{ fair_score: number }>(
        `/fairScore?${params.toString()}`,
      );

      return response.fair_score;
    } catch (error) {
      console.warn('FairScale fair score fetch failed:', error);
      return null;
    }
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

// Singleton instance
export const fairscaleClient = new FairScaleClient();
