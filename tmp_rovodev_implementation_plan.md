# Implementation Plan: Ethos Integration Enhancement

## Core Principles Alignment
✅ ENHANCEMENT FIRST - Reusing Terminal, AttestationDialog, existing API routes
✅ AGGRESSIVE CONSOLIDATION - Auditing ethos.ts, ethos-reviews.ts for duplication
✅ PREVENT BLOAT - Single identity resolver, unified analysis service
✅ DRY - Cached service layer wraps all Ethos calls
✅ CLEAN - Clear separation: UI → Services → API → Ethos
✅ MODULAR - Each service independently testable
✅ PERFORMANT - Server-side caching, parallel fetching
✅ ORGANIZED - Domain-driven: /lib/services/identity, /lib/services/ethos-cache

---

## Parallel Work Distribution

### 🤖 AI Tasks (Architecture & Backend - 6-8 hours)
**Focus: Service layer, API enhancement, caching**

#### Task Group A: Service Layer Foundation (2-3 hours)
1. **Create cached Ethos service** (`src/lib/services/ethos-cache.ts`)
   - Wrap all ethosClient methods with Next.js caching
   - Add rate limit detection and exponential backoff
   - Implement cache invalidation strategies
   
2. **Build identity resolution service** (`src/lib/services/identity-resolver.ts`)
   - Unified resolver for: address, ENS, Farcaster, Lens
   - Parallel resolution with Promise.allSettled
   - Type-safe response with all identities merged

3. **Consolidate existing code**
   - Audit `ethos.ts` and `ethos-reviews.ts` for duplication
   - Move shared logic to services
   - Remove dead code

#### Task Group B: API Enhancement (2-3 hours)
4. **Update `/api/analyze/transactions`**
   - Accept `walletAddress` parameter (not just connected user)
   - Add identity resolution before analysis
   - Return merged identity data

5. **Create `/api/wallet/[address]/route.ts`**
   - GET endpoint for cached wallet analysis
   - Combines: Ethos profile + conviction analysis + social proof
   - Proper error handling and rate limiting

6. **Update `/api/analyze/prices`**
   - Support arbitrary addresses
   - Cache price data per token (not per user)

#### Task Group C: Review Integration (1-2 hours)
7. **Fix Ethos review deep-linking**
   - Update `ethos-reviews.ts` with correct URL format
   - Test with real Ethos URLs
   - Add "Write Review" button integration

---

### 👤 Human Tasks (UI/UX Components - 6-8 hours)
**Focus: Component enhancement, user flows, styling**

#### Task Group D: Search & Input UI (2-3 hours)
8. **Create WalletSearchInput component** (`src/components/wallet/wallet-search-input.tsx`)
   ```tsx
   // Simple component that:
   // - Has input field with placeholder "vitalik.eth, 0x..., or @farcaster"
   // - Shows loading state while resolving
   // - Displays resolved identity (avatar, name, addresses)
   // - Emits onWalletSelected event
   ```

9. **Enhance Navbar with global search**
   - Add search icon/button in navbar
   - Opens modal/dropdown with WalletSearchInput
   - Quick access from anywhere

10. **Update hero section on page.tsx**
    - Add "Analyze Any Wallet" section above/alongside connect button
    - Integrate WalletSearchInput
    - Clear UX for "analyze others" vs "analyze your own"

#### Task Group E: Display Enhancements (2-3 hours)
11. **Enhance existing profile card section** (around line 570 in page.tsx)
    - Add "Analyzing: [wallet info]" when viewing others
    - Show social proof ("Vouched by X", "Reviews: Y")
    - Add "Write Review" button (for Ethos 500+ users)

12. **Create WalletComparisonCard** (`src/components/ui/wallet-comparison-card.tsx`)
    - Side-by-side layout for 2-3 wallets
    - Reuse existing ConvictionBadge, stats display
    - "Add another wallet" button

13. **Add social proof badges**
    - Create `<SocialProofBadge>` component
    - Show: review count, vouch count, network connections
    - Integrate into existing cards

#### Task Group F: User Flows (1-2 hours)
14. **Add "Compare" feature**
    - Button to add current wallet to comparison
    - Comparison tray at bottom of screen
    - Uses WalletComparisonCard

15. **Polish and responsive design**
    - Mobile optimization for search input
    - Loading states and skeletons
    - Error states for invalid addresses

---

## Dependency Graph

