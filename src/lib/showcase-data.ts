import { EthosProfile, EthosScore } from "./ethos";
import { ConvictionMetrics } from "./market";

export interface ShowcaseWallet {
  id: string;
  name: string;
  chain: "base" | "solana";
  address: string;
  description: string;
  ethosScore: EthosScore;
  ethosProfile: EthosProfile;
  convictionMetrics: ConvictionMetrics;
}

export const SHOWCASE_WALLETS: ShowcaseWallet[] = [
  {
    id: "base-whale",
    name: "Jesse (Base)",
    chain: "base",
    address: "0x8C4B...2A91",
    description:
      "The 'Ecosystem Aligner'. Held positions through 3 major drawdowns. Zero panic sells recorded in 2024.",
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
      archetype: "Iron Pillar",
      totalPositions: 15,
      avgHoldingPeriod: 45,
      winRate: 80,
    },
  },
  {
    id: "toly-solana",
    name: "Toly",
    chain: "solana",
    address: "Toly7QHnbmrXaUzFdtWxNWgzrub8VvkxtukiRrQiPbS",
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
      archetype: "Diamond Hand",
      totalPositions: 12,
      avgHoldingPeriod: 67,
      winRate: 67,
    },
  },
  {
    id: "zinger-solana",
    name: "Zinger",
    chain: "solana",
    address: "6qemckK3fajDuKhVNyvRxNd9a3ubFXxMWkHSEgMVxxov",
    description:
      "The 'Alpha Hunter'. Known for early entries into breakout tokens with exceptional timing and conviction.",
    ethosScore: {
      score: 1180,
      percentile: 88,
      level: "Veteran",
      updatedAt: new Date().toISOString(),
    },
    ethosProfile: {
      id: "profile_zinger",
      name: "zinger.sol",
      username: "zingertrader",
      credibilityScore: 1180,
    },
    convictionMetrics: {
      score: 91.7,
      patienceTax: 2100,
      upsideCapture: 93,
      earlyExits: 2,
      convictionWins: 18,
      percentile: 4,
      archetype: "Iron Pillar",
      totalPositions: 22,
      avgHoldingPeriod: 38,
      winRate: 82,
    },
  },
  {
    id: "deployer-base",
    name: "Deployer",
    chain: "base",
    address: "0xc4Fdf12dC03424bEb5c117B4B19726401a9dD1AB",
    description:
      "The 'Infrastructure Builder'. Focuses on protocol tokens and infrastructure plays with long-term conviction.",
    ethosScore: {
      score: 1350,
      percentile: 90,
      level: "Guardian",
      updatedAt: new Date().toISOString(),
    },
    ethosProfile: {
      id: "profile_deployer",
      name: "deployer.base.eth",
      username: "basedeployer",
      credibilityScore: 1350,
    },
    convictionMetrics: {
      score: 86.2,
      patienceTax: 5200,
      upsideCapture: 78,
      earlyExits: 4,
      convictionWins: 9,
      percentile: 12,
      archetype: "Diamond Hand",
      totalPositions: 16,
      avgHoldingPeriod: 89,
      winRate: 69,
    },
  },
];
