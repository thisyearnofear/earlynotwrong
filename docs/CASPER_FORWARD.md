# Casper Forward — ConvictionRegistry v2

> **From a claims log to the reputation layer for the agent economy.**
> Every claim anchored. Every outcome verified. Every score earned.

This is the holistic upgrade plan for the Casper surface before Mainnet
deployment. It exists because the Casper Forward programme asked the right
question — *how does the Casper community actually leverage this?* — and the
honest answer today is: mostly they can't. The registry is a single-writer
diary of unverified claims. v2 turns it into shared infrastructure.

> **Status (2026-11-14):** contract v2 + agent-side lifecycle implemented and
> tested off-chain (24 OdraVM + 7 vitest); **not deployed** — pending design
> review before a testnet install.

---

## 1. The diagnosis: why v1 is too narrow

Five gaps, each mapping to one axis of the upgrade:

| # | Gap in v1 | Why it limits the story |
|---|-----------|------------------------|
| 1 | **Claims without outcomes** | Anyone can anchor "conviction 90." Nothing ever checks whether the claim was right, so reputation is computed over self-reported scores — a demo, not a trust primitive. |
| 2 | **Single writer** | Only our agent anchors. The contract is permissionless (`anchored_by` is recorded), but there's no identity, registration, or discovery — so there's nothing for *other* agents to build on. |
| 3 | **No economic weight** | Anchoring costs ~nothing, so claims carry no commitment. "Score 90" is as cheap as "score 10." There's no skin in the game and no spam cost. |
| 4 | **Per-record gas economics** | Anchoring every record on Mainnet burns CSPR every cycle, forever. v1 has no batching story — the cost curve scales linearly with usage, which is exactly backwards for infrastructure. |
| 5 | **Invisible to humans** | The registry is readable only via our MCP tools or raw state queries. The community can't *see* it, humans can't participate, and there's no consumer-facing product. |

The unified fix: **ConvictionRegistry v2 — an outcome-verified, multi-agent,
stake-weighted claims registry that is cheap to write and legible to read.**

## 2. The interlock: why all five axes are one feature

These aren't five independent features — they form a closed loop, and each
one is load-bearing:

```
                    ┌──────────────────────────────────────────┐
                    │            REGISTRY LIFECYCLE            │
                    └──────────────────────────────────────────┘

  register_agent ──► anchor_claim ──► time passes ──► resolve_claim
   (Axis 2:           (Axis 3: bond                    (Axis 1: evidence
    identity,          attaches CSPR                    tiers — deterministic,
    discovery)          skin in the game)               optimistic, disputed)
                                                          │
                          ┌───────────────────────────────┘
                          ▼
                  reputation updates          bonds settle
                  (calibration-weighted,      (correct → return + reward;
                   domain-tagged,              wrong → slash to challenger
                   recency-decayed)            or fee pool)
                          │
          ┌───────────────┼───────────────────┐
          ▼               ▼                   ▼
   MCP tools v2     Explorer surface     Merkle-root anchors
   (agents query    (Axis 5: humans      (Axis 4: integrity at
    reputation      browse, compare,     fixed cost regardless
    before paying)  participate)         of record volume)
```

- **Resolution (1) is meaningless without multi-subject (2)** — one agent
  grading itself proves nothing; many agents resolving under the same rules
  is a registry.
- **Bonds (3) are impossible without resolution (1)** — you can't settle
  economic weight on claims that never close.
- **Batching (4) requires the record schema to freeze** — you commit to a
  canonical claim format once, then hash-chain it.
- **The explorer (5) is only worth building if the data underneath is
  meaningful** — which is what axes 1–3 produce.

Cut one and the story degrades: resolution alone is a self-graded homework
log; multi-subject without resolution is a spam directory; bonds without an
explorer are invisible commitment.

---

## 3. Axis 1 — Outcome resolution: reputation from results, not claims

The single biggest upgrade. Today a record asserts; v2 makes records
*resolve*.

### Contract changes

Evolve `anchor_conviction` into a claim lifecycle:

```rust
anchor_claim(subject_hash, claim_hash, claim_type, domain,
             confidence: u8, expires_at: u64, evidence_hash)
resolve_claim(claim_hash, outcome, resolution_hash)
dispute_claim(claim_hash)  // opens challenge window, requires counter-bond
```

- `claim_type`: `price-thesis | attestation | risk-assessment | generic` —
  determines which resolution path applies.
- `outcome`: `Validated | Invalidated | Mixed | Expired` — same enum the RYO
  ledger already uses.
- One-shot resolution, indexed so a claim resolves exactly once (the RYO
  ledger enforces this off-chain today; v2 enforces it in the contract).

### Resolution tiers — matching evidence to claim type

