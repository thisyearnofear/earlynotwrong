/**
 * Price Service
 * Enhanced market data integration for accurate patience tax calculations.
 * Consolidates multiple data sources for comprehensive price analysis.
 */

export interface PricePoint {
    timestamp: number;
    price: number;
    volume?: number;
    marketCap?: number;
}

export interface TokenMetadata {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoUri?: string;
    coingeckoId?: string;
}

export interface PriceAnalysis {
    currentPrice: number;
    priceChange24h: number;
    priceChange7d: number;
    allTimeHigh: number;
    allTimeLow: number;
    marketCap?: number;
    volume24h?: number;
    lastUpdated: number;
}

export class PriceService {
    private cache = new Map<string, { data: any; timestamp: number }>();
    private cacheExpiry = 5 * 60 * 1000; // 5 minutes

    private birdeyeUrl = "https://public-api.birdeye.so";
    private coingeckoUrl = "https://api.coingecko.com/api/v3";
    private dexScreenerUrl = "https://api.dexscreener.com/latest/dex";

    constructor(
        private config: {
            birdeyeApiKey?: string;
            coingeckoApiKey?: string;
        } = {}
    ) { }

    private getCacheKey(method: string, params: any[]): string {
        return `price_${method}_${JSON.stringify(params)}`;
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
     * Get comprehensive token metadata
     */
    async getTokenMetadata(
        tokenAddress: string,
        chain: 'solana' | 'base'
    ): Promise<TokenMetadata | null> {
        const cacheKey = this.getCacheKey('metadata', [tokenAddress, chain]);

        return this.cachedFetch(cacheKey, async () => {
            try {
                if (chain === 'solana') {
                    // Use Birdeye for Solana token metadata
                    const response = await fetch(
                        `${this.birdeyeUrl}/defi/token_overview?address=${tokenAddress}`,
                        {
                            headers: this.config.birdeyeApiKey ? {
                                'X-API-KEY': this.config.birdeyeApiKey,
                            } : {},
                        }
                    );

                    if (!response.ok) throw new Error('Birdeye metadata fetch failed');

                    const data = await response.json();
                    if (!data.success || !data.data) return null;

                    const token = data.data;
                    return {
                        address: tokenAddress,
                        symbol: token.symbol || 'UNKNOWN',
                        name: token.name || 'Unknown Token',
                        decimals: token.decimals || 9,
                        logoUri: token.logoURI,
                    };
                } else {
                    // Use DexScreener for Base token metadata
                    const response = await fetch(`${this.dexScreenerUrl}/tokens/${tokenAddress}`);
                    if (!response.ok) throw new Error('DexScreener metadata fetch failed');

                    const data = await response.json();
                    const pair = data.pairs?.[0];

                    if (!pair) return null;

                    return {
                        address: tokenAddress,
                        symbol: pair.baseToken?.symbol || 'UNKNOWN',
                        name: pair.baseToken?.name || 'Unknown Token',
                        decimals: 18, // Default for ERC-20
                        logoUri: pair.info?.imageUrl,
                    };
                }
            } catch (error) {
                console.warn(`Token metadata fetch failed for ${tokenAddress}:`, error);
                return null;
            }
        });
    }

    /**
     * Get detailed price analysis for a token
     */
    async getPriceAnalysis(
        tokenAddress: string,
        chain: 'solana' | 'base'
    ): Promise<PriceAnalysis | null> {
        const cacheKey = this.getCacheKey('analysis', [tokenAddress, chain]);

        return this.cachedFetch(cacheKey, async () => {
            try {
                if (chain === 'solana') {
                    // Use Birdeye for comprehensive Solana price data
                    const response = await fetch(
                        `${this.birdeyeUrl}/defi/price?list_address=${tokenAddress}`,
                        {
                            headers: this.config.birdeyeApiKey ? {
                                'X-API-KEY': this.config.birdeyeApiKey,
                            } : {},
                        }
                    );

                    if (!response.ok) throw new Error('Birdeye price fetch failed');

                    const data = await response.json();
                    if (!data.success || !data.data) return null;

                    const priceData = data.data;
                    return {
                        currentPrice: priceData.value || 0,
                        priceChange24h: priceData.priceChange24hPercent || 0,
                        priceChange7d: priceData.priceChange7dPercent || 0,
                        allTimeHigh: priceData.priceChange24hPercent || 0, // Placeholder
                        allTimeLow: priceData.priceChange24hPercent || 0, // Placeholder
                        volume24h: priceData.volume24h,
                        lastUpdated: Date.now(),
                    };
                } else {
                    // Use DexScreener for Base price analysis
                    const response = await fetch(`${this.dexScreenerUrl}/tokens/${tokenAddress}`);
                    if (!response.ok) throw new Error('DexScreener price fetch failed');

                    const data = await response.json();
                    const pair = data.pairs?.[0];

                    if (!pair) return null;

                    return {
                        currentPrice: parseFloat(pair.priceUsd || '0'),
                        priceChange24h: parseFloat(pair.priceChange?.h24 || '0'),
                        priceChange7d: parseFloat(pair.priceChange?.h6 || '0'), // Approximate
                        allTimeHigh: parseFloat(pair.priceUsd || '0'), // Placeholder
                        allTimeLow: parseFloat(pair.priceUsd || '0'), // Placeholder
                        volume24h: parseFloat(pair.volume?.h24 || '0'),
                        marketCap: parseFloat(pair.marketCap || '0'),
                        lastUpdated: Date.now(),
                    };
                }
            } catch (error) {
                console.warn(`Price analysis failed for ${tokenAddress}:`, error);
                return null;
            }
        });
    }

    /**
     * Get historical price data with enhanced accuracy
     */
    async getHistoricalPrices(
        tokenAddress: string,
        chain: 'solana' | 'base',
        fromTimestamp: number,
        toTimestamp: number,
        interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '1h'
    ): Promise<PricePoint[]> {
        const cacheKey = this.getCacheKey('historical', [tokenAddress, chain, fromTimestamp, toTimestamp, interval]);

        return this.cachedFetch(cacheKey, async () => {
            try {
                if (chain === 'solana') {
                    // Use Birdeye for detailed Solana price history
                    const response = await fetch(
                        `${this.birdeyeUrl}/defi/history_price?address=${tokenAddress}&address_type=token&type=${interval.toUpperCase()}&time_from=${Math.floor(fromTimestamp / 1000)}&time_to=${Math.floor(toTimestamp / 1000)}`,
                        {
                            headers: this.config.birdeyeApiKey ? {
                                'X-API-KEY': this.config.birdeyeApiKey,
                            } : {},
                        }
                    );

                    if (!response.ok) throw new Error('Birdeye historical data fetch failed');

                    const data = await response.json();
                    if (!data.success || !data.data?.items) return [];

                    return data.data.items.map((item: any) => ({
                        timestamp: item.unixTime * 1000,
                        price: item.value || 0,
                        volume: item.volume,
                    }));
                } else {
                    // For Base, we'll use multiple sources and fallback logic
                    try {
                        // Try CoinGecko first if we have an API key
                        if (this.config.coingeckoApiKey) {
                            const response = await fetch(
                                `${this.coingeckoUrl}/coins/ethereum/contract/${tokenAddress}/market_chart/range?vs_currency=usd&from=${Math.floor(fromTimestamp / 1000)}&to=${Math.floor(toTimestamp / 1000)}`,
                                {
                                    headers: {
                                        'x-cg-demo-api-key': this.config.coingeckoApiKey,
                                    },
                                }
                            );

                            if (response.ok) {
                                const data = await response.json();
                                return data.prices?.map(([timestamp, price]: [number, number]) => ({
                                    timestamp,
                                    price,
                                })) || [];
                            }
                        }

                        // Fallback to DexScreener current price
                        const response = await fetch(`${this.dexScreenerUrl}/tokens/${tokenAddress}`);
                        if (!response.ok) throw new Error('DexScreener fallback failed');

                        const data = await response.json();
                        const pair = data.pairs?.[0];

                        if (!pair) return [];

                        // Return single current price point as fallback
                        return [{
                            timestamp: Date.now(),
                            price: parseFloat(pair.priceUsd || '0'),
                            volume: parseFloat(pair.volume?.h24 || '0'),
                        }];
                    } catch (error) {
                        console.warn('Base historical price fetch failed:', error);
                        return [];
                    }
                }
            } catch (error) {
                console.warn(`Historical price fetch failed for ${tokenAddress}:`, error);
                return [];
            }
        });
    }

    /**
     * Calculate precise patience tax based on actual price trajectory
     */
    async calculatePatienceTax(
        tokenAddress: string,
        chain: 'solana' | 'base',
        exitPrice: number,
        exitTimestamp: number,
        positionSize: number,
        holdingPeriodDays: number = 90
    ): Promise<{
        patienceTax: number;
        maxMissedGain: number;
        maxMissedGainDate: number;
        currentMissedGain: number;
        wouldBeValue: number;
    }> {
        try {
            const endTimestamp = Math.min(
                Date.now(),
                exitTimestamp + (holdingPeriodDays * 24 * 60 * 60 * 1000)
            );

            const priceHistory = await this.getHistoricalPrices(
                tokenAddress,
                chain,
                exitTimestamp,
                endTimestamp,
                '1h'
            );

            if (priceHistory.length === 0) {
                return {
                    patienceTax: 0,
                    maxMissedGain: 0,
                    maxMissedGainDate: exitTimestamp,
                    currentMissedGain: 0,
                    wouldBeValue: positionSize,
                };
            }

            // Find the maximum price after exit
            let maxPrice = exitPrice;
            let maxPriceDate = exitTimestamp;
            let currentPrice = exitPrice;

            for (const point of priceHistory) {
                if (point.price > maxPrice) {
                    maxPrice = point.price;
                    maxPriceDate = point.timestamp;
                }
                currentPrice = point.price; // Last price in the series
            }

            // Calculate missed gains
            const maxMissedGainMultiplier = maxPrice / exitPrice;
            const currentMissedGainMultiplier = currentPrice / exitPrice;

            const maxMissedGain = (maxMissedGainMultiplier - 1) * 100; // Percentage
            const currentMissedGain = (currentMissedGainMultiplier - 1) * 100;

            // Calculate dollar values
            const patienceTax = positionSize * (maxMissedGainMultiplier - 1);
            const wouldBeValue = positionSize * currentMissedGainMultiplier;

            return {
                patienceTax: Math.max(0, patienceTax),
                maxMissedGain,
                maxMissedGainDate: maxPriceDate,
                currentMissedGain,
                wouldBeValue,
            };
        } catch (error) {
            console.error('Patience tax calculation failed:', error);
            return {
                patienceTax: 0,
                maxMissedGain: 0,
                maxMissedGainDate: exitTimestamp,
                currentMissedGain: 0,
                wouldBeValue: positionSize,
            };
        }
    }

    /**
     * Batch analyze multiple positions for efficiency
     */
    async batchAnalyzePositions(
        positions: Array<{
            tokenAddress: string;
            chain: 'solana' | 'base';
            exitPrice: number;
            exitTimestamp: number;
            positionSize: number;
        }>
    ): Promise<Array<{
        tokenAddress: string;
        metadata: TokenMetadata | null;
        priceAnalysis: PriceAnalysis | null;
        patienceTax: number;
        maxMissedGain: number;
    }>> {
        const results = await Promise.allSettled(
            positions.map(async (position) => {
                const [metadata, priceAnalysis, patienceTaxData] = await Promise.allSettled([
                    this.getTokenMetadata(position.tokenAddress, position.chain),
                    this.getPriceAnalysis(position.tokenAddress, position.chain),
                    this.calculatePatienceTax(
                        position.tokenAddress,
                        position.chain,
                        position.exitPrice,
                        position.exitTimestamp,
                        position.positionSize
                    ),
                ]);

                return {
                    tokenAddress: position.tokenAddress,
                    metadata: metadata.status === 'fulfilled' ? metadata.value : null,
                    priceAnalysis: priceAnalysis.status === 'fulfilled' ? priceAnalysis.value : null,
                    patienceTax: patienceTaxData.status === 'fulfilled' ? patienceTaxData.value.patienceTax : 0,
                    maxMissedGain: patienceTaxData.status === 'fulfilled' ? patienceTaxData.value.maxMissedGain : 0,
                };
            })
        );

        return results
            .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
            .map(result => result.value);
    }
}

export const priceService = new PriceService({
    birdeyeApiKey: process.env.NEXT_PUBLIC_BIRDEYE_API_KEY,
    coingeckoApiKey: process.env.NEXT_PUBLIC_COINGECKO_API_KEY,
});