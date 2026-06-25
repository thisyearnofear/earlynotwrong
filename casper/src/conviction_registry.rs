//! Casper ConvictionRegistry — agent reputation layer on Casper.
//!
//! Mirrors the Mantle ERC-8004 registry (`mantle/contracts/MantleConvictionRegistry.sol`):
//! the agent's per-cycle conviction analyses get anchored here as immutable
//! records. Same fields, same shape, different chain — giving us a portable
//! cross-chain reputation layer.
//!
//! Schema parity is deliberate: any downstream consumer that reads from Mantle
//! can read from Casper with the same struct, and our agent code uses ONE
//! `ConvictionRecord` type via the adapter abstraction.

use odra::prelude::*;
use odra::casper_types::bytesrepr::Bytes;

/// A single conviction analysis record.
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

/// On-chain registry. Two indices:
///   - `subject_history`: subject_hash → ordered list of records (full history)
///   - `by_thesis`: thesis_hash → single record (point lookup)
///
/// Storage choice rationale: subject history grows with use; a Vec inside a
/// Mapping<Bytes, Vec<_>> is the Odra idiom and matches the Solidity contract.
#[odra::module(events = [ConvictionAnchored, OperatorAuthorizationUpdated])]
pub struct ConvictionRegistry {
    /// subject_hash (32 bytes) → all conviction records anchored for that subject.
    subject_history: Mapping<Bytes, Vec<ConvictionRecord>>,
    /// thesis_hash (32 bytes) → the single record carrying that thesis.
    by_thesis: Mapping<Bytes, ConvictionRecord>,
    /// Operator allow-list. The deployer is the implicit owner; other operators
    /// must be authorized explicitly. Matches the Solidity `authorizedOperators`.
    authorized_operators: Mapping<Address, bool>,
    /// Contract owner (the deployer). Set on `init`, immutable after.
    owner: Var<Address>,
}

/// Emitted whenever an operator anchors a conviction record.
#[odra::event]
pub struct ConvictionAnchored {
    pub subject_hash: Bytes,
    pub anchored_by: Address,
    pub thesis_hash: Bytes,
    pub conviction_score: u8,
    pub archetype: String,
}

/// Emitted when the owner adds/revokes an operator.
#[odra::event]
pub struct OperatorAuthorizationUpdated {
    pub operator: Address,
    pub authorized: bool,
}

#[odra::module]
impl ConvictionRegistry {
    /// Deployer becomes owner + first authorized operator.
    pub fn init(&mut self) {
        let caller = self.env().caller();
        self.owner.set(caller);
        self.authorized_operators.set(&caller, true);
        self.env().emit_event(OperatorAuthorizationUpdated {
            operator: caller,
            authorized: true,
        });
    }

    /// Owner-only: add or revoke an operator.
    pub fn set_operator_authorization(&mut self, operator: Address, authorized: bool) {
        self.require_owner();
        self.authorized_operators.set(&operator, authorized);
        self.env().emit_event(OperatorAuthorizationUpdated { operator, authorized });
    }

    /// Anchor a new conviction record. Caller must be an authorized operator.
    /// Hashes are kept untyped (`Bytes`) so the agent can pass any 32-byte digest
    /// without forcing a Casper-side hashing scheme.
    pub fn anchor_conviction(
        &mut self,
        subject_hash: Bytes,
        thesis_hash: Bytes,
        conviction_score: u8,
        archetype: String,
        timestamp: u64,
    ) {
        let caller = self.env().caller();
        self.require_operator(caller);
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

        // Append to subject history
        let mut history = self.subject_history.get(&subject_hash).unwrap_or_default();
        history.push(record.clone());
        self.subject_history.set(&subject_hash, history);

        // Point lookup by thesis hash
        self.by_thesis.set(&thesis_hash, record);

        self.env().emit_event(ConvictionAnchored {
            subject_hash,
            anchored_by: caller,
            thesis_hash,
            conviction_score,
            archetype,
        });
    }

    /// Read the full anchored history for a subject (chronological).
    pub fn get_subject_history(&self, subject_hash: Bytes) -> Vec<ConvictionRecord> {
        self.subject_history.get(&subject_hash).unwrap_or_default()
    }

    /// Read the most recent record for a subject, if any.
    pub fn get_latest_conviction(&self, subject_hash: Bytes) -> Option<ConvictionRecord> {
        self.subject_history.get(&subject_hash).and_then(|v| v.last().cloned())
    }

    /// Read a record by its thesis hash. Returns None if no such record exists.
    pub fn get_by_thesis(&self, thesis_hash: Bytes) -> Option<ConvictionRecord> {
        self.by_thesis.get(&thesis_hash)
    }

    /// Whether an address can anchor.
    pub fn is_operator(&self, operator: Address) -> bool {
        self.authorized_operators.get(&operator).unwrap_or(false)
    }

    // ── Guards ──

    fn require_owner(&self) {
        let owner = self.owner.get().expect("not initialized");
        assert_eq!(self.env().caller(), owner, "only owner");
    }

    fn require_operator(&self, who: Address) {
        let authorized = self.authorized_operators.get(&who).unwrap_or(false);
        assert!(authorized, "not authorized operator");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, NoArgs};

    fn b32(seed: u8) -> Bytes {
        Bytes::from(vec![seed; 32])
    }

    #[test]
    fn deployer_becomes_owner_and_operator() {
        let env = odra_test::env();
        let registry = ConvictionRegistry::deploy(&env, NoArgs);
        assert!(registry.is_operator(env.get_account(0)));
    }

    #[test]
    fn anchor_and_read_back() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);

        let subject = b32(0xAA);
        let thesis = b32(0xBB);
        registry.anchor_conviction(
            subject.clone(),
            thesis.clone(),
            85,
            "DEEP FEAR — PRIME CONTRARIAN".to_string(),
            1_782_408_000_000,
        );

        let latest = registry.get_latest_conviction(subject.clone()).unwrap();
        assert_eq!(latest.conviction_score, 85);
        assert_eq!(latest.archetype, "DEEP FEAR — PRIME CONTRARIAN");
        assert_eq!(latest.timestamp, 1_782_408_000_000);

        let by_thesis = registry.get_by_thesis(thesis).unwrap();
        assert_eq!(by_thesis.subject_hash, subject);
    }

    #[test]
    fn history_accumulates() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        let subject = b32(0xAA);

        for i in 0..3u8 {
            registry.anchor_conviction(subject.clone(), b32(i), 50 + i, format!("regime-{i}"), i as u64);
        }

        let history = registry.get_subject_history(subject);
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].conviction_score, 50);
        assert_eq!(history[2].conviction_score, 52);
    }

    #[test]
    #[should_panic]
    fn rejects_out_of_range_score() {
        // Odra wraps contract panics as VmError, so we just assert any panic.
        // The assertion text is exercised but not matched here.
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        registry.anchor_conviction(b32(0), b32(0), 101, "x".to_string(), 0);
    }
}
