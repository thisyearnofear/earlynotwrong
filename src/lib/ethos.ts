import { APP_CONFIG } from "./config";

const ETHOS_API_URL = "https://api.ethos.network/api/v2";
const ETHOS_CLIENT_ID = "early-not-wrong@1.0.0";

export interface EthosScore {
  score: number;
  percentile?: number;
  level?: string;
  updatedAt?: string;
}

export interface EthosUserStats {
  review: {
    received: {
      negative: number;
      neutral: number;
      positive: number;
    };
  };
  vouch: {
    given: {
      amountWeiTotal: string;
      count: number;
    };
    received: {
      amountWeiTotal: string;
      count: number;
    };
  };
}

export interface EthosProfile {
  id: number;
  profileId: number;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  description?: string;
  score: number;
  status: string;
  userkeys: string[];
  links?: {
    profile?: string;
    scoreBreakdown?: string;
  };
  stats?: EthosUserStats;
}

export interface FarcasterIdentity {
  fid: number;
  username: string;
  displayName?: string;
  pfpUrl?: string;
  bio?: string;
  followerCount?: number;
  followingCount?: number;
  verifiedAddresses?: {
    ethAddresses: string[];
    solAddresses: string[];
  };
}

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
  tier: "unknown" | "bronze" | "silver" | "gold" | "platinum" | "diamond";
  credibilityLevel: "unknown" | "low" | "medium" | "high" | "elite";
  features: {
    canAccessPremium: boolean;
    canAccessWhaleAnalysis: boolean;
    canAccessAdvancedAnalytics: boolean;
  };
  primaryProvider: "ethos" | "none";
  resolvedAt: string;
  solanaAddress?: string;
}

export interface ConvictionAttestation {
  subject: string; // Wallet address
  convictionScore: number;
  patienceTax: number;
  upsideCapture: number;
  archetype: string;
  totalPositions: number;
  winRate: number;
  analysisDate: string;
  timeHorizon: number;
  chain: "solana" | "base";
}

export interface AttestationResponse {
  id: string; // EAS attestation UID or tx hash
  hash?: string; // Transaction hash
  status: "pending" | "confirmed" | "failed";
  message?: string;
  signature?: string;
  reviewId?: string; // Optional Ethos review ID
  reviewUrl?: string; // Optional Ethos review link
}

export class EthosClient {
  private baseUrl: string;
  private clientId: string;

