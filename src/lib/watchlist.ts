/**
 * Watchlist Configuration
 * High-conviction traders to monitor for alerts
 */

export interface WatchlistTrader {
  id: string;
  name: string;
  wallets: string[];
  chain: "solana" | "base";
  socials?: {
    farcaster?: string;
    twitter?: string;
    ens?: string;
  };
}

export const WATCHLIST: WatchlistTrader[] = [
  // === SOLANA TRADERS ===
  {
    id: "vickybro",
    name: "Vickybro",
    chain: "solana",
    wallets: ["HAmd4Fbyk9mkx2LpJuAnswvch2U4bS1kMUPHsphawLUc"],
    socials: {
      farcaster: "vickybro",
      twitter: "cryptohood55",
    },
  },
  {
    id: "sol-anon-1",
    name: "7aMgK...A46D",
    chain: "solana",
    wallets: ["7aMgK5L4qEQ8Nyv6ZzhZi2B82NSSRnwb2NGJnNagA46D"],
  },
  {
    id: "sol-anon-2",
    name: "suqh5...HQfK",
    chain: "solana",
    wallets: ["suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK"],
  },
  {
    id: "sol-anon-3",
    name: "Szrt7...SwTP",
    chain: "solana",
    wallets: ["Szrt7xTyU4XXQB3YUYawUHDoeBsmNzeqGtEzUT3SwTP"],
  },
  {
    id: "sol-anon-4",
    name: "CyaE1...a54o",
    chain: "solana",
    wallets: ["CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o"],
  },
  // === BASE TRADERS ===
  {
    id: "cryptogirls",
    name: "cryptogirls",
    chain: "base",
    wallets: [
      "0x952580d41f10db41d97fcd6b1984bc2538eefc2c",
      "0x52793d3b013e826235655c59a69175fceb20c654",
      "0xc13073802e74ef8f278b57f84861707336b6f306",
      "0x57b59faded980bcc693c767a43134fb5043ef6fe", // senpi
    ],
    socials: {
      farcaster: "cryptogirls",
      twitter: "cryptogirls_eth",
      ens: "cryptogirls.eth",
    },
  },
  {
    id: "edit",
    name: "edit",
    chain: "base",
    wallets: [
      "0x8ab28f456253ab9ea3cb592e846109c7c7a5db83",
      "0x7c312eae0f98fa419038babb0f55e1b7a87804cf",
      "0xb70399fc376c1b3cf3493556d2f14942323ef44f",
      "0x98c93030acdb2cb8f1180d3e067603a3ff1c7e7e",
      "0x2b035903cdccf380fd50ea27ba72196b493c1f9f", // senpi
    ],
    socials: {
      farcaster: "edit",
      twitter: "edit_pasha",
      ens: "editpasha.eth",
    },
  },
  {
    id: "wijuwiju",
    name: "wijuwiju.eth",
    chain: "base",
    wallets: [
      "0xf4844a06d4f995c4c03195afcb5aa59dcbb5b4fc",
      "0xd49b237ca29fe04d0d238084d37f63f8bd2ab8c2",
      "0xf28bdb49925e12b28f118b484667a9816a7e0fa3",
    ],
    socials: {
      farcaster: "wijuwiju.eth",
      ens: "wijuwiju.eth",
    },
  },
  {
    id: "0xany",
    name: "0xany.eth",
    chain: "base",
    wallets: [
      "0xeb89055e16ae1c1e42ad6770a7344ff5c7b4f31d",
      "0xa40e9b84b018932c75bc0bc07b2f816afbca4214",
    ],
    socials: {
      ens: "0xany.eth",
    },
  },
  {
    id: "quillingqualia",
    name: "quillingqualia.eth",
    chain: "base",
    wallets: [
      "0x6f25a0dd4c3bd4ef1a89916b3e0162061249885a",
      "0x6ca9725fc7bf4739464fbdfe704599fc6f6ec2e4",
      "0xc0b1ec4a23496cfdb7545cc7f10cdb041e9552d0",
      "0x726fd01c984c3d9a04c4ce162d2c162a2de6d8a4", // senpi
      "0x6a44fb87142a9f6e74a719584eeb8b49bd9da81a",
    ],
    socials: {
      farcaster: "quillingqualia.eth",
      twitter: "quillingqualia",
      ens: "quillingqualia.eth",
    },
  },
  {
    id: "0xluo",
    name: "0xluo.eth",
    chain: "base",
    wallets: [
      "0xec8b6b6ee8dc5c6631747bdc6b1400aff08829fd",
      "0x97e302e2638eb8ac6572598c559e56c7a9b39cdf",
      "0x0534d4994f055df59315b0172aeeb40c8060874c",
      "0x1a1a3f0d1ce2b1228e3d656dd107a05c7736db46", // senpi
      "0x012f7a603370bc608365b64f541caaa5d2ba60c1",
    ],
    socials: {
      farcaster: "0xluo.eth",
      twitter: "0xluo",
      ens: "0xluo.eth",
    },
  },
];

// Get all wallet addresses for a specific chain
export function getWatchlistAddresses(chain?: "solana" | "base"): string[] {
  const traders = chain
    ? WATCHLIST.filter((t) => t.chain === chain)
    : WATCHLIST;
  return traders.flatMap((t) => t.wallets);
}

// Find trader by wallet address
export function findTraderByWallet(
  walletAddress: string
): WatchlistTrader | undefined {
  const normalized = walletAddress.toLowerCase();
  return WATCHLIST.find((t) =>
    t.wallets.some((w) => w.toLowerCase() === normalized)
  );
}

// Get trader by ID
export function getTraderById(id: string): WatchlistTrader | undefined {
  return WATCHLIST.find((t) => t.id === id);
}
