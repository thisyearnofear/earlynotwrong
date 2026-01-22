import { WalletClient, encodeAbiParameters, parseAbiParameters } from "viem";
import {
  EAS_CONTRACT_ADDRESS,
  EAS_ABI,
  CONVICTION_SCHEMA_UID,
} from "./eas-config";
import { APP_CONFIG } from "./config";

const ETHOS_API_URL = "https://api.ethos.network/api/v2";
const ETHOS_CLIENT_ID = "early-not-wrong@1.0.0";

// EIP-712 Domain
const ETHOS_DOMAIN = {
  name: "Ethos Conviction Attestation",
  version: "1",
  chainId: 8453, // Base
  verifyingContract: "0x0000000000000000000000000000000000000000" as const, // Placeholder
} as const;

// EIP-712 Types
const ATTESTATION_TYPES = {
  Attestation: [
    { name: "subject", type: "address" },
    { name: "convictionScore", type: "uint256" },
    { name: "patienceTax", type: "uint256" },
    { name: "upsideCapture", type: "uint256" },
    { name: "archetype", type: "string" },
    { name: "totalPositions", type: "uint256" },
    { name: "winRate", type: "uint256" },
    { name: "analysisDate", type: "string" },
    { name: "timeHorizon", type: "uint256" },
  ],
} as const;

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

export interface ReputationWeightedMetrics {
  baseScore: number;
  ethosScore: number;
  reputationMultiplier: number;
  weightedScore: number;
  credibilityTier: "Unknown" | "Low" | "Medium" | "High" | "Elite";
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
   * Calculate reputation-weighted conviction metrics
   */
  calculateReputationWeighting(
    baseConvictionScore: number,
    ethosScore: number | null,
  ): ReputationWeightedMetrics {
    const score = ethosScore || 0;

    // Reputation multiplier based on Ethos score tiers
    let reputationMultiplier = 1.0;
    let credibilityTier: ReputationWeightedMetrics["credibilityTier"] =
      "Unknown";

    if (score >= 2000) {
      reputationMultiplier = 1.5;
      credibilityTier = "Elite";
    } else if (score >= 1000) {
      reputationMultiplier = 1.3;
      credibilityTier = "High";
    } else if (score >= 500) {
      reputationMultiplier = 1.15;
      credibilityTier = "Medium";
    } else if (score >= 100) {
      reputationMultiplier = 1.05;
      credibilityTier = "Low";
    }

    const weightedScore = Math.min(
      100,
      baseConvictionScore * reputationMultiplier,
    );

    return {
      baseScore: baseConvictionScore,
      ethosScore: score,
      reputationMultiplier,
      weightedScore,
      credibilityTier,
    };
  }

  /**
   * Get comprehensive feature access and perks based on Ethos score
   */
  getReputationPerks(ethosScore: number | null): {
    tier: "unknown" | "premium" | "whale" | "alpha" | "elite";
    features: {
      canAccessPremium: boolean;
      canAccessWhaleAnalysis: boolean;
      canAccessAlphaSignals: boolean;
      canAccessEliteInsights: boolean;
    };
    perks: {
      refreshRate: number;
      historyDepth: number;
      exportData: boolean;
      prioritySupport: boolean;
      cohortComparison?: boolean;
      advancedFilters?: boolean;
      realTimeAlerts?: boolean;
      whaleTracking?: boolean;
      earlyAccess?: boolean;
      customDashboard?: boolean;
      apiAccess?: boolean;
    };
    nextTier?: {
      name: string;
      requiredScore: number;
      newPerks: string[];
    };
  } {
    const score = ethosScore || 0;
    const { reputation } = APP_CONFIG;

    let tier: "unknown" | "premium" | "whale" | "alpha" | "elite" = "unknown";
    let perks = reputation.perks.premium;
    let nextTier = undefined;

    if (score >= reputation.featureGating.eliteInsights) {
      tier = "elite";
      perks = reputation.perks.elite;
    } else if (score >= reputation.featureGating.alphaSignals) {
      tier = "alpha";
      perks = reputation.perks.alpha;
      nextTier = {
        name: "Elite Insights",
        requiredScore: reputation.featureGating.eliteInsights,
        newPerks: ["Early Access Features", "Custom Dashboard"],
      };
    } else if (score >= reputation.featureGating.whaleAnalysis) {
      tier = "whale";
      perks = reputation.perks.whale;
      nextTier = {
        name: "Alpha Signals",
        requiredScore: reputation.featureGating.alphaSignals,
        newPerks: ["Real-Time Alerts", "Whale Tracking", "Priority Support"],
      };
    } else if (score >= reputation.featureGating.premiumAccess) {
      tier = "premium";
      perks = reputation.perks.premium;
      nextTier = {
        name: "Whale Analysis",
        requiredScore: reputation.featureGating.whaleAnalysis,
        newPerks: ["Cohort Comparison", "Advanced Filters", "Data Export"],
      };
    } else {
      nextTier = {
        name: "Premium Access",
        requiredScore: reputation.featureGating.premiumAccess,
        newPerks: ["Extended History", "Faster Refresh", "Basic Analytics"],
      };
    }

    return {
      tier,
      features: {
        canAccessPremium: score >= reputation.featureGating.premiumAccess,
        canAccessWhaleAnalysis: score >= reputation.featureGating.whaleAnalysis,
        canAccessAlphaSignals: score >= reputation.featureGating.alphaSignals,
        canAccessEliteInsights: score >= reputation.featureGating.eliteInsights,
      },
      perks,
      nextTier,
    };
  }

