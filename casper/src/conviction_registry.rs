//! Casper ConvictionRegistry v2 — outcome-verified reputation layer on Casper.
//!
//! v1 anchored self-reported conviction records. v2 adds the full claim
//! lifecycle (register → anchor claim → resolve → dispute → finalize) with
//! optional CSPR bonds, so reputation is computed from verified outcomes —
//! not asserted scores. See docs/CASPER_FORWARD.md for the rationale.
//!
//! ## What's new in v2
//!
//! - `register_agent` — subject identity (owner, name, endpoint, domain tags).
//! - `anchor_claim` — payable claim anchoring: a flat anti-spam fee plus an
//!   optional bond held by the contract against the claim hash.
//! - `resolve_claim` — proposed outcome + dispute window (optimistic pattern).
//! - `dispute_claim` — counter-bonded challenge during the window.
//! - `rule_dispute` — arbiter adjudication; winner takes both bonds.
//! - `finalize_resolution` — settles bonds after an undisputed window.
//! - `anchor_epoch_root` — Merkle root anchoring for the hash-chained
//!   off-chain record ledger (fixed-cost integrity at scale).
//!
//! ## v1 compatibility
//!
//! `anchor_conviction` / `get_subject_history` / `get_latest_conviction` /
//! `get_by_thesis` are retained verbatim: the deployed surface keeps working
//! while consumers migrate to claims. The `ConvictionAnchored` event shape is
//! unchanged so the free CES event-log read path keeps working.

use odra::prelude::*;
use odra::casper_types::bytesrepr::Bytes;
use odra::casper_types::U512;

// =============================================================================
// Constants — claim types, outcomes, protocol params
// =============================================================================

/// Generic claim — no deterministic resolution path; resolved optimistically.
pub const CLAIM_TYPE_GENERIC: u8 = 0;
/// Price/market thesis — resolvable deterministically from price movement.
pub const CLAIM_TYPE_PRICE_THESIS: u8 = 1;
/// Data attestation (oracle output, RWA fact, etc.).
pub const CLAIM_TYPE_ATTESTATION: u8 = 2;
/// Risk assessment (underwriting, counterparty scoring, etc.).
pub const CLAIM_TYPE_RISK_ASSESSMENT: u8 = 3;
/// Highest valid claim type value.
pub const CLAIM_TYPE_MAX: u8 = CLAIM_TYPE_RISK_ASSESSMENT;

/// Claim has been anchored but no outcome proposed yet.
pub const OUTCOME_UNRESOLVED: u8 = 0;
pub const OUTCOME_VALIDATED: u8 = 1;
pub const OUTCOME_INVALIDATED: u8 = 2;
/// Partially correct — counts as a loss for bond settlement.
pub const OUTCOME_MIXED: u8 = 3;
/// Horizon passed with no verifiable outcome — counts as a loss.
pub const OUTCOME_EXPIRED: u8 = 4;
/// Highest valid outcome value (0 is the "pending" sentinel, not a resolution).
pub const OUTCOME_MAX: u8 = OUTCOME_EXPIRED;

/// Default per-claim anti-spam fee: 1 CSPR (1e9 motes).
pub const DEFAULT_CLAIM_FEE_MOTES: u64 = 1_000_000_000;
/// Default optimistic-resolution dispute window: 24h in milliseconds.
pub const DEFAULT_DISPUTE_WINDOW_MS: u64 = 86_400_000;
/// Minimum counter-bond when disputing an unbonded claim: 1 CSPR.
/// If the claim carries a bond, the counter-bond must match or exceed it.
pub const MIN_DISPUTE_BOND_MOTES: u64 = 1_000_000_000;

// =============================================================================
// Types
// =============================================================================

/// A single conviction analysis record (v1 schema — retained for compat).
///
/// `subject_hash` and `thesis_hash` are 32-byte keccak256 digests produced by
/// the agent's pure hashing helpers — identical scheme to the Mantle contract,
/// so the same hash refers to the same subject on either chain.
#[odra::odra_type]
pub struct ConvictionRecord {
    pub subject_hash: Bytes,    // 32 bytes
    pub anchored_by: Address,   // The agent operator that submitted this
    pub thesis_hash: Bytes,     // 32 bytes — keccak256 of canonical analysis JSON
    pub conviction_score: u8,   // 0-100 (clamped; Solidity uses uint256, Casper u8 is sufficient)
    pub archetype: String,      // e.g. "DEEP FEAR — PRIME CONTRARIAN"
    pub timestamp: u64,         // ms since epoch — set by caller, not block time
    pub verified: bool,         // For future validation-registry integration
}

