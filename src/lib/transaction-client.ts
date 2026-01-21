/**
 * Transaction Client
 * Fetches and processes on-chain transaction data for Solana and Base networks.
 */

import { TokenTransaction, TokenPosition } from './market';

export interface TransactionClientConfig {
    heliusApiKey?: string;
    alchemyApiKey?: string;
    quicknodeEndpoint?: string;
}

export class TransactionClient {
    private config: TransactionClientConfig;
    private cache = new Map<string, any>();
    private cacheExpiry = 10 * 60 * 1000; // 10 minutes

    constructor(config: TransactionClientConfig = {}) {
        this.config = config;
    }

    private getCacheKey(method: string, params: any[]): string {
        return `${method}_${JSON.stringify(params)}`;
    }

    private async cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }

        const data = await fetcher();
        this.cache.set(key, { data, timestamp: Date.now() });
        return data;
    }

    /**
     * Fetch Solana transactions using Helius API
     */
    async fetchSolanaTransactions(
        address: string,
        timeHorizonDays: number,
        minTradeValue: number
    ): Promise<TokenTransaction[]> {
        const cacheKey = this.getCacheKey('solana', [address, timeHorizonDays, minTradeValue]);

        return this.cachedFetch(cacheKey, async () => {
            try {
                const heliusUrl = this.config.heliusApiKey
                    ? `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.config.heliusApiKey}`
                    : `https://api.helius.xyz/v0/addresses/${address}/transactions`;

                const cutoffTime = Date.now() - (timeHorizonDays * 24 * 60 * 60 * 1000);

                const response = await fetch(heliusUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        limit: 1000,
                        before: null,
                        until: null,
                        commitment: 'confirmed',
                        type: 'SWAP',
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Helius API error: ${response.status}`);
                }

                const data = await response.json();
                const transactions: TokenTransaction[] = [];

                for (const tx of data) {
                    if (tx.timestamp * 1000 < cutoffTime) continue;

                    // Parse Solana swap transactions
                    const swapInfo = this.parseSolanaSwap(tx);
                    if (swapInfo && swapInfo.valueUsd >= minTradeValue) {
                        transactions.push(swapInfo);
                    }
                }

                return transactions.sort((a, b) => a.timestamp - b.timestamp);
            } catch (error) {
                console.error('Solana transaction fetch failed:', error);
                return [];
            }
        });
    }

    /**
     * Fetch Base transactions using Alchemy API
     */
    async fetchBaseTransactions(
        address: string,
        timeHorizonDays: number,
        minTradeValue: number
    ): Promise<TokenTransaction[]> {
        const cacheKey = this.getCacheKey('base', [address, timeHorizonDays, minTradeValue]);

        return this.cachedFetch(cacheKey, async () => {
            try {
                const alchemyUrl = this.config.alchemyApiKey
                    ? `https://base-mainnet.g.alchemy.com/v2/${this.config.alchemyApiKey}`
                    : 'https://mainnet.base.org';

                const cutoffTime = Date.now() - (timeHorizonDays * 24 * 60 * 60 * 1000);
                const cutoffBlock = await this.getBlockByTimestamp(cutoffTime, 'base');

                // Get ERC-20 transfers for the address
                const response = await fetch(alchemyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        id: 1,
                        jsonrpc: '2.0',
                        method: 'alchemy_getAssetTransfers',
                        params: [{
                            fromBlock: `0x${cutoffBlock.toString(16)}`,
                            toBlock: 'latest',
                            fromAddress: address,
                            category: ['erc20'],
                            withMetadata: true,
                            excludeZeroValue: true,
                            maxCount: 1000,
                        }],
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Alchemy API error: ${response.status}`);
                }

                const data = await response.json();
                const transactions: TokenTransaction[] = [];

                for (const transfer of data.result?.transfers || []) {
                    const txInfo = await this.parseBaseTransfer(transfer, minTradeValue);
                    if (txInfo) {
                        transactions.push(txInfo);
                    }
                }

                return transactions.sort((a, b) => a.timestamp - b.timestamp);
            } catch (error) {
                console.error('Base transaction fetch failed:', error);
                return [];
            }
        });
    }

    /**
     * Parse Solana swap transaction
     */
    private parseSolanaSwap(tx: any): TokenTransaction | null {
        try {
            // This is a simplified parser - would need more robust logic for production
            const swapEvent = tx.events?.find((e: any) => e.type === 'SWAP');
            if (!swapEvent) return null;

            const tokenTransfers = tx.tokenTransfers || [];
            if (tokenTransfers.length < 2) return null;

            // Determine if this is a buy or sell based on SOL involvement
            const solTransfer = tokenTransfers.find((t: any) =>
                t.mint === 'So11111111111111111111111111111111111111112' // SOL mint
            );

            if (!solTransfer) return null;

            const tokenTransfer = tokenTransfers.find((t: any) =>
                t.mint !== 'So11111111111111111111111111111111111111112'
            );

            if (!tokenTransfer) return null;

            const type = solTransfer.fromUserAccount === tx.feePayer ? 'buy' : 'sell';
            const amount = parseFloat(tokenTransfer.tokenAmount || '0');
            const solAmount = parseFloat(solTransfer.tokenAmount || '0') / 1e9; // Convert lamports to SOL

            // Estimate USD value (would use real SOL price in production)
            const solPriceUsd = 100; // Placeholder
            const valueUsd = solAmount * solPriceUsd;
            const priceUsd = amount > 0 ? valueUsd / amount : 0;

            return {
                hash: tx.signature,
                timestamp: tx.timestamp * 1000,
                tokenAddress: tokenTransfer.mint,
                tokenSymbol: tokenTransfer.tokenSymbol,
                type,
                amount,
                priceUsd,
                valueUsd,
                blockNumber: tx.slot,
            };
        } catch (error) {
            console.warn('Failed to parse Solana swap:', error);
            return null;
        }
    }

    /**
     * Parse Base ERC-20 transfer
     */
    private async parseBaseTransfer(transfer: any, minTradeValue: number): Promise<TokenTransaction | null> {
        try {
            // This would need enhancement to detect actual swaps vs transfers
            const valueUsd = parseFloat(transfer.metadata?.value || '0');
            if (valueUsd < minTradeValue) return null;

            return {
                hash: transfer.hash,
                timestamp: new Date(transfer.metadata.blockTimestamp).getTime(),
                tokenAddress: transfer.rawContract.address,
                tokenSymbol: transfer.asset,
                type: 'sell', // Simplified - would need swap detection logic
                amount: parseFloat(transfer.value || '0'),
                priceUsd: valueUsd / parseFloat(transfer.value || '1'),
                valueUsd,
                blockNumber: parseInt(transfer.blockNum, 16),
            };
        } catch (error) {
            console.warn('Failed to parse Base transfer:', error);
            return null;
        }
    }

    /**
     * Get block number by timestamp (simplified)
     */
    private async getBlockByTimestamp(timestamp: number, chain: 'base' | 'solana'): Promise<number> {
        // Simplified implementation - would use binary search in production
        const now = Date.now();
        const daysDiff = (now - timestamp) / (24 * 60 * 60 * 1000);

        if (chain === 'base') {
            // Base produces ~2 blocks per second
            const currentBlock = 10000000; // Placeholder
            return Math.max(0, currentBlock - Math.floor(daysDiff * 24 * 60 * 60 * 2));
        } else {
            // Solana slots
            const currentSlot = 200000000; // Placeholder
            return Math.max(0, currentSlot - Math.floor(daysDiff * 24 * 60 * 60 * 2));
        }
    }

    /**
     * Convert transactions to positions for analysis
     */
    groupTransactionsIntoPositions(transactions: TokenTransaction[]): TokenPosition[] {
        const positionMap = new Map<string, TokenPosition>();

        for (const tx of transactions) {
            const key = tx.tokenAddress;

            if (!positionMap.has(key)) {
                positionMap.set(key, {
                    tokenAddress: tx.tokenAddress,
                    tokenSymbol: tx.tokenSymbol,
                    entries: [],
                    exits: [],
                    avgEntryPrice: 0,
                    totalInvested: 0,
                    totalRealized: 0,
                    remainingBalance: 0,
                    isActive: false,
                });
            }

            const position = positionMap.get(key)!;

            if (tx.type === 'buy') {
                position.entries.push(tx);
                position.totalInvested += tx.valueUsd;
            } else {
                position.exits.push(tx);
                position.totalRealized += tx.valueUsd;
            }
        }

        // Calculate derived metrics for each position
        for (const position of positionMap.values()) {
            if (position.entries.length > 0) {
                position.avgEntryPrice = position.totalInvested /
                    position.entries.reduce((sum, entry) => sum + entry.amount, 0);
            }

            // Simplified balance calculation
            const totalBought = position.entries.reduce((sum, entry) => sum + entry.amount, 0);
            const totalSold = position.exits.reduce((sum, exit) => sum + exit.amount, 0);
            position.remainingBalance = totalBought - totalSold;
            position.isActive = position.remainingBalance > 0;
        }

        return Array.from(positionMap.values()).filter(p =>
            p.entries.length > 0 && p.totalInvested > 0
        );
    }
}

export const transactionClient = new TransactionClient({
    heliusApiKey: process.env.NEXT_PUBLIC_HELIUS_API_KEY,
    alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
});