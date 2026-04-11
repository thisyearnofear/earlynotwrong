program early_not_wrong_v1.aleo {
    // A private record representing a user's Conviction Index metrics
    record ConvictionRecord {
        owner: address,
        score: u32,
        patience_tax: u64,
        archetype: u8,
        timestamp: u64,
    }

    // A private record representing a user's committed trade thesis
    record PrivateThesis {
        owner: address,
        thesis_hash: field, // Hash of the thesis description + target token
        target_price: u64,
        timestamp: u64,
    }

    // Official Archetypes:
    // 0: DIAMOND_HAND
    // 1: IRON_PILLAR
    // 2: PROFIT_PHANTOM
    // 3: EXIT_VOYAGER

    @noupgrade
    constructor() {}

    /**
     * Commit a private trade thesis to Aleo.
     * This hides your trade intent until you decide to reveal it.
     */
    fn commit_thesis(
        public owner: address,
        public thesis_hash: field,
        public target_price: u64,
        public timestamp: u64
    ) -> PrivateThesis {
        return PrivateThesis {
            owner: owner,
            thesis_hash: thesis_hash,
            target_price: target_price,
            timestamp: timestamp,
        };
    }

    /**
     * Issue a private conviction record to a wallet.
     * In production, this would be gated by a multi-signature authority.
     */
    fn issue_conviction(
        public receiver: address,
        public score: u32,
        public patience_tax: u64,
        public archetype: u8,
        public timestamp: u64
    ) -> ConvictionRecord {
        // Only an authorized account should be able to issue these
        // For the purpose of the buildathon demo, we allow anyone to mint their own
        // but mark it with the receiver as owner.
        return ConvictionRecord {
            owner: receiver,
            score: score,
            patience_tax: patience_tax,
            archetype: archetype,
            timestamp: timestamp,
        };
    }

    /**
     * Selectively disclose if the conviction score is above a certain threshold.
     * Returns true if it is, without revealing the actual score.
     */
    fn verify_score_threshold(
        input_record: ConvictionRecord,
        public threshold: u32
    ) -> bool {
        assert(input_record.score >= threshold);
        return true;
    }

    /**
     * Selectively disclose if the user matches a specific archetype.
     * This is used for reputation-gating features without revealing the full report.
     */
    fn verify_archetype(
        input_record: ConvictionRecord,
        public required_archetype: u8
    ) -> bool {
        assert(input_record.archetype == required_archetype);
        return true;
    }

    /**
     * Prove that the patience tax was below a certain amount (efficient trading).
     */
    fn verify_efficient_trading(
        input_record: ConvictionRecord,
        public max_patience_tax: u64
    ) -> bool {
        assert(input_record.patience_tax <= max_patience_tax);
        return true;
    }
}
