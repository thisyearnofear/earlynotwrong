#!/usr/bin/env npx tsx
/**
 * API Route Testing Script
 * Tests the core API endpoints with showcase wallet addresses
 */

const SHOWCASE_WALLETS = [
  {
    id: "base-jesse",
    name: "Jesse (Base)",
    chain: "base",
    address: "0xFB70BDE99b4933A576Ea4e38645Ee1E88B1D6b19",
  },
  {
    id: "toly-solana",
    name: "Toly",
    chain: "solana",
    address: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
  },
  {
    id: "zinger-solana",
    name: "Zinger",
    chain: "solana",
    address: "6qemckK3fajDuKhVNyvRxNd9a3ubFXxMWkHSEgMVxxov",
  },
  {
    id: "deployer-base",
    name: "Deployer",
    chain: "base",
    address: "0xc4Fdf12dC03424bEb5c117B4B19726401a9dD1AB",
  },
];

const BASE_URL = process.env.API_URL || "http://localhost:3000";

async function testHeliusApiDirect(address: string) {
  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_API_KEY) {
    console.error("❌ HELIUS_API_KEY not set");
    return null;
  }
  
  const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}`;
  console.log(`  Testing Helius API directly for ${address}...`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  ❌ Helius API error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error(`  Response: ${text.slice(0, 200)}`);
      return null;
    }
    const data = await response.json();
    console.log(`  ✅ Helius returned ${data.length} transactions`);
    
    // Analyze transaction types
    const types: Record<string, number> = {};
    let swapsWithSol = 0;
    let swapsWithTokenTransfers = 0;
    
    for (const tx of data) {
      types[tx.type] = (types[tx.type] || 0) + 1;
      
      const tokenTransfers = tx.tokenTransfers || [];
      if (tokenTransfers.length >= 2) {
        swapsWithTokenTransfers++;
        const hasSol = tokenTransfers.some(
          (t: any) => t.mint === "So11111111111111111111111111111111111111112"
        );
        if (hasSol) swapsWithSol++;
      }
    }
    
    console.log(`  Transaction types: ${JSON.stringify(types)}`);
    console.log(`  Txs with 2+ token transfers: ${swapsWithTokenTransfers}`);
    console.log(`  Swaps involving SOL: ${swapsWithSol}`);
    
    if (data.length > 0) {
      console.log(`  Sample tx: ${data[0].signature?.slice(0, 20)}...`);
      console.log(`  Timestamp: ${new Date(data[0].timestamp * 1000).toISOString()}`);
      // Show a sample transaction structure
      if (data[0].tokenTransfers?.length > 0) {
        console.log(`  Sample tokenTransfers:`, JSON.stringify(data[0].tokenTransfers.slice(0, 2), null, 2));
      }
    }
    return data;
  } catch (error) {
    console.error(`  ❌ Helius fetch error:`, error);
    return null;
  }
}

async function testAlchemyApiDirect(address: string) {
  const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
  if (!ALCHEMY_API_KEY) {
    console.error("❌ ALCHEMY_API_KEY not set");
    return null;
  }
  
  const url = `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  console.log(`  Testing Alchemy API directly for ${address}...`);
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [
          {
            fromBlock: "0x0",
            toBlock: "latest",
            fromAddress: address,
            category: ["erc20"],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: "0x64",
          },
        ],
      }),
    });
    
    if (!response.ok) {
      console.error(`  ❌ Alchemy API error: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    if (data.error) {
      console.error(`  ❌ Alchemy RPC error:`, data.error);
      return null;
    }
    
    const transfers = data.result?.transfers || [];
    console.log(`  ✅ Alchemy returned ${transfers.length} transfers (from address)`);
    
    // Also check incoming transfers
    const incomingResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [
          {
            fromBlock: "0x0",
            toBlock: "latest",
            toAddress: address,
            category: ["erc20"],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: "0x64",
          },
        ],
      }),
    });
    
    const incomingData = await incomingResponse.json();
    const incomingTransfers = incomingData.result?.transfers || [];
    console.log(`  ✅ Alchemy returned ${incomingTransfers.length} incoming transfers`);
    
    if (transfers.length > 0) {
      console.log(`  Sample transfer: ${transfers[0].asset} - ${transfers[0].value}`);
    }
    
    return { outgoing: transfers, incoming: incomingTransfers };
  } catch (error) {
    console.error(`  ❌ Alchemy fetch error:`, error);
    return null;
  }
}

async function testTransactionsApi(wallet: typeof SHOWCASE_WALLETS[0]) {
  console.log(`\n📊 Testing transactions API for ${wallet.name} (${wallet.chain})...`);
  
  const url = `${BASE_URL}/api/analyze/transactions`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: wallet.address,
        chain: wallet.chain,
        timeHorizonDays: 365, // 1 year
        minTradeValue: 10,    // Lower threshold
      }),
    });
    
    if (!response.ok) {
      console.error(`  ❌ API error: ${response.status}`);
      const text = await response.text();
      console.error(`  Response: ${text}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`  ✅ API returned ${data.count} transactions`);
    
    if (data.transactions?.length > 0) {
      console.log(`  Sample: ${data.transactions[0].tokenSymbol} - $${data.transactions[0].valueUsd.toFixed(2)}`);
    }
    
    return data;
  } catch (error) {
    console.error(`  ❌ API fetch error:`, error);
    return null;
  }
}

