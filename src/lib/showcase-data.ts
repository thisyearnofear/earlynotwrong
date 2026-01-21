export interface ShowcaseWallet {
  id: string;
  name: string;
  chain: "base" | "solana";
  address: string;
  description: string;
  ethosProfile?: {
    username?: string;
  };
  farcasterFid?: number; // Manual FID mapping when showcase wallet != verified wallet
}

export const SHOWCASE_WALLETS: ShowcaseWallet[] = [
  {
    id: "base-jesse",
    name: "Jesse (Base)",
    chain: "base",
    address: "0xFB70BDE99b4933A576Ea4e38645Ee1E88B1D6b19", // jesse.base.eth
    description:
      "The 'Ecosystem Aligner'. Jesse's primary Base address. Real-time audit of protocol alignment and holding behavior.",
    farcasterFid: 99, // Jesse Pollak's Farcaster profile
  },
  {
    id: "toly-solana",
    name: "Toly",
    chain: "solana",
    address: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
    description:
      "The 'Volatility Surfer'. Anatoly's public address. Analyzing the conviction of the Solana architect through market cycles.",
  },
  {
    id: "zinger-solana",
    name: "Zinger",
    chain: "solana",
    address: "6qemckK3fajDuKhVNyvRxNd9a3ubFXxMWkHSEgMVxxov",
    description:
      "The 'Alpha Hunter'. Public Solana address known for high-velocity breakout plays and tactical conviction.",
  },
  {
    id: "deployer-base",
    name: "Deployer",
    chain: "base",
    address: "0xc4Fdf12dC03424bEb5c117B4B19726401a9dD1AB",
    description:
      "The 'Infrastructure Builder'. Early Base deployer. Analyzing long-term conviction in ecosystem primitives.",
  },
];