```
Service Layer (AI)
├─ ethos-cache.ts (AI Task 1)
├─ identity-resolver.ts (AI Task 2)
└─ Code consolidation (AI Task 3)
    ↓
API Routes (AI)
├─ /api/analyze/transactions update (AI Task 4)
├─ /api/wallet/[address] (AI Task 5)
└─ /api/analyze/prices update (AI Task 6)
    ↓
UI Components (Human) - Can start in parallel
├─ WalletSearchInput (Human Task 8)
├─ Navbar enhancement (Human Task 9)
├─ Hero section update (Human Task 10)
├─ Profile card enhancement (Human Task 11)
├─ WalletComparisonCard (Human Task 12)
├─ SocialProofBadge (Human Task 13)
└─ Compare feature (Human Task 14)
    ↓
Integration & Polish (Both)
└─ Connect UI to API, testing, refinement
```

---

## Phase 1: Foundation (Days 1-2)

### AI Focuses On:
- [ ] Create `src/lib/services/ethos-cache.ts`
- [ ] Create `src/lib/services/identity-resolver.ts`
- [ ] Audit and consolidate `ethos.ts` + `ethos-reviews.ts`
- [ ] Update `/api/analyze/transactions` route

### Human Focuses On:
- [ ] Create `src/components/wallet/wallet-search-input.tsx` (basic version)
- [ ] Add search to navbar (just UI, can use mock data)
- [ ] Design WalletComparisonCard layout (can use mock data)

### End of Phase 1 Checkpoint:
✅ Service layer exists and is tested
✅ API can handle arbitrary addresses
✅ UI components exist (even if not fully wired)

---

## Phase 2: Integration (Days 3-4)

### AI Focuses On:
- [ ] Create `/api/wallet/[address]` endpoint
- [ ] Update `/api/analyze/prices` for caching
- [ ] Fix Ethos review deep-linking
- [ ] Add error handling and rate limiting

### Human Focuses On:
- [ ] Wire WalletSearchInput to identity-resolver API
- [ ] Enhance hero section with search integration
- [ ] Update profile card with social proof
- [ ] Create SocialProofBadge component

### End of Phase 2 Checkpoint:
✅ Can search and analyze any wallet
✅ Results show Ethos + conviction data
✅ Social proof visible

---

## Phase 3: Advanced Features (Days 5-6)

### AI Focuses On:
- [ ] Implement conviction attestation backend
- [ ] Add bulk analysis endpoint (for comparison)
- [ ] Optimize caching strategies
- [ ] Add analytics/logging

### Human Focuses On:
- [ ] Build comparison feature UI
- [ ] Enhance AttestationDialog for viewing others
- [ ] Polish responsive design
- [ ] Add loading states and animations

### End of Phase 3 Checkpoint:
✅ Full wallet inspector working
✅ Comparison mode functional
✅ Can attest to others' conviction
✅ Polished UX

---

## Phase 4: Polish & Launch (Day 7)

### Both Work On:
- [ ] End-to-end testing
- [ ] Performance optimization
- [ ] Bug fixes
- [ ] Documentation
- [ ] Prepare for launch

---

## Technical Specifications

### Identity Resolution API
```typescript
// POST /api/identity/resolve
{
  "input": "vitalik.eth" | "0x..." | "@farcaster"
}

// Response
{
  "resolved": true,
  "address": "0x...",
  "ens": "vitalik.eth",
  "farcaster": { "username": "vitalik", "fid": 123 },
  "ethos": { "score": 2450, "profile": {...} },
  "lens": null
}
```

### Wallet Analysis API
```typescript
// GET /api/wallet/0x.../analysis
{
  "address": "0x...",
  "identity": {...},
  "conviction": {
    "score": 92,
    "archetype": "Iron Pillar",
    "metrics": {...}
  },
  "ethos": {
    "score": 2450,
    "tier": "Elite",
    "reviews": 23,
    "vouches": 127
  },
  "social": {
    "connections": 12,
    "mutualConnections": 3
  }
}
```

---

## Code Standards

### File Organization
```
src/lib/services/
  ├─ ethos-cache.ts          (AI creates)
  ├─ identity-resolver.ts    (AI creates)
  └─ wallet-analyzer.ts      (AI creates)

src/components/wallet/
  ├─ wallet-search-input.tsx (Human creates)
  └─ wallet-comparison-card.tsx (Human creates)

src/app/api/
  ├─ identity/
  │   └─ resolve/route.ts    (AI creates)
  └─ wallet/
      └─ [address]/
          └─ route.ts        (AI creates)
```