/// A registered agent/subject identity. `owner` controls the registration;
/// `subject_hash` is the same 32-byte digest used on claims and v1 records.
#[odra::odra_type]
pub struct AgentInfo {
    pub owner: Address,
    pub name: String,
    pub endpoint: String,
    pub domain_tags: String,   // comma-separated, e.g. "defi,oracle,rwa"
    pub registered_at: u64,    // ms since epoch (block time)
}

/// A claim under the v2 lifecycle. `outcome == OUTCOME_UNRESOLVED` means
/// pending; a proposed outcome sits in the dispute window until finalized.
#[odra::odra_type]
pub struct Claim {
    pub subject_hash: Bytes,
    pub claim_hash: Bytes,
    pub anchored_by: Address,
    pub claim_type: u8,
    pub domain: String,
    pub confidence: u8,          // 0-100 stated confidence
    pub expires_at: u64,         // ms since epoch; 0 = no horizon
    pub evidence_hash: Bytes,    // 32 bytes — digest of supporting evidence
    pub timestamp: u64,          // ms since epoch — set by caller
    pub bond: U512,              // motes bonded (attached_value minus fee)
    // ── Resolution state ──
    pub outcome: u8,             // OUTCOME_*; 0 while pending
    pub resolution_hash: Option<Bytes>,
    pub proposed_by: Option<Address>, // who proposed the outcome (self-resolve visible)
    pub proposed_at: u64,        // ms — dispute window anchor
    pub contested: bool,
    pub challenger: Option<Address>,
    pub challenger_bond: U512,
    pub finalized: bool,
}

/// A Merkle root committing to an epoch of off-chain ledger records.
#[odra::odra_type]
pub struct EpochRoot {
    pub epoch_id: u64,
    pub merkle_root: Bytes,      // 32 bytes
    pub record_count: u64,
    pub anchored_by: Address,
    pub timestamp: u64,
}

// =============================================================================
// Events — the entire registry state is reconstructible from CES events
// =============================================================================

/// v1 event — unchanged shape so the existing free read path keeps working.
#[odra::event]
pub struct ConvictionAnchored {
    pub subject_hash: Bytes,
    pub anchored_by: Address,
    pub thesis_hash: Bytes,
    pub conviction_score: u8,
    pub archetype: String,
}

#[odra::event]
pub struct AgentRegistered {
    pub subject_hash: Bytes,
    pub owner: Address,
    pub name: String,
}

#[odra::event]
pub struct ClaimAnchored {
    pub subject_hash: Bytes,
    pub claim_hash: Bytes,
    pub anchored_by: Address,
    pub claim_type: u8,
    pub domain: String,
    pub confidence: u8,
    pub bond: U512,
}

#[odra::event]
pub struct ClaimResolved {
    pub claim_hash: Bytes,
    pub outcome: u8,
    pub proposed_by: Address,
    pub resolution_hash: Bytes,
}

#[odra::event]
pub struct ClaimDisputed {
    pub claim_hash: Bytes,
    pub challenger: Address,
    pub counter_bond: U512,
}

#[odra::event]
pub struct DisputeRuled {
    pub claim_hash: Bytes,
    pub final_outcome: u8,
    pub winner: Address,
}

#[odra::event]
pub struct ResolutionFinalized {
    pub claim_hash: Bytes,
    pub outcome: u8,
}

#[odra::event]
pub struct EpochAnchored {
    pub epoch_id: u64,
    pub merkle_root: Bytes,
    pub record_count: u64,
    pub anchored_by: Address,
}

// =============================================================================
// Contract
// =============================================================================

#[odra::module(events = [
    ConvictionAnchored, AgentRegistered, ClaimAnchored, ClaimResolved,
    ClaimDisputed, DisputeRuled, ResolutionFinalized, EpochAnchored,
])]
pub struct ConvictionRegistry {
    // ── v1 storage (retained) ──
    subject_history: Mapping<Bytes, Vec<ConvictionRecord>>,
    by_thesis: Mapping<Bytes, ConvictionRecord>,
    // ── v2 storage ──
    agents: Mapping<Bytes, AgentInfo>,
    agent_count: Var<u64>,
    claims: Mapping<Bytes, Claim>,
    subject_claims: Mapping<Bytes, Vec<Bytes>>, // subject → claim hashes
    claim_count: Var<u64>,
    epochs: Mapping<u64, EpochRoot>,
    epoch_count: Var<u64>,
    // ── Protocol params / admin ──
    claim_fee: Var<U512>,        // flat motes fee per claim
    dispute_window_ms: Var<u64>,
    arbiter: Var<Address>,       // dispute adjudicator (deployer initially)
    fee_pool: Var<U512>,         // accumulated fees + slashed bonds
}

