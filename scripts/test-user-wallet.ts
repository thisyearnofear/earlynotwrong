#!/usr/bin/env npx tsx
/**
 * User Wallet Transaction Test
 * Specifically tests 4FzyJeDxqRn2SKwVLdh2gi9MCvrSvgkCvHDZnNyBpd5v
 */

const USER_WALLET = "4FzyJeDxqRn2SKwVLdh2gi9MCvrSvgkCvHDZnNyBpd5v";
const HELIUS_API_KEY = "b22d94ea-66d2-462d-8b15-dc7d254a4ba2";

interface TokenTransfer {
  mint: string;
  tokenAmount: number | string;
}

interface HeliusTransaction {
  timestamp: number;
  tokenTransfers?: TokenTransfer[];
}

const KNOWN_BASE_TOKENS = [
  "So11111111111111111111111111111111111111112", // SOL / WSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (Solana)
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT (Solana)
  "mSoLzYq7mSqcxt3ED4PSc69RzY83W95G5p7s8pAnJdV", // mSOL
  "J1toso9YmRAn99mX6K399Nn5E7f9oY1s3vshV68yTth", // jitoSOL
  "7dHbS7qBSnS6fJ686mD9B756S8PqM756S8PqM756S8Pq", // stSOL
];

async function testUserWallet() {
  console.log(`🔍 Testing Wallet: ${USER_WALLET}`);
  console.log(`📅 Time Horizon: 180 Days`);
  console.log("=".repeat(60));

  const cutoffTime = Date.now() - 180 * 24 * 60 * 60 * 1000;
  const url = `https://api.helius.xyz/v0/addresses/${USER_WALLET}/transactions?api-key=${HELIUS_API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`❌ Helius API error: ${response.status}`);
      return;
    }

    const data = (await response.json()) as HeliusTransaction[];
    console.log(`✅ Fetched ${data.length} recent transactions`);

    let qualifyingSwaps = 0;
    let potentialSwapsFilteredByBase = 0;
    let tooSmallSwaps = 0;

    for (const tx of data) {
      const txTime = tx.timestamp * 1000;
      if (txTime < cutoffTime) continue;

      const tokenTransfers = tx.tokenTransfers || [];

      // Look for swaps (usually involves multiple token transfers)
      if (tokenTransfers.length >= 2) {
        // Find base token
        const baseTransfer = tokenTransfers.find((t: TokenTransfer) =>
          KNOWN_BASE_TOKENS.includes(t.mint),
        );

        // Find traded token
        const tradedToken = tokenTransfers.find(
          (t: TokenTransfer) => !KNOWN_BASE_TOKENS.includes(t.mint),
        );

        if (baseTransfer && tradedToken) {
          // Check value (Simulate parseSolanaSwap logic)
          let baseAmountRaw =
            typeof baseTransfer.tokenAmount === "number"
              ? baseTransfer.tokenAmount
              : parseFloat(baseTransfer.tokenAmount || "0");

          const isSol =
            baseTransfer.mint === "So11111111111111111111111111111111111111112";

          // My fix: only divide if it's huge (atomic units)
          if (isSol && baseAmountRaw > 1_000_000_000_000) {
            baseAmountRaw = baseAmountRaw / 1e9;
          } else if (!isSol && baseAmountRaw > 1_000_000_000_000) {
            baseAmountRaw = baseAmountRaw / 1e6;
          }

          // Rough USD calculation (assuming SOL ~$150 for test)
          const valueUsd = isSol ? baseAmountRaw * 150 : baseAmountRaw;

          if (valueUsd >= 10) {
            // Using $10 threshold for testing
            qualifyingSwaps++;
            const baseName =
              baseTransfer.mint ===
              "So11111111111111111111111111111111111111112"
                ? "SOL"
                : baseTransfer.mint.slice(0, 8);
            console.log(
              `[SWAP] ${new Date(txTime).toLocaleDateString()} | ${tradedToken.mint.slice(0, 8)}... | Value: ~$${valueUsd.toFixed(2)} | Base: ${baseName}`,
            );
          } else {
            tooSmallSwaps++;
          }
        } else if (tokenTransfers.length >= 2) {
          const isBaseToBase = tokenTransfers.every((t: TokenTransfer) =>
            KNOWN_BASE_TOKENS.includes(t.mint),
          );
          if (isBaseToBase) {
            console.log(
              `[BASE-TO-BASE] ${new Date(txTime).toLocaleDateString()} | Mints: ${tokenTransfers.map((t: TokenTransfer) => t.mint.slice(0, 8)).join(", ")} (Filtered by app)`,
            );
          } else {
            potentialSwapsFilteredByBase++;
            console.log(
              `[FILTERED] No recognized base token. Mints: ${tokenTransfers.map((t: TokenTransfer) => t.mint.slice(0, 8)).join(", ")}`,
            );
          }
        }
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log(`📊 Summary for 180d:`);
    console.log(`   - Qualifying Swaps found: ${qualifyingSwaps}`);
    console.log(
      `   - Potential swaps filtered (unrecognized base): ${potentialSwapsFilteredByBase}`,
    );
    console.log(`   - Swaps below $10 threshold: ${tooSmallSwaps}`);

    if (qualifyingSwaps === 0 && potentialSwapsFilteredByBase > 0) {
      console.log(
        `\n💡 SUGGESTION: Some trades were found but the base tokens weren't recognized.`,
      );
      console.log(`   Consider adding these mints to KNOWN_BASE_TOKENS.`);
    }
  } catch (error: unknown) {
    console.error("❌ Test failed:", error);
  }
}

testUserWallet();