  constructor(baseUrl = ETHOS_API_URL, clientId = ETHOS_CLIENT_ID) {
    this.baseUrl = baseUrl;
    this.clientId = clientId;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      "Content-Type": "application/json",
      "X-Ethos-Client": this.clientId,
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      throw new Error(
        `Ethos API error: ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
  }

  /**
   * Get credibility score for an address (Ethereum or Solana)
   */
  async getScoreByAddress(address: string): Promise<EthosScore | null> {
    try {
      const searchParams = new URLSearchParams({ address });
      const response = await this.fetch<{ score: number; percentile?: number }>(
        `/score/address?${searchParams.toString()}`,
      );

      return {
        score: response.score,
        percentile: response.percentile,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.warn("Ethos score fetch failed:", error);
      return null;
    }
  }

  /**
   * Get credibility score by User Key (e.g., service:x.com:username:toly)
   */
  async getScoreByUserKey(userKey: string): Promise<EthosScore | null> {
    try {
      const searchParams = new URLSearchParams({ userkey: userKey });
      const response = await this.fetch<{
        score: number;
        percentile?: number;
        level?: string;
      }>(`/score/userkey?${searchParams.toString()}`);

      return {
        score: response.score,
        percentile: response.percentile,
        level: response.level,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.warn("Ethos score fetch by userkey failed:", error);
      return null;
    }
  }

  /**
   * Get user statistics (vouches, reviews)
   */
  async getUserStats(userKey: string): Promise<EthosUserStats | null> {
    try {
      // In a real implementation, this would call /user/stats?userkey=...
      // For now, we'll try to get it from the profile if it's an address
      if (userKey.startsWith("address:")) {
        const address = userKey.replace("address:", "");
        const profile = await this.getProfileByAddress(address);
        return profile?.stats || null;
      }
      return null;
    } catch (error) {
      console.warn("Ethos stats fetch failed:", error);
      return null;
    }
  }

  /**
   * Get user profile by address (Ethereum or Solana)
   */
  async getProfileByAddress(address: string): Promise<EthosProfile | null> {
    try {
      const response = await this.fetch<EthosProfile>(
        `/user/by/address/${address}`,
      );
      return response;
    } catch (error) {
      console.warn("Ethos profile fetch failed:", error);
      return null;
    }
  }

  /**
   * Get user profile by UserKey (e.g., service:x.com:username:vitalik)
   * Enables social identity → Ethos profile resolution
   */
  async getProfileByUserKey(userKey: string): Promise<EthosProfile | null> {
    try {
      const response = await this.fetch<EthosProfile>(
        `/user/by/userkey/${encodeURIComponent(userKey)}`,
      );
      return response;
    } catch (error) {
      console.warn("Ethos profile fetch by userkey failed:", error);
      return null;
    }
  }

  /**
   * Resolve Farcaster identity for a wallet address or FID
   */
  async resolveFarcasterIdentity(
    address: string,
    fid?: number,
  ): Promise<FarcasterIdentity | null> {
    try {
      // Use Neynar API to resolve address/FID to Farcaster profile
      const response = await fetch("/api/farcaster/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, fid }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.identity || null;
    } catch (error) {
      console.warn("Farcaster identity resolution failed:", error);
      return null;
    }
  }

  /**
   * Find linked wallets via Farcaster verified addresses
   */
  async findLinkedWallets(primaryAddress: string): Promise<{
    ethereum: string[];
    solana: string[];
  } | null> {
    try {
      const identity = await this.resolveFarcasterIdentity(primaryAddress);

      if (identity?.verifiedAddresses) {
        return {
          ethereum: identity.verifiedAddresses.ethAddresses || [],
          solana: identity.verifiedAddresses.solAddresses || [],
        };
      }

      return null;
    } catch (error) {
      console.warn("Linked wallet discovery failed:", error);
      return null;
    }
  }

  /**
   * Resolve comprehensive trust score for an address
   */
  async resolveTrust(address: string): Promise<UnifiedTrustScore> {
    const isSolana =
      !address.startsWith("0x") &&
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);

    if (isSolana) {
      return {
        score: 0,
        providers: {},
        tier: "unknown",
        credibilityLevel: "unknown",
        features: {
          canAccessPremium: false,
          canAccessWhaleAnalysis: false,
          canAccessAdvancedAnalytics: false,
        },
        primaryProvider: "none",
        resolvedAt: new Date().toISOString(),
        solanaAddress: address,
      };
    }

    const ethosData = await this.getScoreByAddress(address);
    const profile = await this.getProfileByAddress(address);

    const rawScore = ethosData?.score || 0;
    const normalizedScore = Math.min(100, Math.round(rawScore / 30));

    let tier: UnifiedTrustScore["tier"] = "unknown";
    let credibilityLevel: UnifiedTrustScore["credibilityLevel"] = "unknown";

    if (normalizedScore >= 90) {
      tier = "diamond";
      credibilityLevel = "elite";
    } else if (normalizedScore >= 75) {
      tier = "platinum";
      credibilityLevel = "high";
    } else if (normalizedScore >= 60) {
      tier = "gold";
      credibilityLevel = "high";
    } else if (normalizedScore >= 40) {
      tier = "silver";
      credibilityLevel = "medium";
    } else if (normalizedScore >= 20) {
      tier = "bronze";
      credibilityLevel = "low";
    }

    const thresholds = APP_CONFIG.reputation.ethosScoreThresholds;
    let ethosTier = "unknown";
    if (rawScore >= thresholds.elite) ethosTier = "elite";
    else if (rawScore >= thresholds.high) ethosTier = "high";
    else if (rawScore >= thresholds.medium) ethosTier = "medium";
    else if (rawScore >= thresholds.low) ethosTier = "low";

    return {
      score: normalizedScore,
      providers: {
        ethos: {
          rawScore,
          normalizedScore,
          tier: ethosTier,
          profile: profile || undefined,
        },
      },
      tier,
      credibilityLevel,
      features: {
        canAccessPremium: normalizedScore >= 35,
        canAccessWhaleAnalysis: normalizedScore >= 50,
        canAccessAdvancedAnalytics: normalizedScore >= 80,
      },
      primaryProvider: normalizedScore > 0 ? "ethos" : "none",
      resolvedAt: new Date().toISOString(),
    };
  }

  getProfileUrl(profile: EthosProfile): string {
    // If the API provides a profile link, use it
    if (profile.links?.profile) {
      return profile.links.profile;
    }

    // Otherwise, construct the URL based on available data
    // The working example format is: https://app.ethos.network/profile/x/papajimjams/score
    // This suggests the format might be: /profile/{platform}/{username}/{section}

    if (profile.username) {
      return `https://app.ethos.network/profile/x/${profile.username}/score`;
    }

    // Fallback to profile ID if username not available
    return `https://app.ethos.network/profile/${profile.profileId}`;
  }

}

export const ethosClient = new EthosClient();
