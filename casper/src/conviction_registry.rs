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
#[odra::module(events = [ConvictionAnchored])]
pub struct ConvictionRegistry {
    /// subject_hash (32 bytes) → all conviction records anchored for that subject.
    subject_history: Mapping<Bytes, Vec<ConvictionRecord>>,
    /// thesis_hash (32 bytes) → the single record carrying that thesis.
    by_thesis: Mapping<Bytes, ConvictionRecord>,
}

/// Emitted whenever an agent anchors a conviction record.
#[odra::event]
pub struct ConvictionAnchored {
    pub subject_hash: Bytes,
    pub anchored_by: Address,
    pub thesis_hash: Bytes,
    pub conviction_score: u8,
    pub archetype: String,
}

#[odra::module]
impl ConvictionRegistry {
    /// Init is a no-op — anchoring is permissionless.
    /// The deployer's address is recorded as `anchored_by` on their submissions.
    pub fn init(&mut self) {}

    /// Anchor a new conviction record.
    ///
    /// Open to any caller — submissions carry the caller as `anchored_by`,
    /// so every record is on-chain-attributed without a separate allow-list.
    /// This removes Casper 2.0 entity-model friction while preserving the
    /// trust story: the caller's account hash is right there in the record.
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, NoArgs};

    fn b32(seed: u8) -> Bytes {
        Bytes::from(vec![seed; 32])
    }

    #[test]
    fn init_is_noop_and_anchoring_is_permissionless() {
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        // Any account can anchor — no operator gating
        registry.anchor_conviction(
            b32(0xAA),
            b32(0xBB),
            72,
            "DEEP FEAR — PRIME CONTRARIAN".to_string(),
            1_782_408_000_000,
        );
        let latest = registry.get_latest_conviction(b32(0xAA)).unwrap();
        assert_eq!(latest.conviction_score, 72);
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
        let env = odra_test::env();
        let mut registry = ConvictionRegistry::deploy(&env, NoArgs);
        registry.anchor_conviction(b32(0), b32(0), 101, "x".to_string(), 0);
    }
}
