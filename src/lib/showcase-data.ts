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
    name: "Jesse Dixon",
    chain: "base",
    address: "0x32DA784C5A5813bAB4D52e84840869c273E15E28",
    description:
      "The 'On-Chain Researcher'. Blockchain researcher & streamer with 131+ analyzed positions. Active Base trader with consistent conviction patterns.",
    // No farcasterFid needed - address is verified on Farcaster (FID 1363917, 3.4K followers)
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