/**
 * onchain-portfolio.ts — Reliable on-chain BEP-20 balance + valuation.
 *
 * WHY THIS EXISTS
 * TWAK's `wallet portfolio` only surfaces native BNB + USDC. Every other
 * BEP-20 the agent buys (the hackathon tokens) shows as $0, which made the
 * agent (a) undercount its real portfolio value and (b) prune real positions
 * as "ghosts" during reconciliation. This module reads balances directly from
 * chain via balanceOf, so valuation and reconciliation no longer depend on
 * TWAK's incomplete view.
 *
 * Pricing is layered for dependability: CMC (already fetched each cycle) is
 * primary, CoinGecko (by contract) is the fallback, DexScreener (by contract)
 * is the last resort. A token that none of them can price contributes $0.
 */

import { createPublicClient, http, getAddress, type PublicClient } from "viem";
import { bsc } from "viem/chains";

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export interface OnchainHolding {
  symbol: string;
  contract: string;
  /** Human-readable token balance (already scaled by decimals). */
  balance: number;
}

/** Resolve the best BSC RPC URL we have. */
function resolveRpcUrl(): string {
  const key = process.env.NODEREAL_API_KEY;
  if (key) return `https://bsc-mainnet.nodereal.io/v1/${key}`;
  return "https://bsc-dataseed.binance.org";
}

export class OnchainPortfolio {
  private client: PublicClient;

  constructor(rpcUrl: string = resolveRpcUrl()) {
    this.client = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  }

  /** Live balanceOf for a single token (human-readable). 0 on any error. */
  async getBalance(contract: string, wallet: string): Promise<number> {
    try {
      const token = getAddress(contract);
      const owner = getAddress(wallet);
      const [raw, decimals] = await Promise.all([
        this.client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] }),
        this.client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
      ]);
      return Number(raw) / 10 ** Number(decimals);
    } catch {
      return 0;
    }
  }

  /**
   * Read balances for many tokens at once via multicall3 (single round-trip).
   * `addressMap` is SYMBOL → contract. Returns only positive balances.
   */
  async getHoldings(addressMap: Map<string, string>, wallet: string): Promise<OnchainHolding[]> {
    const entries = [...addressMap.entries()].filter(([, c]) => /^0x[a-fA-F0-9]{40}$/.test(c));
    if (entries.length === 0) return [];
    const owner = getAddress(wallet);

    const calls = entries.flatMap(([, contract]) => {
      const address = getAddress(contract);
      return [
        { address, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] } as const,
        { address, abi: ERC20_ABI, functionName: "decimals" } as const,
      ];
    });

    let results;
    try {
      results = await this.client.multicall({ contracts: calls, allowFailure: true });
    } catch {
      // Multicall unavailable — fall back to sequential reads.
      const out: OnchainHolding[] = [];
      for (const [symbol, contract] of entries) {
        const balance = await this.getBalance(contract, wallet);
        if (balance > 0) out.push({ symbol, contract: contract.toLowerCase(), balance });
      }
      return out;
    }

    const holdings: OnchainHolding[] = [];
    for (let i = 0; i < entries.length; i++) {
      const [symbol, contract] = entries[i];
      const balRes = results[i * 2];
      const decRes = results[i * 2 + 1];
      if (balRes.status !== "success" || decRes.status !== "success") continue;
      const balance = Number(balRes.result as bigint) / 10 ** Number(decRes.result as number);
      if (balance > 0) holdings.push({ symbol, contract: contract.toLowerCase(), balance });
    }
    return holdings;
  }
}

export interface ValuedPosition extends OnchainHolding {
  priceUsd: number;
  valueUsd: number;
  priceSource: "cmc" | "coingecko" | "dexscreener" | "none";
}

/**
 * Pure valuation: price each holding using the first source that has a price.
 * - cmcBySymbol:  SYMBOL (uppercase) → USD price  (already fetched each cycle)
 * - cgByContract: contract (lowercase) → USD price (CoinGecko fallback)
 * - dexByContract: contract (lowercase) → USD price (DexScreener last resort)
 */
export function valueHoldings(
  holdings: OnchainHolding[],
  cmcBySymbol: Map<string, number>,
  cgByContract: Map<string, number> = new Map(),
  dexByContract: Map<string, number> = new Map(),
): { positions: ValuedPosition[]; totalUsd: number } {
  const positions: ValuedPosition[] = holdings.map((h) => {
    const c = h.contract.toLowerCase();
    const cmc = cmcBySymbol.get(h.symbol.toUpperCase());
    const cg = cgByContract.get(c);
    const dex = dexByContract.get(c);
    let priceUsd = 0;
    let priceSource: ValuedPosition["priceSource"] = "none";
    if (cmc && cmc > 0) { priceUsd = cmc; priceSource = "cmc"; }
    else if (cg && cg > 0) { priceUsd = cg; priceSource = "coingecko"; }
    else if (dex && dex > 0) { priceUsd = dex; priceSource = "dexscreener"; }
    return { ...h, priceUsd, valueUsd: h.balance * priceUsd, priceSource };
  });
  const totalUsd = positions.reduce((sum, p) => sum + p.valueUsd, 0);
  return { positions, totalUsd };
}

/** CoinGecko BSC token prices by contract. Empty map on any failure. */
export async function fetchCoinGeckoPrices(contracts: string[]): Promise<Map<string, number>> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const out = new Map<string, number>();
  if (!apiKey || contracts.length === 0) return out;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/token_price/binance-smart-chain?contract_addresses=${contracts.join(",")}&vs_currencies=usd`;
    const res = await fetch(url, { headers: { "x-cg-demo-api-key": apiKey } });
    if (!res.ok) return out;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    for (const [contract, v] of Object.entries(data)) {
      if (v?.usd && v.usd > 0) out.set(contract.toLowerCase(), v.usd);
    }
  } catch {
    /* non-fatal */
  }
  return out;
}

/** DexScreener BSC token prices by contract. Empty map on any failure. */
export async function fetchDexScreenerPrices(contracts: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (contracts.length === 0) return out;
  try {
    // DexScreener allows up to 30 comma-separated addresses per call.
    const url = `https://api.dexscreener.com/latest/dex/tokens/${contracts.slice(0, 30).join(",")}`;
    const res = await fetch(url);
    if (!res.ok) return out;
    const data = (await res.json()) as { pairs?: Array<{ baseToken?: { address?: string }; priceUsd?: string }> };
    for (const pair of data.pairs ?? []) {
      const addr = pair.baseToken?.address?.toLowerCase();
      const price = pair.priceUsd ? parseFloat(pair.priceUsd) : 0;
      if (addr && price > 0 && !out.has(addr)) out.set(addr, price);
    }
  } catch {
    /* non-fatal */
  }
  return out;
}
