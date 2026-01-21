import { WalletClient, encodeAbiParameters, parseAbiParameters } from 'viem';
import { EAS_CONTRACT_ADDRESS, EAS_ABI, CONVICTION_SCHEMA_UID } from './eas-config';

const ETHOS_API_URL = "https://api.ethos.network/api/v2";
const ETHOS_CLIENT_ID = "early-not-wrong@1.0.0";

// EIP-712 Domain
const ETHOS_DOMAIN = {
  name: 'Ethos Conviction Attestation',
  version: '1',
  chainId: 8453, // Base
  verifyingContract: '0x0000000000000000000000000000000000000000' as const, // Placeholder
} as const;

// EIP-712 Types
const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'subject', type: 'address' },
    { name: 'convictionScore', type: 'uint256' },
    { name: 'patienceTax', type: 'uint256' },
    { name: 'upsideCapture', type: 'uint256' },
    { name: 'archetype', type: 'string' },
    { name: 'totalPositions', type: 'uint256' },
    { name: 'winRate', type: 'uint256' },
    { name: 'analysisDate', type: 'string' },
    { name: 'timeHorizon', type: 'uint256' },
  ],
} as const;

export interface EthosScore {
  score: number;
  percentile?: number;
  level?: string;
  updatedAt?: string;
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
  chain: 'solana' | 'base';
}

export interface AttestationResponse {
  id: string;
  hash?: string;
  status: 'pending' | 'confirmed' | 'failed';
  message?: string;
  signature?: string;
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
      throw new Error(`Ethos API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get credibility score for an address (Ethereum or Solana)
   */
  async getScoreByAddress(address: string): Promise<EthosScore | null> {
    try {
      const searchParams = new URLSearchParams({ address });
      const response = await this.fetch<{ score: number; percentile?: number }>(`/score/address?${searchParams.toString()}`);

      return {
        score: response.score,
        percentile: response.percentile,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.warn('Ethos score fetch failed:', error);
      return null;
    }
  }

  /**
   * Get credibility score by User Key (e.g., service:x.com:username:toly)
   */
  async getScoreByUserKey(userKey: string): Promise<EthosScore | null> {
    try {
      const searchParams = new URLSearchParams({ userkey: userKey });
      const response = await this.fetch<{ score: number; percentile?: number; level?: string }>(
        `/score/userkey?${searchParams.toString()}`
      );

      return {
        score: response.score,
        percentile: response.percentile,
        level: response.level,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.warn('Ethos score fetch by userkey failed:', error);
      return null;
    }
  }

  /**
   * Get user profile by address (Ethereum or Solana)
   */
  async getProfileByAddress(address: string): Promise<EthosProfile | null> {
    try {
      const response = await this.fetch<EthosProfile>(`/user/by/address/${address}`);
      return response;
    } catch (error) {
      console.warn('Ethos profile fetch failed:', error);
      return null;
    }
  }

  /**
   * Generate correct Ethos profile URL
   */
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
   * Sign attestation data (EIP-712)
   */
  async signAttestation(
    attestation: ConvictionAttestation,
    walletClient: WalletClient
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
      primaryType: 'Attestation',
      message,
    });
  }

  /**
   * Submit real attestation to EAS contract on Base
   */
  async submitOnChainAttestation(
    attestation: ConvictionAttestation,
    walletClient: WalletClient
  ): Promise<string> {
    if (!walletClient.account) {
      throw new Error("No account connected");
    }

    // Encode the data according to the schema: "uint256 score, uint256 patienceTax, string archetype"
    // Note: We are simplifying the on-chain data to the core metrics to save gas
    const encodedData = encodeAbiParameters(
      parseAbiParameters('uint256 score, uint256 patienceTax, string archetype'),
      [
        BigInt(Math.floor(attestation.convictionScore)),
        BigInt(Math.floor(attestation.patienceTax)),
        attestation.archetype
      ]
    );

    const hash = await walletClient.writeContract({
      address: EAS_CONTRACT_ADDRESS,
      abi: EAS_ABI,
      functionName: 'attest',
      args: [{
        schema: CONVICTION_SCHEMA_UID as `0x${string}`,
        data: {
          recipient: attestation.subject as `0x${string}`,
          expirationTime: BigInt(0), // No expiration
          revocable: true,
          refUID: '0x0000000000000000000000000000000000000000000000000000000000000000',
          data: encodedData,
          value: BigInt(0),
        }
      }],
      account: walletClient.account,
      chain: undefined, // Let wallet infer chain (Base)
    });

    return hash;
  }

  /**
   * Write conviction analysis as an attestation to Ethos Network
   */
  async writeConvictionAttestation(
    attestation: ConvictionAttestation,
    signature: string
  ): Promise<AttestationResponse> {
    try {
      // TODO: Replace with actual Ethos write endpoint or contract call
      // For now, we simulate a successful write with the real signature we just generated
      
      console.log('Submitting Attestation to Ethos:', {
        attestation,
        signature,
        domain: ETHOS_DOMAIN
      });

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      return {
        id: `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        hash: '0x' + Math.random().toString(36).substr(2, 64), // Simulated tx hash
        status: 'pending',
        message: 'Attestation submitted successfully (Simulated)',
        signature
      };
    } catch (error) {
      console.error('Conviction attestation failed:', error);
      throw new Error(`Failed to write conviction attestation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get existing conviction attestations for an address
   * Note: This is a placeholder - would need proper attestation schema
   */
  async getConvictionAttestations(address: string): Promise<ConvictionAttestation[]> {
    try {
      // Placeholder implementation
      console.warn('Attestation reading not yet implemented - returning empty array');
      return [];
    } catch (error) {
      console.warn('Failed to fetch conviction attestations:', error);
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
      console.warn('Permission check failed:', error);
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