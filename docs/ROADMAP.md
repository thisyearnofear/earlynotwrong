# EARLY, NOT WRONG — Roadmap

> Living document tracking product evolution. Last updated: January 2025

---

## Current State Assessment

### Product Design: 8/10

**Strengths:**
- Sharp, differentiated thesis — "behavior, not performance"
- Terminal aesthetic aligns with clinical, contrarian positioning
- Archetype system (Iron Pillar, Profit Phantom, etc.) creates memorable identity
- Ethos integration as reputation infrastructure enables composability

**Gaps:**
- No detailed position breakdown — users see aggregate scores but not underlying trades
- "Significant Events" cards are static; should be interactive drill-downs
- No historical tracking — users can't see conviction score evolution over time

### System Architecture: 7/10

**Strengths:**
- Clean separation: `transaction-client` → `market` → `price-service` → `use-conviction`
- Multi-chain abstraction (Solana/Base) well-structured
- Caching layer prevents redundant API calls
- Zustand store is lean and purposeful

**Gaps:**
- Transaction parsing is fragile (hardcoded SOL price, simplified swap detection)
- No backend — API keys exposed client-side (`NEXT_PUBLIC_*`)
- Batch analysis limited to 5 positions — should be server-side
- No error boundaries or retry logic for flaky external APIs

### Delivery on Vision: 7.5/10

Core loop works: connect → analyze → see conviction score. Showcase wallets demo value before real data integration is bulletproof. However, "self-knowledge" promise isn't fully realized — users get a score but not enough narrative about *why* or *what to do differently*.

---

## Phase 1: Depth Before Breadth

> Focus: Make the existing experience complete and insightful

### 1.1 Position Explorer
- [ ] Interactive drill-down into individual trades
- [ ] Entry/exit prices with timestamps
- [ ] Per-position patience tax calculation
- [ ] "What if you held" counterfactual visualization
- [ ] Token metadata display (logo, name, current price)

### 1.2 Server-Side API Layer
- [ ] Create Next.js API routes for sensitive operations
- [ ] Move Helius/Alchemy/Birdeye calls server-side
- [ ] Enable heavier batch processing (remove 5-position limit)
- [ ] Add retry logic and error handling for external APIs
- [ ] Rate limiting and request queuing

### 1.3 Historical Conviction Tracking
- [ ] Store attestations locally (or via Ethos)
- [ ] Show CI evolution over time (sparkline/chart)
- [ ] "Your conviction is improving/declining" insights
- [ ] Compare current vs. historical archetype

### 1.4 Enhanced Error States
- [ ] Graceful degradation when APIs fail
- [ ] Informative error messages with recovery actions
- [ ] Offline/cached mode for previously analyzed wallets

---

## Phase 2: Reputation Loop

> Focus: Make conviction shareable and comparable

### 2.1 Shareable Conviction Cards
- [ ] OG image generation for social sharing
- [ ] Twitter/Farcaster-optimized cards
- [ ] Format: "My Conviction Score: 78 | Iron Pillar"
- [ ] Deep link back to full analysis

### 2.2 Comparative Insights
- [ ] Cohort benchmarks ("more patient than 82% of $WIF traders")
- [ ] Chain-specific percentiles
- [ ] Time-period comparisons (30d vs 90d vs 180d)

### 2.3 Ethos Deep Integration
- [ ] Write conviction attestations on-chain
- [ ] Display historical attestations on profile
- [ ] Reputation-gated features based on Ethos credibility
- [ ] Cross-reference with other Ethos attestations

---

## Phase 3: $EARLY Token

> Focus: Non-extractive tokenomics aligned with product thesis

### 3.1 Token Utility Design

| Utility | Mechanic |
|---------|----------|
| **Conviction Staking** | Stake $EARLY to attest to your CI — if CI drops significantly, slashed stake redistributes to high-CI wallets |
| **Premium Analysis** | Hold X $EARLY for deeper analytics: full position history, multi-chain merged view, cohort comparisons |
| **Attestation Fuel** | Writing conviction attestations costs $EARLY (burned or staked), creating deflationary pressure |
| **Meta-Signal Subscriptions** | Pay $EARLY to subscribe to high-CI wallet activity feeds |
| **Governance** | Token holders vote on new archetypes, scoring formula, chain support |

### 3.2 Token Implementation
- [ ] Deploy on Solana (SPL token)
- [ ] Deploy on Base (ERC-20)
- [ ] Bridge mechanism between chains
- [ ] Staking contract for conviction attestations
- [ ] Premium tier gating logic

### 3.3 Token Distribution
- [ ] Define allocation (team, community, treasury, rewards)
- [ ] Early adopter airdrop criteria (high-CI wallets?)
- [ ] Liquidity strategy

---

## Phase 4: Meta-Signal Layer

> Focus: From self-knowledge to ecosystem signal

### 4.1 Wallet Intelligence
- [ ] High-CI wallet discovery feed
- [ ] Activity alerts for followed wallets
- [ ] "This wallet [CI: 85] just entered $TOKEN" signals

### 4.2 Protocol Integrations
- [ ] API for other dApps to query conviction scores
- [ ] Reputation-weighted features for partner protocols
- [ ] Conviction score as collateral factor (DeFi integration)

### 4.3 Advanced Analytics
- [ ] Sector-specific conviction (memecoins vs DeFi vs NFTs)
- [ ] Correlation analysis (does high CI predict returns?)
- [ ] Behavioral pattern recognition

---

## Technical Debt & Maintenance

### Ongoing
- [ ] Improve Solana swap parsing (handle more DEX formats)
- [ ] Real-time SOL/ETH price for accurate USD calculations
- [ ] Add comprehensive test coverage
- [ ] Performance monitoring and optimization
- [ ] Accessibility audit

### Infrastructure
- [ ] Database for historical data (Supabase/PlanetScale)
- [ ] Background job processing for heavy analysis
- [ ] CDN for OG image generation
- [ ] Analytics and error tracking (PostHog/Sentry)

---

## Success Metrics

| Metric | Target |
|--------|--------|
| "I didn't realize how much upside I gave away" moments | Qualitative feedback |
| Analyses completed | 1,000+ unique wallets |
| Attestations written to Ethos | 500+ |
| Shareable cards generated | 2,000+ |
| $EARLY holders | 5,000+ unique wallets |
| High-CI wallets discovered via platform | 100+ with CI > 80 |

---

## Design Principles (Reference)

- **ENHANCEMENT FIRST**: Enhance existing components over creating new ones
- **AGGRESSIVE CONSOLIDATION**: Delete unnecessary code rather than deprecating
- **PREVENT BLOAT**: Audit and consolidate before adding features
- **DRY**: Single source of truth for shared logic
- **CLEAN**: Clear separation of concerns with explicit dependencies
- **MODULAR**: Composable, testable, independent modules
- **PERFORMANT**: Adaptive loading, caching, resource optimization
- **ORGANIZED**: Predictable file structure with domain-driven design

---

## Changelog

### January 2025
- Initial roadmap created
- Fixed dead buttons (Thesis modal, Try Another Wallet, View Ethos Profile)
- Thesis modal implemented with terminal-style design
