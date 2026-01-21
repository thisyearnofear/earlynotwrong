const ETHOS_API_URL = "https://api.ethos.network/api/v2";
const ETHOS_CLIENT_ID = "early-not-wrong";

export interface EthosScore {
  score: number;
  percentile?: number;
  level?: string;
  updatedAt?: string;
}

export interface EthosProfile {
  id: string;
  bio?: string;
  name?: string;
  username?: string;
  profileImage?: string;
  credibilityScore?: number;
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
   * Get credibility score for an Ethereum address
   */
  async getScoreByAddress(address: string): Promise<EthosScore> {
    const searchParams = new URLSearchParams({ address });
    return this.fetch<EthosScore>(`/score/address?${searchParams.toString()}`);
  }

  /**
   * Get user profile by Ethereum address
   */
  async getProfileByAddress(address: string): Promise<EthosProfile> {
    return this.fetch<EthosProfile>(`/user/by/address/${address}`);
  }

  /**
   * Write conviction analysis as an attestation to Ethos Network
   */
  async writeConvictionAttestation(
    attestation: ConvictionAttestation,
    signerAddress: string
  ): Promise<AttestationResponse> {
    try {
      // Prepare attestation data according to Ethos schema
      const attestationData = {
        subject: attestation.subject,
        attester: signerAddress,
        schema: "conviction-analysis-v1",
        data: {
          convictionScore: attestation.convictionScore,
          patienceTax: attestation.patienceTax,
          upsideCapture: attestation.upsideCapture,
          archetype: attestation.archetype,
          totalPositions: attestation.totalPositions,
          winRate: attestation.winRate,
          analysisDate: attestation.analysisDate,
          timeHorizon: attestation.timeHorizon,
          chain: attestation.chain,
          source: "early-not-wrong-v1",
        },
        metadata: {
          title: `Conviction Analysis: ${attestation.archetype}`,
          description: `Behavioral analysis showing ${attestation.convictionScore}/100 conviction score with ${attestation.upsideCapture}% upside capture`,
          tags: ["conviction", "trading", "behavior", attestation.chain, attestation.archetype.toLowerCase().replace(" ", "-")],
        },
      };

      const response = await this.fetch<AttestationResponse>('/attestations', {
        method: 'POST',
        body: JSON.stringify(attestationData),
      });

      return response;
    } catch (error) {
      console.error('Conviction attestation failed:', error);
      throw new Error(`Failed to write conviction attestation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get existing conviction attestations for an address
   */
  async getConvictionAttestations(address: string): Promise<ConvictionAttestation[]> {
    try {
      const searchParams = new URLSearchParams({
        subject: address,
        schema: "conviction-analysis-v1",
      });

      const response = await this.fetch<{ attestations: any[] }>(`/attestations?${searchParams.toString()}`);

      return response.attestations.map(att => ({
        subject: att.subject,
        convictionScore: att.data.convictionScore,
        patienceTax: att.data.patienceTax,
        upsideCapture: att.data.upsideCapture,
        archetype: att.data.archetype,
        totalPositions: att.data.totalPositions,
        winRate: att.data.winRate,
        analysisDate: att.data.analysisDate,
        timeHorizon: att.data.timeHorizon,
        chain: att.data.chain,
      }));
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
      const profile = await this.getProfileByAddress(address);
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
    try {
      // This would be a real API call in production
      return {
        minCredibilityScore: 100,
        costInEth: 0, // Free for now
        requiresStaking: false,
      };
    } catch (error) {
      return {
        minCredibilityScore: 100,
        costInEth: 0,
        requiresStaking: false,
      };
    }
  }
}

export const ethosClient = new EthosClient();
