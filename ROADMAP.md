# EARLY, NOT WRONG - Feature Roadmap

## Removed Features (Simplified 2026-03-25)

The app was simplified to focus on core conviction analysis + privacy features. Below are features that were removed and criteria for reintroduction.

### Removed UI Components (~40 components)

| Feature | Description | Reintroduction Criteria |
|---------|-------------|------------------------|
| Alpha Discovery | Community-curated token recommendations | User demand + quality curation system |
| Token Heatmap | Visual token performance map | Performance optimization + user requests |
| Reputation Perks | Benefits tied to Ethos reputation | Partnership integrations ready |
| Conviction Alerts | Real-time conviction change notifications | Webhook infrastructure + user demand |
| Cohort Analysis | Compare against peer groups | Privacy-preserving aggregation ready |
| Behavioral Insights | Detailed psychology breakdown | User engagement metrics |
| Social Proof Badge | Display community endorsements | Ethos API stability |
| Watchlist | Track specific wallets/tokens | User demand + notification system |
| Personal Radar | Customizable metrics dashboard | Advanced user feature requests |
| Leaderboard Panel | Top conviction performers | Privacy concerns resolved |
| Unified Trust Card | Combined reputation display | API consolidation complete |
| FairScale Card | FairScale reputation integration | FairScale API stability |
| Capabilities Grid | Feature access overview | Onboarding improvements needed |
| Public Cluster Signals | Whale movement alerts | Data quality + user demand |
| Attestation Dialog | Create on-chain attestations | EAS integration maturity |

### Removed API Routes (~15 routes)

| Route | Description | Reintroduction Criteria |
|-------|-------------|------------------------|
| `/api/alerts/*` | Alert dispatch and management | Real-time infrastructure ready |
| `/api/alpha/discover` | Alpha token discovery | Curation algorithm complete |
| `/api/cohort/*` | Cohort benchmarking | Privacy-preserving computation |
| `/api/community/watchlist` | Community watchlist | User demand + moderation |
| `/api/leaderboard` | Leaderboard data | Privacy concerns resolved |
| `/api/tokens/heatmap` | Heatmap data | Performance optimization |
| `/api/tokens/holders` | Token holder analysis | Data source reliability |
| `/api/user/notifications` | User notification prefs | Notification system ready |
| `/api/user/watchlist` | User watchlist management | Feature reintroduction |
| `/api/wallet/[address]` | Wallet profile | Core analysis sufficient |
| `/api/webhooks/*` | Webhook management | Infrastructure ready |

### Removed Libraries (~15 modules)

| Module | Description | Reintroduction Criteria |
|--------|-------------|------------------------|
| `alerts/` | Alert detection and dispatch | Real-time infrastructure |
| `attestation-service.ts` | EAS attestation creation | EAS integration stable |
| `eas-config.ts` | EAS configuration | On-chain features prioritized |
| `eas-graphql.ts` | EAS GraphQL queries | EAS API stable |
| `ethos-reviews.ts` | Ethos review integration | Ethos API v2 ready |
| `fairscale.ts` | FairScale integration | FairScale API stable |
| `memory-protocol.ts` | Memory Protocol identity | Protocol maturity |
| `notifications/` | Multi-channel notifications | User demand + infrastructure |
| `privacy-cash.ts` | Privacy Cash integration | ✅ **Re-added in Phase 4** |
| `watchlist.ts` | Watchlist management | Feature reintroduction |
| `web3bio.ts` | Web3.bio identity | API reliability |

## Active Development

### Phase 5 - Aleo Privacy Integration (PARTIAL)

**Live on Aleo Testnet (v2):**
- [x] Lean Foundation: Audit and consolidate lib modules
- [x] Leo Smart Contract: ZK-proof logic for CI metrics
      ([`early_not_wrong_v2.aleo`](https://testnet.explorer.provable.com/program/early_not_wrong_v2.aleo))
- [x] Shield Wallet: Frontend integration for private verification
- [x] Selective Disclosure: archetype + score + efficiency proofs working
      end-to-end against v2 (the proof dialog had a `record=""` bug that
      blocked this previously; fixed Jun 2026)
- [x] **Treasury Security**: signed-voucher 'Pull' model written, hardened
      with `crypto.randomBytes` nonces + per-process collision detection +
      per-address cooldown on the rebate route

**Written but not deployed yet:**
- [ ] Deploy `early_not_wrong_v3.aleo` to Aleo **Testnet** — v3 adds the
      `claim_rebate` entry point + `used_vouchers` replay-protection
      mapping. The rebate UI is hidden behind `aleo.rebatesEnabled` until
      this deploys; everything downstream (treasury route, voucher
      signing, voucher-claim button) is wired and ready.

### Phase 6 - Mainnet Deployment & Ecosystem Expansion (UPCOMING)
- [ ] Deploy `early_not_wrong_v3.aleo` to Aleo Mainnet (after Testnet v3)
- [ ] Partner with Aleo-based DeFi protocols for undercollateralized lending
- [ ] Anonymous Reputation building for anonymous traders

### Phase 7 - Advanced Identity & Cross-Chain Support (FUTURE)
- [ ] Arbitrum/Optimism support
- [ ] NFT position tracking
- [ ] Private Peer Comparison (Privacy-preserving aggregation)
- [ ] Endorsement Mechanics (ZK-proofs for recommendations)

### Phase 8 - Mantle Agentic Expansion (IN PROGRESS - Phase II Hackathon)
- [x] **ERC-8004 Identity**: Register ENW as a sovereign agent on Mantle
- [ ] **Mantle Conviction Registry**: Port ZK-based conviction logic to Mantle Solidity
- [ ] **RWA Strategy Engine**: Deep support for USDY and mETH behavioral analysis
- [ ] **A2A Communications**: Implement MCP for agent-to-agent tool sharing
- [ ] **Validation Registry**: Anchor conviction proofs to Mantle L2

## Feature Request Process

1. **User Demand**: Collect feedback via Farcaster/Discord
2. **Technical Feasibility**: Assess API stability and infrastructure
3. **Privacy Impact**: Ensure no compromise to core privacy features
4. **Implementation**: Create feature branch and PR
5. **Testing**: Verify no regression in core functionality

## Notes

- **Core Focus**: Conviction analysis + Privacy Mode
- **Philosophy**: Less is more - only add features with clear user value
- **Privacy First**: Any social features must preserve user anonymity options
- **Performance**: Features must not impact core analysis speed