### Naming Conventions
- Services: `noun-verb` (ethos-cache, identity-resolver)
- Components: `PascalCase` (WalletSearchInput)
- Hooks: `use-noun` (use-wallet-analysis)

### Import Order
```typescript
// 1. External
import { useState } from "react";
import { motion } from "framer-motion";

// 2. Internal libs
import { identityResolver } from "@/lib/services/identity-resolver";
import { ethosCache } from "@/lib/services/ethos-cache";

// 3. Components
import { WalletSearchInput } from "@/components/wallet/wallet-search-input";

// 4. Types
import type { ResolvedIdentity } from "@/types";
```

---

## Performance Targets

### Caching Strategy
- **Ethos Scores**: 1 hour TTL (scores don't change rapidly)
- **Conviction Analysis**: 5 minutes TTL (on-chain data changes)
- **Identity Resolution**: 24 hours TTL (ENS/Farcaster stable)

### Rate Limiting
- **No Ethos Score (Anonymous)**: 10 requests/hour
- **Ethos 100-499**: 50 requests/hour  
- **Ethos 500-999**: 200 requests/hour
- **Ethos 1000+**: Unlimited (with reasonable throttling)

### Load Time Goals
- Identity resolution: < 500ms
- Full wallet analysis: < 2s
- Cached results: < 100ms

---

## Testing Checklist

### Unit Tests (AI)
- [ ] Identity resolver handles all input types
- [ ] Ethos cache properly invalidates
- [ ] API routes return correct types

### Integration Tests (Both)
- [ ] Search input → identity resolution → analysis flow
- [ ] Comparison mode with 2-3 wallets
- [ ] Rate limiting enforcement

### E2E Tests (Human)
- [ ] User searches for vitalik.eth
- [ ] User compares two wallets
- [ ] User writes review (deep link works)

---

## Launch Criteria

### Must Have ✅
- [ ] Search any wallet by address/ENS/Farcaster
- [ ] Display conviction + Ethos data
- [ ] Social proof indicators
- [ ] Review deep-linking works
- [ ] Caching functional
- [ ] Mobile responsive

### Nice to Have 🎯
- [ ] Comparison mode
- [ ] Attestation flow
- [ ] Bulk analysis
- [ ] Social discovery

### Future 🚀
- [ ] Watchlist functionality
- [ ] Real-time alerts
- [ ] API access for Ethos 2000+

---

## Risk Mitigation

### Rate Limits
- **Risk**: Hit Ethos API limits with arbitrary wallet analysis
- **Mitigation**: Aggressive caching (1hr TTL), rate limiting by user tier
- **Fallback**: Show last cached data with timestamp

### Authentication
- **Risk**: Need auth for review writing
- **Mitigation**: Phase 1 uses deep-linking (no auth needed)
- **Future**: Add Ethos OAuth when needed

### Performance
- **Risk**: Parallel fetching might be slow
- **Mitigation**: Show progressive loading (identity → Ethos → conviction)
- **Optimization**: Pre-fetch popular wallets

---

## Success Metrics

### Engagement
- **Baseline**: 80% users only analyze their own wallet
- **Target**: 60% users analyze at least 1 other wallet
- **Stretch**: 3+ wallets analyzed per session

### Viral Growth
- **Target**: 20% of analyses result in share/link to another user
- **Mechanism**: Share analyzed wallet results

### Retention
- **Target**: 40% return within 7 days to check updated scores
- **Mechanism**: Watchlist, comparison tracking

---

## Communication Plan

### Daily Standups
- Quick 5-min sync on Slack/Discord
- What did you complete?
- What are you working on?
- Any blockers?

### Code Reviews
- AI creates PR for each task group
- Human reviews and tests
- Iterate quickly

### Integration Points
- End of Phase 1: Integrate service layer with basic UI
- End of Phase 2: Full feature testing
- End of Phase 3: Polish and optimization

---

## Next Immediate Action

### AI Will Start With:
1. Create `src/lib/services/ethos-cache.ts` ✨
2. Create `src/lib/services/identity-resolver.ts` ✨
3. Consolidate existing Ethos code ✨

### You Can Start With:
1. Create `src/components/wallet/wallet-search-input.tsx`
2. Sketch out comparison card layout
3. Design social proof badge component

**Ready to begin? I'll start on the service layer now! 🚀**
