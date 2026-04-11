program conviction_index.aleo {
    // A private record representing a user's Conviction Index metrics
    record ConvictionRecord {
        owner: address,
        score: u32,
        patience_tax: u64,
        archetype: u8,
        timestamp: u64,
    }

    // Official Archetypes:
    // 0: DIAMOND_HAND
    // 1: IRON_PILLAR
    // 2: PROFIT_PHANTOM
    // 3: EXIT_VOYAGER

    /**
     * Issue a private conviction record to a wallet.
     * In production, this would be gated by a multi-signature authority.
     */
    transition issue_conviction(
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
    transition verify_score_threshold(
        record: ConvictionRecord,
        public threshold: u32
    ) -> bool {
        assert(record.score >= threshold);
        return true;
    }

    /**
     * Selectively disclose if the user matches a specific archetype.
     * This is used for reputation-gating features without revealing the full report.
     */
    transition verify_archetype(
        record: ConvictionRecord,
        public required_archetype: u8
    ) -> bool {
        assert(record.archetype == required_archetype);
        return true;
    }

    /**
     * Prove that the patience tax was below a certain amount (efficient trading).
     */
    transition verify_efficient_trading(
        record: ConvictionRecord,
        public max_patience_tax: u64
    ) -> bool {
        assert(record.patience_tax <= max_patience_tax);
        return true;
    }

    /**
     * Unit Tests
     */
    test test_issue_and_verify_score() {
        let receiver: address = aleo165syv6uzvshdzurczvkuzvshdzurczvkuzvshdzurczvkuzvshdzu;
        let score: u32 = 85u32;
        let patience_tax: u64 = 500u64;
        let archetype: u8 = 1u8;
        let timestamp: u64 = 1712844600u64;

        let record: ConvictionRecord = issue_conviction(receiver, score, patience_tax, archetype, timestamp);
        
        assert_eq(record.score, 85u32);
        assert_eq(record.archetype, 1u8);

        let is_above: bool = verify_score_threshold(record, 80u32);
        assert(is_above);
    }

    test test_verify_archetype() {
        let receiver: address = aleo165syv6uzvshdzurczvkuzvshdzurczvkuzvshdzurczvkuzvshdzu;
        let record: ConvictionRecord = issue_conviction(receiver, 95u32, 100u64, 1u8, 1712844600u64);
        
        let is_iron_pillar: bool = verify_archetype(record, 1u8);
        assert(is_iron_pillar);
    }
}