#[odra::module]
impl ConvictionRegistry {
    /// No-arg init matching v1's deploy shape: deployer becomes arbiter,
    /// default fee + dispute window applied.
    pub fn init(&mut self) {
        self.arbiter.set(self.env().caller());
        self.claim_fee.set(U512::from(DEFAULT_CLAIM_FEE_MOTES));
        self.dispute_window_ms.set(DEFAULT_DISPUTE_WINDOW_MS);
        self.fee_pool.set(U512::zero());
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    /// Transfer dispute-arbitration rights. Arbiter-only.
    pub fn set_arbiter(&mut self, new_arbiter: Address) {
        self.require_arbiter();
        self.arbiter.set(new_arbiter);
    }

    /// Update protocol params. Arbiter-only.
    pub fn set_config(&mut self, claim_fee: U512, dispute_window_ms: u64) {
        self.require_arbiter();
        self.claim_fee.set(claim_fee);
        self.dispute_window_ms.set(dispute_window_ms);
    }

    /// Withdraw accumulated fees + slashed bonds. Arbiter-only.
    pub fn withdraw_fees(&mut self) {
        self.require_arbiter();
        let pool = self.fee_pool.get().unwrap_or_default();
        assert!(!pool.is_zero(), "fee pool is empty");
        self.fee_pool.set(U512::zero());
        self.env().transfer_tokens(&self.env().caller(), &pool);
    }

    // ── Agent registration (Axis 2) ─────────────────────────────────────────

    /// Register (or update, if caller is the owner) an agent identity for a
    /// subject hash. Registration is the identity + discovery layer — claims
    /// themselves don't require it, but the directory and reputation surface
    /// index registered subjects.
    pub fn register_agent(
        &mut self,
        subject_hash: Bytes,
        name: String,
        endpoint: String,
        domain_tags: String,
    ) {
        let caller = self.env().caller();
        match self.agents.get(&subject_hash) {
            Some(existing) => {
                assert!(existing.owner == caller, "subject owned by another account");
                self.agents.set(&subject_hash, AgentInfo {
                    owner: caller,
                    name: name.clone(),
                    endpoint,
                    domain_tags,
                    registered_at: existing.registered_at,
                });
            }
            None => {
                self.agents.set(&subject_hash, AgentInfo {
                    owner: caller,
                    name: name.clone(),
                    endpoint,
                    domain_tags,
                    registered_at: self.env().get_block_time(),
                });
                self.agent_count.add(1);
            }
        }
        self.env().emit_event(AgentRegistered { subject_hash, owner: caller, name });
    }

    // ── Claims (Axes 1 + 3) ─────────────────────────────────────────────────

    /// Anchor a claim. Payable: attached value splits into the flat claim fee
    /// (→ fee pool, anti-spam) and the remainder as the claim's bond held by
    /// the contract until resolution settles it.
    ///
    /// To anchor unbonded, attach exactly `claim_fee`. To bond, attach
    /// `claim_fee + bond`.
    #[odra(payable)]
    pub fn anchor_claim(
        &mut self,
        subject_hash: Bytes,
        claim_hash: Bytes,
        claim_type: u8,
        domain: String,
        confidence: u8,
        expires_at: u64,
        evidence_hash: Bytes,
        timestamp: u64,
    ) {
        let caller = self.env().caller();
        assert!(confidence <= 100, "confidence must be 0-100");
        assert!(claim_type <= CLAIM_TYPE_MAX, "unknown claim type");
        assert!(self.claims.get(&claim_hash).is_none(), "claim hash already anchored");

        let attached = self.env().attached_value();
        let fee = self.claim_fee.get().unwrap_or_default();
        assert!(attached >= fee, "attached value below claim fee");
        let bond = attached - fee;
        self.fee_pool.set(self.fee_pool.get().unwrap_or_default() + fee);

        let claim = Claim {
            subject_hash: subject_hash.clone(),
            claim_hash: claim_hash.clone(),
            anchored_by: caller,
            claim_type,
            domain: domain.clone(),
            confidence,
            expires_at,
            evidence_hash,
            timestamp,
            bond,
            outcome: OUTCOME_UNRESOLVED,
            resolution_hash: None,
            proposed_by: None,
            proposed_at: 0,
            contested: false,
            challenger: None,
            challenger_bond: U512::zero(),
            finalized: false,
        };

        let mut hashes = self.subject_claims.get(&subject_hash).unwrap_or_default();
        hashes.push(claim_hash.clone());
        self.subject_claims.set(&subject_hash, hashes);
        self.claims.set(&claim_hash, claim);
        self.claim_count.add(1);

        self.env().emit_event(ClaimAnchored {
            subject_hash,
            claim_hash,
            anchored_by: caller,
            claim_type,
            domain,
            confidence,
            bond,
        });
    }

    /// Propose an outcome for a pending claim. Open to anyone — the dispute
    /// window, not the caller list, is the trust mechanism. `proposed_by` is
    /// recorded so consumers can discount self-resolutions.
    ///
    /// `OUTCOME_EXPIRED` additionally requires `expires_at` to have passed.
    pub fn resolve_claim(&mut self, claim_hash: Bytes, outcome: u8, resolution_hash: Bytes) {
        let caller = self.env().caller();
        let mut claim = self.expect_claim(&claim_hash);
        assert!(claim.outcome == OUTCOME_UNRESOLVED, "claim already resolved");
        assert!(outcome >= OUTCOME_VALIDATED && outcome <= OUTCOME_MAX, "invalid outcome");

        let now = self.env().get_block_time();
        if outcome == OUTCOME_EXPIRED {
            assert!(claim.expires_at > 0 && now >= claim.expires_at, "claim has not expired");
        }

        claim.outcome = outcome;
        claim.resolution_hash = Some(resolution_hash.clone());
        claim.proposed_by = Some(caller);
        claim.proposed_at = now;
        self.claims.set(&claim_hash, claim);

        self.env().emit_event(ClaimResolved { claim_hash, outcome, proposed_by: caller, resolution_hash });
    }

    /// Challenge a proposed outcome within the dispute window. Payable —
    /// the counter-bond must cover `max(claim.bond, MIN_DISPUTE_BOND)` so
    /// challenging unbonded claims still costs something.
    #[odra(payable)]
    pub fn dispute_claim(&mut self, claim_hash: Bytes) {
        let caller = self.env().caller();
        let mut claim = self.expect_claim(&claim_hash);
        assert!(claim.outcome != OUTCOME_UNRESOLVED, "nothing to dispute — claim unresolved");
        assert!(!claim.finalized, "claim already finalized");
        assert!(!claim.contested, "claim already disputed");
        let window = self.dispute_window_ms.get().unwrap_or_default();
        assert!(
            self.env().get_block_time() < claim.proposed_at + window,
            "dispute window closed — finalize instead"
        );

        let required = if claim.bond > U512::from(MIN_DISPUTE_BOND_MOTES) {
            claim.bond
        } else {
            U512::from(MIN_DISPUTE_BOND_MOTES)
        };
        let attached = self.env().attached_value();
        assert!(attached >= required, "counter-bond below required amount");

        claim.contested = true;
        claim.challenger = Some(caller);
        claim.challenger_bond = attached;
        self.claims.set(&claim_hash, claim);

        self.env().emit_event(ClaimDisputed { claim_hash, challenger: caller, counter_bond: attached });
    }

    /// Settle a claim whose dispute window closed uncontested. Callable by
    /// anyone. Validated → bond returns to the claimant; everything else →
    /// bond to the fee pool.
    pub fn finalize_resolution(&mut self, claim_hash: Bytes) {
        let mut claim = self.expect_claim(&claim_hash);
        assert!(claim.outcome != OUTCOME_UNRESOLVED, "claim unresolved");
        assert!(!claim.finalized, "claim already finalized");
        assert!(!claim.contested, "disputed claim — arbiter must rule");
        let window = self.dispute_window_ms.get().unwrap_or_default();
        assert!(
            self.env().get_block_time() >= claim.proposed_at + window,
            "dispute window still open"
        );

        claim.finalized = true;
        let outcome = claim.outcome;
        if outcome == OUTCOME_VALIDATED && claim.bond > U512::zero() {
            let amount = claim.bond;
            let to = claim.anchored_by;
            self.claims.set(&claim_hash, claim);
            self.env().transfer_tokens(&to, &amount);
        } else if claim.bond > U512::zero() {
            self.fee_pool.set(self.fee_pool.get().unwrap_or_default() + claim.bond);
            self.claims.set(&claim_hash, claim);
        } else {
            self.claims.set(&claim_hash, claim);
        }

        self.env().emit_event(ResolutionFinalized { claim_hash, outcome });
    }

    /// Arbiter ruling on a disputed claim. The winner takes both bonds —
    /// claimant wins if the final outcome equals the proposed one.
    pub fn rule_dispute(&mut self, claim_hash: Bytes, final_outcome: u8) {
        self.require_arbiter();
        assert!(final_outcome >= OUTCOME_VALIDATED && final_outcome <= OUTCOME_MAX, "invalid outcome");
        let mut claim = self.expect_claim(&claim_hash);
        assert!(claim.contested, "claim not disputed");
        assert!(!claim.finalized, "claim already finalized");

        let claimant_wins = final_outcome == claim.outcome;
        let winner = if claimant_wins {
            claim.anchored_by
        } else {
            claim.challenger.expect("disputed claim has a challenger")
        };
        let pot = claim.bond + claim.challenger_bond;
        claim.outcome = final_outcome;
        claim.finalized = true;
        self.claims.set(&claim_hash, claim);

        if pot > U512::zero() {
            self.env().transfer_tokens(&winner, &pot);
        }
        self.env().emit_event(DisputeRuled { claim_hash, final_outcome, winner });
    }

    // ── Epoch roots (Axis 4) ────────────────────────────────────────────────

    /// Anchor a Merkle root committing to `record_count` off-chain ledger
    /// records for an epoch. Permissionless (the root is self-certifying —
    /// `anchored_by` is recorded for attribution), immutable: one epoch id,
    /// one root.
    pub fn anchor_epoch_root(&mut self, epoch_id: u64, merkle_root: Bytes, record_count: u64) {
        let caller = self.env().caller();
        assert!(self.epochs.get(&epoch_id).is_none(), "epoch already anchored");

        self.epochs.set(&epoch_id, EpochRoot {
            epoch_id,
            merkle_root: merkle_root.clone(),
            record_count,
            anchored_by: caller,
            timestamp: self.env().get_block_time(),
        });
        self.epoch_count.add(1);

        self.env().emit_event(EpochAnchored { epoch_id, merkle_root, record_count, anchored_by: caller });
    }

    // ── v1 entry points (compat) ────────────────────────────────────────────

    /// Anchor a new conviction record (v1 schema — retained verbatim).
    ///
    /// Open to any caller — submissions carry the caller as `anchored_by`,
    /// so every record is on-chain-attributed without a separate allow-list.
    pub fn anchor_conviction(
        &mut self,
        subject_hash: Bytes,
        thesis_hash: Bytes,
        conviction_score: u8,
        archetype: String,
        timestamp: u64,
    ) {
        let caller = self.env().caller();
        assert!(conviction_score <= 100, "score must be 0-100");

        let record = ConvictionRecord {
            subject_hash: subject_hash.clone(),
            anchored_by: caller,
            thesis_hash: thesis_hash.clone(),
            conviction_score,
            archetype: archetype.clone(),
            timestamp,
            verified: false,
        };

        let mut history = self.subject_history.get(&subject_hash).unwrap_or_default();
        history.push(record.clone());
        self.subject_history.set(&subject_hash, history);

        self.by_thesis.set(&thesis_hash, record);

        self.env().emit_event(ConvictionAnchored {
            subject_hash,
            anchored_by: caller,
            thesis_hash,
            conviction_score,
            archetype,
        });
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    /// Read the full anchored v1 history for a subject (chronological).
    pub fn get_subject_history(&self, subject_hash: Bytes) -> Vec<ConvictionRecord> {
        self.subject_history.get(&subject_hash).unwrap_or_default()
    }

    /// Read the most recent v1 record for a subject, if any.
    pub fn get_latest_conviction(&self, subject_hash: Bytes) -> Option<ConvictionRecord> {
        self.subject_history.get(&subject_hash).and_then(|v| v.last().cloned())
    }

    /// Read a v1 record by its thesis hash.
    pub fn get_by_thesis(&self, thesis_hash: Bytes) -> Option<ConvictionRecord> {
        self.by_thesis.get(&thesis_hash)
    }

    /// Look up a registered agent.
    pub fn get_agent(&self, subject_hash: Bytes) -> Option<AgentInfo> {
        self.agents.get(&subject_hash)
    }

    /// Look up a claim by hash.
    pub fn get_claim(&self, claim_hash: Bytes) -> Option<Claim> {
        self.claims.get(&claim_hash)
    }

    /// All claim hashes anchored under a subject, chronological.
    pub fn get_subject_claims(&self, subject_hash: Bytes) -> Vec<Bytes> {
        self.subject_claims.get(&subject_hash).unwrap_or_default()
    }

    /// Look up an epoch root by id.
    pub fn get_epoch_root(&self, epoch_id: u64) -> Option<EpochRoot> {
        self.epochs.get(&epoch_id)
    }

    /// (agents, claims, epochs) counters for directory surfaces.
    pub fn get_counts(&self) -> (u64, u64, u64) {
        (
            self.agent_count.get().unwrap_or_default(),
            self.claim_count.get().unwrap_or_default(),
            self.epoch_count.get().unwrap_or_default(),
        )
    }

    pub fn get_claim_fee(&self) -> U512 {
        self.claim_fee.get().unwrap_or_default()
    }

    pub fn get_dispute_window(&self) -> u64 {
        self.dispute_window_ms.get().unwrap_or_default()
    }

    pub fn get_arbiter(&self) -> Address {
        self.arbiter.get().expect("arbiter unset")
    }

    pub fn get_fee_pool(&self) -> U512 {
        self.fee_pool.get().unwrap_or_default()
    }

    // ── Internal ────────────────────────────────────────────────────────────

    fn require_arbiter(&self) {
        let arbiter = self.arbiter.get().expect("arbiter unset");
        assert!(self.env().caller() == arbiter, "caller is not the arbiter");
    }

    fn expect_claim(&self, claim_hash: &Bytes) -> Claim {
        self.claims.get(claim_hash).expect("unknown claim hash")
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostRef, NoArgs};

    fn b32(seed: u8) -> Bytes {
        Bytes::from(vec![seed; 32])
    }

    const ONE_CSPR: u64 = 1_000_000_000;
    const DAY_MS: u64 = 86_400_000;

    // ── v1 compat ────────────────────────────────────────────────────────────

    #[test]
    fn init_sets_defaults_and_arbiter() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        assert_eq!(registry.get_claim_fee(), U512::from(ONE_CSPR));
        assert_eq!(registry.get_dispute_window(), DAY_MS);
        // Deployer is arbiter
        assert_eq!(registry.get_arbiter(), env.get_account(0));
    }

    #[test]
    fn anchor_conviction_read_back() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        let subject = b32(0xAA);
        let thesis = b32(0xBB);
        registry.anchor_conviction(
            subject.clone(),
            thesis.clone(),
            85,
            "DEEP FEAR - PRIME CONTRARIAN".to_string(),
            1_782_408_000_000,
        );

        let latest = registry.get_latest_conviction(subject.clone()).unwrap();
        assert_eq!(latest.conviction_score, 85);
        assert_eq!(latest.timestamp, 1_782_408_000_000);
        assert_eq!(registry.get_by_thesis(thesis).unwrap().subject_hash, subject);
    }

