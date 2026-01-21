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
}

export const ethosClient = new EthosClient();
