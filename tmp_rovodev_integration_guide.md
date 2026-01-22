# Integration Guide: Using the New Wallet Analysis System

## Quick Start

### 1. Simple Identity Search Component

```tsx
'use client';

import { useWalletIdentity } from '@/hooks/use-wallet-analysis';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

export function SimpleSearch() {
  const [input, setInput] = useState('');
  const { identity, loading, error, resolve } = useWalletIdentity(null, false);

  return (
    <div className="space-y-4">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="vitalik.eth, 0x..., or @farcaster"
        className="w-full px-4 py-2 border rounded"
      />
      <Button onClick={() => resolve(input)} disabled={loading}>
        {loading ? 'Resolving...' : 'Search'}
      </Button>
      
      {error && <p className="text-red-500">{error}</p>}
      
      {identity && (
        <div className="p-4 border rounded">
          <p>Address: {identity.address}</p>
          <p>ENS: {identity.ens.name || 'None'}</p>
          <p>Farcaster: {identity.farcaster?.username || 'None'}</p>
          <p>Ethos Score: {identity.ethos.score?.score || 'N/A'}</p>
        </div>
      )}
    </div>
  );
}
```

### 2. Full Wallet Analysis Component

```tsx
'use client';

import { useWalletAnalysis } from '@/hooks/use-wallet-analysis';
import { useState } from 'react';

export function WalletAnalyzer() {
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  const {
    identity,
    walletData,
    loading,
    error,
    resolve,
  } = useWalletAnalysis(searching ? input : null);

  const handleSearch = () => {
    setSearching(true);
    resolve(input);
  };

  return (
    <div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search wallet..."
      />
      <button onClick={handleSearch}>Search</button>

      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}

      {identity && walletData && (
        <div>
          <h3>{identity.ens.name || identity.address.slice(0, 8)}</h3>
          
          {/* Ethos Data */}
          <div>
            <p>Ethos Score: {walletData.ethos.score}</p>
            <p>Tier: {walletData.ethos.tier}</p>
          </div>

          {/* Social Proof */}
          <div>
            {walletData.socialProof.hasEthosProfile && <span>✓ Ethos</span>}
            {walletData.socialProof.hasFarcaster && <span>✓ Farcaster</span>}
            {walletData.socialProof.hasENS && <span>✓ ENS</span>}
          </div>
        </div>
      )}
    </div>
  );
}
```

### 3. Integration with Existing Store

```tsx
// In your existing page.tsx or component
import { useWalletAnalysis } from '@/hooks/use-wallet-analysis';
import { useAppStore } from '@/lib/store';

export function YourComponent() {
  const [searchInput, setSearchInput] = useState('');
  const { identity, walletData, resolve } = useWalletAnalysis(null);
  const { setEthosScore, setEthosProfile } = useAppStore();

  const handleAnalyze = async () => {
    await resolve(searchInput);
    
    // Update global store with results
    if (walletData?.ethos) {
      setEthosScore({ 
        score: walletData.ethos.score || 0,
        updatedAt: new Date().toISOString() 
      });
      setEthosProfile(walletData.ethos.profile);
    }

    // Now trigger conviction analysis with the resolved address
    if (identity?.address) {
      analyzeWallet(identity.address);
    }
  };

  return (
    // Your UI
  );
}
```

## API Usage

### Direct API Calls (if not using hooks)

#### Resolve Identity
```typescript
const response = await fetch('/api/identity/resolve', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ input: 'vitalik.eth' }),
});
const { identity } = await response.json();
```

#### Get Wallet Data
```typescript
const response = await fetch(`/api/wallet/${address}`);
const { data } = await response.json();
// data.identity, data.ethos, data.socialProof
```

## Type Definitions

```typescript
// Available from hooks
import type { ResolvedIdentity } from '@/lib/services/identity-resolver';

interface ResolvedIdentity {
  address: string;
  ens: { name: string | null; avatar: string | null };
  farcaster: FarcasterIdentity | null;
  ethos: {
    score: EthosScore | null;
    profile: EthosProfile | null;
  };
  lens: { handle: string | null; profileId: string | null } | null;
  resolvedFrom: 'address' | 'ens' | 'farcaster' | 'lens' | 'userkey';
  resolvedAt: string;
}
```

## Performance Tips

### 1. Cache Control
- Identity resolution is cached for 1 hour
- Ethos scores cached for 1 hour
- Profiles cached for 24 hours

### 2. Batch Operations
For comparing multiple wallets:
```typescript
import { cachedEthosService } from '@/lib/services/ethos-cache';

// In a server component or API route
const scores = await cachedEthosService.getBatchScores([
  '0xabc...',
  '0xdef...',
  '0x123...',
]);
```

### 3. Parallel Fetching
The hooks automatically fetch identity + wallet data in parallel:
```typescript
// This is optimized internally:
const analysis = useWalletAnalysis(input);
// Fetches: Identity → (ENS + Farcaster + Ethos) in parallel
```

## Error Handling

```typescript
const { identity, error } = useWalletIdentity(input);

if (error) {
  // Possible errors:
  // - "Invalid input"
  // - "Could not resolve identity"
  // - "Failed to fetch wallet data"
  // - Network errors
}
```

## Testing

```bash
# Run test script
./tmp_rovodev_test_services.sh

# Or manually:
npm run dev

# In another terminal:
curl -X POST http://localhost:3000/api/identity/resolve \
  -H "Content-Type: application/json" \
  -d '{"input":"vitalik.eth"}'
```

## Next Steps for UI Development

### Phase 1: Basic Input
1. Create `WalletSearchInput` component
2. Use `useWalletIdentity` hook
3. Display resolved identity

### Phase 2: Full Analysis
1. Connect to existing `analyzeWallet` function
2. Use `useWalletAnalysis` hook
3. Show conviction + Ethos data together

### Phase 3: Comparison
1. Maintain array of analyzed wallets
2. Use `getBatchScores` for multiple wallets
3. Display side-by-side

## Example: Updating Existing Page.tsx

```tsx
// Add to your page.tsx

import { useWalletAnalysis } from '@/hooks/use-wallet-analysis';

export default function Home() {
  // Existing code...
  const { analyzeWallet, isAnalyzing } = useConviction();
  
  // New: Wallet search
  const [searchInput, setSearchInput] = useState('');
  const walletAnalysis = useWalletAnalysis(null); // Manual trigger

  const handleSearchAndAnalyze = async () => {
    // 1. Resolve identity
    await walletAnalysis.resolve(searchInput);
    
    // 2. Analyze conviction (existing flow)
    if (walletAnalysis.identity?.address) {
      await analyzeWallet(walletAnalysis.identity.address);
    }
  };

  return (
    <div>
      {/* Add search section */}
      <section className="mb-12">
        <h2>Analyze Any Wallet</h2>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="vitalik.eth, 0x..., or @username"
        />
        <Button 
          onClick={handleSearchAndAnalyze}
          disabled={isAnalyzing || walletAnalysis.loading}
        >
          Analyze
        </Button>

        {walletAnalysis.identity && (
          <div>
            Analyzing: {walletAnalysis.identity.ens.name || walletAnalysis.identity.address}
            (Ethos: {walletAnalysis.walletData?.ethos.score})
          </div>
        )}
      </section>

      {/* Existing conviction analysis display */}
      {/* ... rest of your code ... */}
    </div>
  );
}
```