    #[test]
    fn v1_history_accumulates() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        let subject = b32(0xAA);
        for i in 0..3u8 {
            registry.anchor_conviction(subject.clone(), b32(i), 50 + i, format!("regime-{i}"), i as u64);
        }
        let history = registry.get_subject_history(subject);
        assert_eq!(history.len(), 3);
        assert_eq!(history[2].conviction_score, 52);
    }

    #[test]
    #[should_panic]
    fn v1_rejects_out_of_range_score() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        registry.anchor_conviction(b32(0), b32(0), 101, "x".to_string(), 0);
    }

    // ── Registration ──────────────────────────────────────────────────────────

    #[test]
    fn register_agent_stores_identity_and_counts() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        let subject = b32(0xA1);

        registry.register_agent(
            subject.clone(),
            "earlynotwrong".to_string(),
            "https://earlynotwrong.vercel.app".to_string(),
            "defi,signals".to_string(),
        );

        let agent = registry.get_agent(subject).unwrap();
        assert_eq!(agent.name, "earlynotwrong");
        assert_eq!(agent.owner, env.get_account(0));
        assert_eq!(registry.get_counts(), (1, 0, 0));
        assert!(env.emitted(&registry, "AgentRegistered"));
    }

    #[test]
    fn owner_can_update_registration() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        let subject = b32(0xA1);
        registry.register_agent(subject.clone(), "v1".to_string(), "ep1".to_string(), "defi".to_string());
        registry.register_agent(subject.clone(), "v2".to_string(), "ep2".to_string(), "defi,rwa".to_string());
        let agent = registry.get_agent(subject).unwrap();
        assert_eq!(agent.name, "v2");
        assert_eq!(registry.get_counts(), (1, 0, 0)); // update doesn't double-count
    }

    #[test]
    #[should_panic]
    fn non_owner_cannot_update_registration() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        let subject = b32(0xA1);
        registry.register_agent(subject.clone(), "mine".to_string(), "ep".to_string(), "".to_string());
        env.set_caller(env.get_account(1));
        registry.register_agent(subject, "theirs".to_string(), "ep".to_string(), "".to_string());
    }

    // ── Claims + bonds ────────────────────────────────────────────────────────

    #[test]
    fn anchor_claim_splits_fee_and_bond() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        let subject = b32(0xA1);
        let claim = b32(0xC1);
        let bond = U512::from(5 * ONE_CSPR);
        let attached = U512::from(ONE_CSPR) + bond; // fee + bond

        registry.with_tokens(attached).anchor_claim(
            subject.clone(),
            claim.clone(),
            CLAIM_TYPE_PRICE_THESIS,
            "defi".to_string(),
            80,
            0,
            b32(0xE1),
            1_000,
        );

        let c = registry.get_claim(claim.clone()).unwrap();
        assert_eq!(c.bond, bond);
        assert_eq!(c.confidence, 80);
        assert_eq!(c.outcome, OUTCOME_UNRESOLVED);
        assert_eq!(registry.get_fee_pool(), U512::from(ONE_CSPR));
        assert_eq!(registry.get_subject_claims(subject), vec![claim]);
        assert_eq!(registry.get_counts(), (0, 1, 0));
        assert!(env.emitted(&registry, "ClaimAnchored"));
    }

    #[test]
    #[should_panic]
    fn anchor_claim_without_fee_reverts() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        registry.anchor_claim(b32(0xA1), b32(0xC1), 0, "d".to_string(), 50, 0, b32(0), 0);
    }

    #[test]
    #[should_panic]
    fn duplicate_claim_hash_reverts() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        let attached = U512::from(ONE_CSPR);
        registry.with_tokens(attached).anchor_claim(b32(0xA1), b32(0xC1), 0, "d".to_string(), 50, 0, b32(0), 0);
        registry.with_tokens(attached).anchor_claim(b32(0xA1), b32(0xC1), 0, "d".to_string(), 50, 0, b32(0), 0);
    }

    // ── Resolution lifecycle ──────────────────────────────────────────────────

    fn setup_claim(env: &odra::host::HostEnv, bond_cspr: u64) -> (ConvictionRegistryHostRef, Bytes) {
        let mut registry = ConvictionRegistry::deploy(env, NoArgs);
        let claim = b32(0xC1);
        let attached = U512::from(ONE_CSPR + bond_cspr * ONE_CSPR);
        registry.with_tokens(attached).anchor_claim(
            b32(0xA1), claim.clone(), CLAIM_TYPE_PRICE_THESIS,
            "defi".to_string(), 80, 0, b32(0xE1), 1_000,
        );
        (registry, claim)
    }

    #[test]
    fn resolve_then_finalize_returns_bond_on_validated() {
        let env = odra_test::env();
        let bond_cspr = 5u64;
        let (mut registry, claim) = setup_claim(&env, bond_cspr);
        let claimant = env.get_account(0);
        let bal_before = env.balance_of(&claimant);

        registry.resolve_claim(claim.clone(), OUTCOME_VALIDATED, b32(0xF1));
        env.advance_block_time(DAY_MS + 1);
        registry.finalize_resolution(claim.clone());

        let c = registry.get_claim(claim).unwrap();
        assert!(c.finalized);
        assert_eq!(c.outcome, OUTCOME_VALIDATED);
        // Bond returned to claimant (fees were already deducted at anchor).
        assert_eq!(env.balance_of(&claimant), bal_before + U512::from(bond_cspr * ONE_CSPR));
        assert!(env.emitted(&registry, "ResolutionFinalized"));
    }

    #[test]
    fn finalize_slashes_bond_on_invalidated() {
        let env = odra_test::env();
        let bond_cspr = 3u64;
        let (mut registry, claim) = setup_claim(&env, bond_cspr);

        registry.resolve_claim(claim.clone(), OUTCOME_INVALIDATED, b32(0xF1));
        env.advance_block_time(DAY_MS + 1);
        registry.finalize_resolution(claim);

        // fee pool = claim fee + slashed bond
        assert_eq!(registry.get_fee_pool(), U512::from(ONE_CSPR + bond_cspr * ONE_CSPR));
    }

    #[test]
    #[should_panic]
    fn finalize_blocked_during_window() {
        let env = odra_test::env();
        let (mut registry, claim) = setup_claim(&env, 1);
        registry.resolve_claim(claim.clone(), OUTCOME_VALIDATED, b32(0xF1));
        registry.finalize_resolution(claim);
    }

    #[test]
    #[should_panic]
    fn double_resolution_reverts() {
        let env = odra_test::env();
        let (mut registry, claim) = setup_claim(&env, 1);
        registry.resolve_claim(claim.clone(), OUTCOME_VALIDATED, b32(0xF1));
        registry.resolve_claim(claim, OUTCOME_INVALIDATED, b32(0xF2));
    }

    #[test]
    #[should_panic]
    fn expired_outcome_requires_horizon() {
        let env = odra_test::env();
        let (mut registry, claim) = setup_claim(&env, 0);
        registry.resolve_claim(claim, OUTCOME_EXPIRED, b32(0xF1));
    }

    #[test]
    fn third_party_can_propose_outcome() {
        let env = odra_test::env();
        let (mut registry, claim) = setup_claim(&env, 0);
        let third_party = env.get_account(2);
        env.set_caller(third_party);
        registry.resolve_claim(claim.clone(), OUTCOME_VALIDATED, b32(0xF1));
        let c = registry.get_claim(claim).unwrap();
        assert_eq!(c.proposed_by, Some(third_party)); // self-resolve vs third-party visible
    }

    // ── Disputes ──────────────────────────────────────────────────────────────

    #[test]
    fn dispute_marks_contested_and_arbiter_rules_for_challenger() {
        let env = odra_test::env();
        let bond_cspr = 2u64;
        let (mut registry, claim) = setup_claim(&env, bond_cspr);
        let challenger = env.get_account(1);
        let challenger_bal_before = env.balance_of(&challenger);

        registry.resolve_claim(claim.clone(), OUTCOME_VALIDATED, b32(0xF1));

        env.set_caller(challenger);
        registry.with_tokens(U512::from(bond_cspr * ONE_CSPR)).dispute_claim(claim.clone());
        let c = registry.get_claim(claim.clone()).unwrap();
        assert!(c.contested);
        assert_eq!(c.challenger, Some(challenger));

        // Arbiter (account 0) rules for challenger: outcome flips to invalidated.
        env.set_caller(env.get_account(0));
        registry.rule_dispute(claim.clone(), OUTCOME_INVALIDATED);

        let c = registry.get_claim(claim).unwrap();
        assert!(c.finalized);
        assert_eq!(c.outcome, OUTCOME_INVALIDATED);
        // Challenger receives claim bond + own counter-bond back.
        assert_eq!(
            env.balance_of(&challenger),
            challenger_bal_before + U512::from(bond_cspr * ONE_CSPR)
        );
        assert!(env.emitted(&registry, "DisputeRuled"));
    }

    #[test]
    fn rule_for_claimant_returns_both_bonds_to_claimant() {
        let env = odra_test::env();
        let bond_cspr = 2u64;
        let (mut registry, claim) = setup_claim(&env, bond_cspr);
        let claimant = env.get_account(0);
        let claimant_bal = env.balance_of(&claimant);

        registry.resolve_claim(claim.clone(), OUTCOME_VALIDATED, b32(0xF1));

        let challenger = env.get_account(1);
        env.set_caller(challenger);
        registry.with_tokens(U512::from(bond_cspr * ONE_CSPR)).dispute_claim(claim.clone());

        env.set_caller(claimant);
        registry.rule_dispute(claim, OUTCOME_VALIDATED); // upholds proposal

        // Claimant gets claim bond + challenger's counter-bond.
        assert_eq!(
            env.balance_of(&claimant),
            claimant_bal + U512::from(2 * bond_cspr * ONE_CSPR)
        );
    }

    #[test]
    #[should_panic]
    fn dispute_requires_counter_bond() {
        let env = odra_test::env();
        let (mut registry, claim) = setup_claim(&env, 2);
        registry.resolve_claim(claim.clone(), OUTCOME_VALIDATED, b32(0xF1));
        env.set_caller(env.get_account(1));
        registry.dispute_claim(claim); // no tokens attached
    }

    #[test]
    #[should_panic]
    fn finalize_blocked_when_disputed() {
        let env = odra_test::env();
        let (mut registry, claim) = setup_claim(&env, 1);
        registry.resolve_claim(claim.clone(), OUTCOME_VALIDATED, b32(0xF1));
        env.set_caller(env.get_account(1));
        registry.with_tokens(U512::from(ONE_CSPR)).dispute_claim(claim.clone());
        env.advance_block_time(DAY_MS + 1);
        env.set_caller(env.get_account(0));
        registry.finalize_resolution(claim);
    }

    // ── Epoch roots ───────────────────────────────────────────────────────────

    #[test]
    fn epoch_root_anchors_once() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        registry.anchor_epoch_root(7, b32(0x77), 150);

        let root = registry.get_epoch_root(7).unwrap();
        assert_eq!(root.record_count, 150);
        assert_eq!(root.anchored_by, env.get_account(0));
        assert_eq!(registry.get_counts(), (0, 0, 1));
        assert!(env.emitted(&registry, "EpochAnchored"));
    }

    #[test]
    #[should_panic]
    fn epoch_root_immutable() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        registry.anchor_epoch_root(7, b32(0x77), 150);
        registry.anchor_epoch_root(7, b32(0x78), 151);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    #[test]
    #[should_panic]
    fn non_arbiter_cannot_rule() {
        let env = odra_test::env();
        let (mut registry, claim) = setup_claim(&env, 1);
        registry.resolve_claim(claim.clone(), OUTCOME_VALIDATED, b32(0xF1));
        env.set_caller(env.get_account(1));
        registry.with_tokens(U512::from(ONE_CSPR)).dispute_claim(claim.clone());
        registry.rule_dispute(claim, OUTCOME_INVALIDATED); // caller is acc1, not arbiter
    }

    #[test]
    fn arbiter_can_withdraw_fee_pool() {
        let env = odra_test::env();
        let (mut registry, _) = setup_claim(&env, 0);
        let arbiter = env.get_account(0);
        let bal_before = env.balance_of(&arbiter);
        assert_eq!(registry.get_fee_pool(), U512::from(ONE_CSPR));

        registry.withdraw_fees();
        assert_eq!(registry.get_fee_pool(), U512::zero());
        assert_eq!(env.balance_of(&arbiter), bal_before + U512::from(ONE_CSPR));
    }
}