  /**
   * Check if wallet qualifies for premium features based on Ethos score
   */
  getFeatureAccess(ethosScore: number | null): {
    canAccessPremium: boolean;
    canAccessWhaleAnalysis: boolean;
    canAccessAlphaSignals: boolean;
    requiredScoreForNext: number | null;
  } {
    const reputationPerks = this.getReputationPerks(ethosScore);

    return {
      canAccessPremium: reputationPerks.features.canAccessPremium,
      canAccessWhaleAnalysis: reputationPerks.features.canAccessWhaleAnalysis,
      canAccessAlphaSignals: reputationPerks.features.canAccessAlphaSignals,
      requiredScoreForNext: reputationPerks.nextTier?.requiredScore || null,
    };
  }

  /**
   * Classify wallet for alpha discovery purposes
   */
  classifyWalletForAlpha(
    convictionScore: number,
    ethosScore: number | null,
    totalPositions: number,
  ): {
    isHighConviction: boolean;
    isIronPillar: boolean;
    isCredible: boolean;
    alphaRating: "Unknown" | "Low" | "Medium" | "High" | "Elite";
  } {
    const score = ethosScore || 0;
    const { alphaDiscovery, reputation } = APP_CONFIG;

    const isHighConviction =
      convictionScore >= alphaDiscovery.highConvictionThreshold;
    const isIronPillar = convictionScore >= alphaDiscovery.ironPillarThreshold;
    const isCredible = score >= reputation.featureGating.premiumAccess;
    const hasMinPositions =
      totalPositions >= alphaDiscovery.minPositionsForRanking;

    let alphaRating: "Unknown" | "Low" | "Medium" | "High" | "Elite" =
      "Unknown";

    if (isCredible && hasMinPositions) {
      if (isIronPillar && score >= reputation.ethosScoreThresholds.elite) {
        alphaRating = "Elite";
      } else if (
        isHighConviction &&
        score >= reputation.ethosScoreThresholds.high
      ) {
        alphaRating = "High";
      } else if (
        isHighConviction &&
        score >= reputation.ethosScoreThresholds.medium
      ) {
        alphaRating = "Medium";
      } else if (score >= reputation.ethosScoreThresholds.low) {
        alphaRating = "Low";
      }
    }

    return {
      isHighConviction,
      isIronPillar,
      isCredible,
      alphaRating,
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

  /**
   * Generate correct Ethos profile URL
   */
  async signAttestation(
    attestation: ConvictionAttestation,
    walletClient: WalletClient,
  ): Promise<string> {
    if (!walletClient.account) {
      throw new Error("No account connected");
    }

    // Prepare message for signing
    // Note: We multiply decimals by 100 or 10000 where needed for integer representation
    const message = {
      subject: attestation.subject as `0x${string}`,
      convictionScore: BigInt(Math.floor(attestation.convictionScore)),
      patienceTax: BigInt(Math.floor(attestation.patienceTax * 100)),
      upsideCapture: BigInt(Math.floor(attestation.upsideCapture * 100)),
      archetype: attestation.archetype,
      totalPositions: BigInt(attestation.totalPositions),
      winRate: BigInt(Math.floor(attestation.winRate * 100)),
      analysisDate: attestation.analysisDate,
      timeHorizon: BigInt(attestation.timeHorizon),
    };

    return await walletClient.signTypedData({
      account: walletClient.account,
      domain: ETHOS_DOMAIN,
      types: ATTESTATION_TYPES,
      primaryType: "Attestation",
      message,
    });
  }

  /**
   * Submit real attestation to EAS contract on Base
   */
  async submitOnChainAttestation(
    attestation: ConvictionAttestation,
    walletClient: WalletClient,
  ): Promise<string> {
    if (!walletClient.account) {
      throw new Error("No account connected");
    }

    // Encode the data according to the schema: "uint256 score, uint256 patienceTax, string archetype"
    // Note: We are simplifying the on-chain data to the core metrics to save gas
    const encodedData = encodeAbiParameters(
      parseAbiParameters(
        "uint256 score, uint256 patienceTax, string archetype",
      ),
      [
        BigInt(Math.floor(attestation.convictionScore)),
        BigInt(Math.floor(attestation.patienceTax)),
        attestation.archetype,
      ],
    );

    const hash = await walletClient.writeContract({
      address: EAS_CONTRACT_ADDRESS,
      abi: EAS_ABI,
      functionName: "attest",
      args: [
        {
          schema: CONVICTION_SCHEMA_UID as `0x${string}`,
          data: {
            recipient: attestation.subject as `0x${string}`,
            expirationTime: BigInt(0), // No expiration
            revocable: true,
            refUID:
              "0x0000000000000000000000000000000000000000000000000000000000000000",
            data: encodedData,
            value: BigInt(0),
          },
        },
      ],
      account: walletClient.account,
      chain: undefined, // Let wallet infer chain (Base)
    });

    return hash;
  }

  /**
   * Write conviction analysis as an attestation
   * Note: This method is called after on-chain attestation via submitOnChainAttestation
   * It serves as a bridge for any additional off-chain metadata storage if needed
   */
  async writeConvictionAttestation(
    attestation: ConvictionAttestation,
    signature: string,
  ): Promise<AttestationResponse> {
    try {
      console.log("Processing conviction attestation:", {
        attestation,
        signature: signature.substring(0, 20) + "...",
        chain: attestation.chain,
      });

      // The actual on-chain write happens via submitOnChainAttestation
      // This method can be used for additional processing or metadata storage
      // For now, we return a success response that will be populated with
      // the actual transaction data by the attestation-service

      return {
        id: signature, // Will be replaced with actual attestation UID
        status: "pending",
        message: "Conviction attestation data prepared",
        signature,
      };
    } catch (error) {
      console.error("Conviction attestation processing failed:", error);
      throw new Error(
        `Failed to process conviction attestation: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get existing conviction attestations for an address from EAS
   */
  async getConvictionAttestations(
    address: string,
  ): Promise<ConvictionAttestation[]> {
    try {
      // Import dynamically to avoid circular dependencies
      const { getConvictionAttestationsByRecipient, decodeConvictionData } =
        await import("./eas-graphql");

      // Fetch attestations from EAS GraphQL
      const easAttestations =
        await getConvictionAttestationsByRecipient(address);

      if (easAttestations.length === 0) {
        return [];
      }

      // Decode and map to ConvictionAttestation format
      const convictionAttestations: ConvictionAttestation[] = [];

      for (const easAtt of easAttestations) {
        const decodedData = decodeConvictionData(easAtt.data);

        if (decodedData) {
          convictionAttestations.push({
            subject: easAtt.recipient,
            convictionScore: Number(decodedData.score),
            patienceTax: Number(decodedData.patienceTax) / 100, // Convert back from integer representation
            upsideCapture: 0, // Not stored in simplified on-chain schema
            archetype: decodedData.archetype,
            totalPositions: 0, // Not stored in simplified on-chain schema
            winRate: 0, // Not stored in simplified on-chain schema
            analysisDate: new Date(easAtt.time * 1000).toISOString(),
            timeHorizon: 365, // Default assumption
            chain: "base",
          });
        }
      }

      return convictionAttestations;
    } catch (error) {
      console.warn("Failed to fetch conviction attestations:", error);
      return [];
    }
  }

  /**
   * Check if user has permission to write attestations
   */
  async canWriteAttestations(address: string): Promise<boolean> {
    try {
      const score = await this.getScoreByAddress(address);
      // Require minimum credibility score to prevent spam
      return (score?.score || 0) >= 100;
    } catch (error) {
      console.warn("Permission check failed:", error);
      return false;
    }
  }

  /**
   * Get attestation writing cost/requirements
   */
  async getAttestationRequirements(): Promise<{
    minCredibilityScore: number;
    costInEth?: number;
    requiresStaking?: boolean;
  }> {
    return {
      minCredibilityScore: 100,
      costInEth: 0, // Free for now
      requiresStaking: false,
    };
  }
}

export const ethosClient = new EthosClient();