async function main() {
  console.log("🔍 Early Not Wrong - API Testing\n");
  console.log("=".repeat(60));
  
  // Load env vars using Bun's built-in .env support
  // Bun automatically loads .env.local
  
  console.log("\n📋 Environment Check:");
  console.log(`  HELIUS_API_KEY: ${process.env.HELIUS_API_KEY ? "✅ Set" : "❌ Missing"}`);
  console.log(`  ALCHEMY_API_KEY: ${process.env.ALCHEMY_API_KEY ? "✅ Set" : "❌ Missing"}`);
  console.log(`  API Base URL: ${BASE_URL}`);
  
  // Test direct API calls first
  console.log("\n" + "=".repeat(60));
  console.log("🔌 Direct API Tests (bypassing Next.js):\n");
  
  // Test Solana (Helius) - Toly
  const tolyWallet = SHOWCASE_WALLETS.find(w => w.id === "toly-solana")!;
  console.log(`\n🪙 Solana - ${tolyWallet.name}:`);
  await testHeliusApiDirect(tolyWallet.address);
  
  // Test Solana (Helius) - Zinger
  const zingerWallet = SHOWCASE_WALLETS.find(w => w.id === "zinger-solana")!;
  console.log(`\n🪙 Solana - ${zingerWallet.name}:`);
  await testHeliusApiDirect(zingerWallet.address);
  
  // Test Base (Alchemy) - Jesse
  const jesseWallet = SHOWCASE_WALLETS.find(w => w.id === "base-jesse")!;
  console.log(`\n🔷 Base - ${jesseWallet.name}:`);
  await testAlchemyApiDirect(jesseWallet.address);
  
  // Test Base (Alchemy) - Deployer
  const deployerWallet = SHOWCASE_WALLETS.find(w => w.id === "deployer-base")!;
  console.log(`\n🔷 Base - ${deployerWallet.name}:`);
  await testAlchemyApiDirect(deployerWallet.address);
  
  // Test the Next.js API routes if server is running
  console.log("\n" + "=".repeat(60));
  console.log("🚀 Next.js API Route Tests:\n");
  
  try {
    const healthCheck = await fetch(`${BASE_URL}/api/cache-stats`);
    if (!healthCheck.ok) {
      console.log("⚠️  Next.js server not running. Start with: bun dev");
      console.log("   Direct API tests above show your API keys are working correctly.\n");
      return;
    }
  } catch {
    console.log("⚠️  Next.js server not running. Start with: bun dev");
    console.log("   Direct API tests above show your API keys are working correctly.\n");
    return;
  }
  
  for (const wallet of SHOWCASE_WALLETS) {
    await testTransactionsApi(wallet);
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("✅ Testing complete\n");
}

main().catch(console.error);
