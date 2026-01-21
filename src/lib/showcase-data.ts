import { EthosProfile, EthosScore } from "./ethos";

export interface ShowcaseWallet {
  id: string;
  name: string;
  chain: "base" | "solana";
  address: string;
  description: string;
  ethosScore: EthosScore;
  ethosProfile: EthosProfile;
  convictionMetrics: {
    score: number;
    patienceTax: number;
    upsideCapture: number;
    earlyExits: number;
    convictionWins: number;
    percentile: number;
  };
}

export const SHOWCASE_WALLETS: ShowcaseWallet[] = [
  {
    id: "base-whale",
    name: "Jesse (Base)",
    chain: "base",
    address: "0x8C4B...2A91",
    description: "The 'Ecosystem Aligner'. Held positions through 3 major drawdowns. Zero panic sells recorded in 2024.",
    ethosScore: {
      score: 1650,
      percentile: 98,
      level: "Guardian",
      updatedAt: new Date().toISOString(),
    },
    ethosProfile: {
      id: "profile_jesse",
      name: "jesse.base.eth",
      username: "jessepollak",
      credibilityScore: 1650,
    },
    convictionMetrics: {
      score: 94.2,
      patienceTax: 1250, // Minimal lost value
      upsideCapture: 91,
      earlyExits: 1,
      convictionWins: 12,
      percentile: 2,
    },
  },
  {
    id: "solana-diamond",
    name: "Solana Diamond",
    chain: "solana",
    address: "Toly...Sol",
    description:
      "The 'Volatility Surfer'. Weathered a -65% drawdown on core positions to eventually capture a 45x multiple.",
    ethosScore: {
      score: 1420,
      percentile: 92,
      level: "Sage",
      updatedAt: new Date().toISOString(),
    },
    ethosProfile: {
      id: "profile_toly",
      name: "toly.sol",
      username: "aeyakovenko",
      credibilityScore: 1420,
    },
    convictionMetrics: {
      score: 88.4,
      patienceTax: 8400,
      upsideCapture: 85,
      earlyExits: 3,
      convictionWins: 8,
      percentile: 8,
    },
  },
];
