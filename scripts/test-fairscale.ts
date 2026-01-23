/**
 * FairScale Integration Test
 * Tests the complete trust resolution flow with FairScale
 */

import { fairscaleClient } from '@/lib/fairscale';
import { cachedFairScaleService } from '@/lib/services/fairscale-cache';
import { trustResolver } from '@/lib/services/trust-resolver';
import { identityResolver } from '@/lib/services/identity-resolver';

// Test wallet addresses
const TEST_WALLETS = {
  // Example Solana wallet from FairScale docs
  solana: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  // Example ETH wallet (vitalik.eth)
  ethereum: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
};

async function testFairScaleClient() {
  console.log('\n🧪 Testing FairScale Client...\n');
  
  if (!fairscaleClient.isConfigured()) {
    console.error('❌ FairScale API key not configured!');
    console.log('   Add FAIRSCALE_API_KEY to your .env.local file');
    return false;
  }
  
  console.log('✓ FairScale API key configured');
  
  try {
    const score = await fairscaleClient.getScore(TEST_WALLETS.solana);
    
    if (score) {
      console.log('✓ FairScale API call successful');
      console.log(`  Wallet: ${score.wallet.substring(0, 8)}...`);
      console.log(`  FairScore: ${score.fairscore}`);
      console.log(`  Tier: ${score.tier}`);
      console.log(`  Badges: ${score.badges.length} badges`);
      if (score.badges.length > 0) {
        console.log(`    - ${score.badges[0].label}: ${score.badges[0].description}`);
      }
      return true;
    } else {
      console.error('❌ FairScale returned null');
      return false;
    }
  } catch (error) {
    console.error('❌ FairScale client error:', error);
    return false;
  }
}

async function testFairScaleCache() {
  console.log('\n🧪 Testing FairScale Cache Layer...\n');
  
  try {
    const score1 = await cachedFairScaleService.getScore(TEST_WALLETS.solana);
    const score2 = await cachedFairScaleService.getScore(TEST_WALLETS.solana);
    
    if (score1 && score2) {
      console.log('✓ Cache layer working');
      console.log(`  First call: ${score1.fairscore}`);
      console.log(`  Second call (cached): ${score2.fairscore}`);
      return true;
    } else {
      console.error('❌ Cache returned null');
      return false;
    }
  } catch (error) {
    console.error('❌ Cache error:', error);
    return false;
  }
}

async function testTrustResolver() {
  console.log('\n🧪 Testing Trust Resolver...\n');
  
  try {
    // Test Solana address
    const solanaTrust = await trustResolver.resolve(TEST_WALLETS.solana);
    console.log('✓ Solana address resolved');
    console.log(`  Unified Score: ${solanaTrust.score}/100`);
    console.log(`  Tier: ${solanaTrust.tier}`);
    console.log(`  Credibility: ${solanaTrust.credibilityLevel}`);
    console.log(`  Primary Provider: ${solanaTrust.primaryProvider}`);
    
    if (solanaTrust.providers.fairscale) {
      console.log(`  FairScale: ${solanaTrust.providers.fairscale.fairscore}`);
    }
    
    // Test Ethereum address
    const ethTrust = await trustResolver.resolve(TEST_WALLETS.ethereum);
    console.log('\n✓ Ethereum address resolved');
    console.log(`  Unified Score: ${ethTrust.score}/100`);
    console.log(`  Primary Provider: ${ethTrust.primaryProvider}`);
    
    return true;
  } catch (error) {
    console.error('❌ Trust resolver error:', error);
    return false;
  }
}

async function testIdentityResolver() {
  console.log('\n🧪 Testing Identity Resolver Integration...\n');
  
  try {
    const identity = await identityResolver.resolve(TEST_WALLETS.solana);
    
    if (identity) {
      console.log('✓ Identity resolved with trust score');
      console.log(`  Address: ${identity.address.substring(0, 8)}...`);
      console.log(`  Has Trust Score: ${!!identity.trust}`);
      
      if (identity.trust) {
        console.log(`  Unified Score: ${identity.trust.score}/100`);
        console.log(`  Can Access Premium: ${identity.trust.features.canAccessPremium}`);
        console.log(`  Can Access Whale Analysis: ${identity.trust.features.canAccessWhaleAnalysis}`);
        console.log(`  Resolution Path: ${identity._meta?.resolutionPath.join(' → ')}`);
      }
      
      return true;
    } else {
      console.error('❌ Identity resolver returned null');
      return false;
    }
  } catch (error) {
    console.error('❌ Identity resolver error:', error);
    return false;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        FairScale Integration Test Suite                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  const results = {
    client: await testFairScaleClient(),
    cache: await testFairScaleCache(),
    trustResolver: await testTrustResolver(),
    identityResolver: await testIdentityResolver(),
  };
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                       Test Results                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  console.log(`FairScale Client:          ${results.client ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`FairScale Cache:           ${results.cache ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Trust Resolver:            ${results.trustResolver ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Identity Resolver:         ${results.identityResolver ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(r => r);
  
  if (allPassed) {
    console.log('\n🎉 All tests passed! FairScale integration is working correctly.\n');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the errors above.\n');
  }
  
  process.exit(allPassed ? 0 : 1);
}

main();