| Tier | Applies to | Mechanism | Existing machinery |
|------|-----------|-----------|-------------------|
| **Deterministic** | Price/market claims | Auto-resolve from market data at `expires_at` (e.g. \|±5%\| band → validated/invalidated/mixed) | `agent/ryo/thesis-resolve.ts` already computes `computedOutcome()` from `price_at_commit` → `price_at_resolve` and flags `contested` |
| **Optimistic** | Claims with checkable evidence | Proposed outcome stands unless disputed within a challenge window (UMA's pattern) | Dispute flag + `contested` field already modeled in the ledger |
| **Attested** | Subjective/complex claims | Named resolver set (initially us + cohort partners; later a juried pool) | Delphi's 4-tier evidence-validation stack (`agent/lib/delphi/verification.ts`, `fact-check.ts`, `evidence-filter.ts`) — archived but purpose-built for this |

### The reputation model

Reputation stops being "count of anchors × mean self-score" and becomes:

```
accuracy(subject, domain)  = Σ(wᵢ · hitᵢ) / Σwᵢ
   where wᵢ = recency_decay(age) · bond_weight(bondᵢ)
calibration(subject)       = 1 − |stated_confidence − empirical_hit_rate|
```

Domain-tagged, recency-decayed, bond-weighted — and every input is a
resolved claim readable from the event log for free. `get_agent_reputation`
returns *earned* numbers an evaluator can trust.

## 4. Axis 2 — Multi-subject: from our diary to shared infrastructure

The contract is already permissionless; what's missing is identity and
discovery.

### Contract changes

```rust
register_agent(subject_hash, name_hash, endpoint_hash, domain_tags)
// subject_hash derived from the registrant's account — one owner per subject
```

Subjects become enumerable via a `AgentRegistered` event + a counter, so the
whole directory is reconstructable from free event-log reads — no paid
entry-point calls. Claims anchor under registered subjects; `anchored_by`
continues to record the actual caller.

### What this unlocks for the cohort

The Casper Forward cohort is almost entirely agent and x402-payment
projects — and every one of them needs "can I verify this counterparty's
track record?" answered. The v2 registry is that answer:

| Cohort project | What they anchor | What they consume |
|---|---|---|
| **Faktura** (AI underwriting) | Underwriting verdicts per invoice | Portfolio-level accuracy of their AI decisions |
| **Claros** (data oracle) | Data attestations | Proof-of-accuracy for buyers of their feeds |
| **ATLAS** (treasury agent) | Risk assessments per DeFi opportunity | Counterparty reputation before buying risk data over x402 |
| **Casper Trust Layer** | — | Our reputation scores as an input to their spending-limit rules |
| **AgentEscrow402** | Settlement/dispute outcomes | Payee reputation when evaluating escrow counterparties |
| **Sluice / CasCet / CSPR402** | Payment-performance records | Provider reliability before streaming/chained payments |
| **Chainleash** (staking agent) | Delegation decisions + outcomes | Validator-quality track record |
| **ARIA / Lastre / LeaseFi** (RWA) | Origin/asset attestations | Attester reputation for RWA provenance |

This is the answer to Casper's question: **every claim, resolution, and
payment outcome in the agent economy writes a reputation line into one
shared, portable registry.** We stop being an app that uses Casper and
become infrastructure the ecosystem builds on.

### MCP surface v2

New/generalized tools (all reads stay free — trust-decision data is the
adoption gateway):

| Tool | Returns |
|---|---|
| `list_agents` | Registered subjects with domain tags + summary stats |
| `get_agent_reputation` v2 | Calibration-weighted accuracy, domain breakdown, bond history — for any subject, not just us |
| `get_claim` / `get_resolution` | Single claim lifecycle with evidence hashes |
| `get_leaderboard` | Top subjects by domain-filtered accuracy |
| `get_subject_history` (paid) | Full claim+resolution walk |
| `score_wallet` (paid, hero SKU) | Unchanged — now also for Casper accounts (Axis 5) |

## 5. Axis 3 — Economic weight: conviction that costs something

A claim you can assert for free carries no information. v2 attaches optional
CSPR bonds — **skin in the game as a protocol primitive**.

### Mechanics

- `anchor_claim` accepts an optional purse transfer; the bond is held by the
  contract against `claim_hash`.
- On **validated** resolution: bond returns (+ optional reward drawn from
  the fee pool).
- On **invalidated**: bond slashes to the challenger who disputed (or the
  fee pool if undisputed).
- On **dispute**: challenger posts a counter-bond ≥ original; loser forfeits
  to winner minus a small protocol fee.
- **Anti-spam floor**: a small flat motes fee per claim even without a bond,
  so the directory can't be flooded at zero cost.

Bond weight feeds the reputation formula directly (Axis 1: `wᵢ` includes
`bond_weight`), so "put CSPR behind your thesis" literally raises the stakes
of the reputation outcome.

### Why this matters for the story

ERC-8004-style registries store assertions — no verification, no stake.
v2 has both. For the Forward conversation, this is the differentiator slide:
**the first reputation registry where reputation is expensive to fake.**

## 6. Axis 4 — Mainnet economics: integrity at fixed cost

Per-record anchoring on Mainnet is an unbounded cost line. v2 splits
anchoring into two tiers:

| Tier | What anchors on-chain | Cost profile |
|---|---|---|
| **Tier 1 — headline** | Registrations, resolutions, disputes, bond events, top-tier thesis shifts (already deduped by `lastAnchoredThesisHash`) | Flat, event-driven |
| **Tier 2 — bulk records** | A periodic **Merkle root / head-hash** committing to N records in a sha256-chained ledger | One deploy per epoch regardless of record count |

We already run this pattern: the RYO ledger (`agent/data/ryo-ledger.jsonl`)
is a sha256 hash-chained JSONL where each entry carries `prevHash`, and
`verifyChain()` (`agent/lib/adapters/ryo-ledger.ts`) proves integrity;
`RYO_ANCHOR` already anchors head-hashes. v2 generalizes this into a shared
batching module: records accumulate off-chain in the verified chain, the
root anchors on a cadence (daily / per-N), and any single record is provable
via inclusion proof or chain walk — the `/ryo/verify` page already
demonstrates this UX.

**Integrity guarantee**: any retroactive edit breaks the chain below the
anchored root. Full availability off-chain, cryptographic certainty
on-chain, gas spend decoupled from volume.

## 7. Axis 5 — Human-legible surface: the community can see it

Infrastructure nobody can see doesn't get adopted. Three surfaces:

### 7a. Registry explorer (`/registry`)

"cspr.live for agent reputation." Public pages — no wallet, no payment:

- Subject directory with domain tags and owner accounts
- Accuracy leaderboards (global + per-domain)
- Claim → resolution timelines with contested flags and bond stakes
- Live feed of anchors, resolutions, disputes

The existing dashboard machinery (agent status cards, anchor panels) ports
directly; the data is all free event-log reads.

### 7b. Human participation

The wallet-connect flow (`casper-wallet-connect.tsx` → `/casper/build-anchor`
→ `provider.sign()` → `/casper/submit-anchor`) already lets a human anchor a
record signing their own gas. Extending it to `anchor_claim` + bonds turns
"agent reputation" into **forecaster reputation** — analysts, KOLs, and
community members putting CSPR behind public calls with a verifiable track
record. This widens the product from agent infrastructure to a community
surface — which is exactly the "how does the community leverage it" answer
the Forward team is probing for.

### 7c. `score_wallet` for Casper accounts

The paid hero SKU (0.5 CSPR via x402) currently scores BSC wallets through
the Helius/Zerion pipeline. Adding Casper chain support — account-age,
delegation history, contract interaction patterns, behavioral archetype —
gives the community a consumer product, not just plumbing, and gives the
registry a native revenue line on its own chain.

---

## 8. Contract v2 — consolidated shape

```rust
// Identity
register_agent(subject_hash, name_hash, endpoint_hash, domain_tags)

// Lifecycle
anchor_claim(subject_hash, claim_hash, claim_type, domain,
             confidence, expires_at, evidence_hash, bond?)
resolve_claim(claim_hash, outcome, resolution_hash)
dispute_claim(claim_hash)              // counter-bond required
finalize_resolution(claim_hash)        // settles bonds after window

// Epoch anchoring
anchor_epoch_root(epoch_id, merkle_root, record_count)

// Reads (all free via entry-point views + CES events)
get_agent(subject_hash)
get_claim(claim_hash)
get_subject_history(subject_hash)
get_epoch_root(epoch_id)
```

Events: `AgentRegistered`, `ClaimAnchored`, `ClaimResolved`,
`ClaimDisputed`, `BondSettled`, `EpochAnchored` — the entire directory,
reputation model, and explorer are reconstructible from the event log at
zero gas.

## 9. Phased plan to Mainnet

| Phase | Deliverable | Depends on |
|---|---|---|
| **0 — Spec** | This document; schema freeze; resolver trust model decision | — |
| **1 — Contract v2** ✅ | Odra implementation + on-chain tests (24 passing via `cargo test` / OdraVM): registration, claim lifecycle, bonds, dispute windows, epoch roots. `casper/src/conviction_registry.rs` | Phase 0 |
| **2 — Agent migration** ✅ | `CasperAnchorAdapter` v2 surface (`v2AnchorClaim`/`v2ResolveClaim`/`v2FinalizeResolution`/`v2AnchorEpochRoot`/`v2RegisterAgent` in `agent/lib/anchors/casper.ts`, incl. the proxy-wasm payable path), deterministic resolver + pending-claim index (`agent/lib/anchors/casper-v2.ts`), epoch batching module extracted from the RYO ledger pattern (`agent/lib/anchors/epoch-ledger.ts`, vitest: 7/7), wired into `anchorToMantle` behind `CASPER_REGISTRY_V2_HASH` | Phase 1 |
| **3 — Surfaces** | `/registry` explorer, MCP v2 tools, wallet-connect claim/bond flow, Casper-account `score_wallet` | Phase 1–2 |
| **4 — Cohort pilot** | 2–3 cohort integrations (Trust Layer reputation feed; Faktura/Claros anchoring pilot) — the Forward programme's own cohort is the launch distribution | Phase 2 |
| **5 — Audit → Mainnet** | Security audit via Forward's audit-prep support, operator funding, mainnet deploy | Phase 1–4 |

## 10. What the Casper community gets — the leverage answer

| Component | Community leverage |
|---|---|
| Multi-subject registry + identity | Any agent/cohort project gets a portable, verifiable track record — no own-registry needed |
| Outcome resolution | Agents can verify counterparty claims *resolved correctly*, not merely asserted — the missing primitive for x402 commerce trust |
| Bonded claims | Economic commitment primitive any protocol can read (Trust Layer gates payments on it; escrows check bond history) |
| Free event-log reads | Reputation queries cost nothing — the public-good layer under paid commerce |
| Epoch-root anchoring | A reproducible integrity pattern (hash-chained ledger → periodic root) other builders can copy |
| Explorer + human claims | Community members see and join the reputation graph — analysts, validators, agents on one leaderboard |
| `score_wallet` on Casper | A paid consumer product the community uses today |
| MCP v2 | Standard tool surface — every Casper agent queries reputation through the same protocol the ecosystem already adopted |

## 11. Known integration details (verified against Odra 2.8 / casper-types 6.1)

1. **Payable calls need the proxy-wasm pattern.** On VM-Casper-v1 there is no
   `transferred_value` field (that's VmCasperV2-only). Odra payable entry
   points take a hidden `cargo_purse: URef` arg — the caller supplies a purse
   already holding the motes. An account can't create a purse outside session
   execution, so attached-value calls are submitted as a **session wasm
   deploy** running Odra's `proxy_caller_with_return.wasm` with args
   `package_hash`, `entry_point`, `args` (bytesrepr RuntimeArgs),
   `attached_value`, `amount`. The adapter must ship that wasm (~40 KB) and
   switch `ContractCallBuilder` → session deploy for `anchor_claim` and
   `dispute_claim`. Plain `ContractCallBuilder` still works for every
   non-payable entry point.
2. **Claim fee = 0 is a supported config.** `init` sets `claim_fee` to 1 CSPR
   but `set_config` can zero it — useful on testnet so unbonded
   `anchor_claim` calls need no proxy wasm at all. Mainnet should keep a
   nonzero fee (anti-spam) and accept the proxy-wasm cost.
3. **`#[should_panic(expected=...)]` can't see assert messages** through the
   OdraVM host-ref wrapper — panics surface as `VmError(Panic)`. Tests use
   bare `should_panic` (v1 convention).
4. **cargo-odra is not installed on this machine.** `cargo test` covers
   OdraVM tests, but wasm builds (`cargo odra build -b casper`) and deploys
   need `cargo install cargo-odra` on the deploy box (the VPS already has the
   toolchain per the June deploy).

## 12. Open questions to resolve in Phase 0

1. **Resolver trust model** — who attests non-deterministic outcomes?
   Proposal: deterministic tier live at launch; optimistic resolution with
   bonds second; attested resolver set (us + cohort partners) third, governed
   later.
2. **Cross-chain parity** — does Mantle keep mirror symmetry with a reduced
   schema, or does Casper become the canonical registry with Mantle as a
   pointer? Lean: Casper canonical, Mantle anchors epoch roots + headline
   claims only.
3. **Bond economics** — minimum bond, slash destination (challenger vs.
   pool vs. burn), dispute window length. Needs a parameter pass before
   audit.
4. **Subject ↔ human identity** — optional CSPR.name linkage so leaderboard
   entries are legible.

## 12. The one-line pitch

> **v1 proved an agent can write to Casper. v2 makes Casper the place every
> agent's word is tested — and every agent's worth is earned.**

---

*Related docs: [`CASPER_INTEGRATION.md`](./CASPER_INTEGRATION.md) (v1),
[`archive/CASPER_SUBMISSION.md`](./archive/CASPER_SUBMISSION.md) (buildathon
entry), [`MANTLE_INTEGRATION.md`](./MANTLE_INTEGRATION.md) (parallel chain),
[`AGENT_DESIGN.md`](./AGENT_DESIGN.md).*
