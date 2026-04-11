import credits.aleo;

program early_not_wrong_v3.aleo {
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

    // Mapping to prevent replay attacks by storing used voucher hashes (nonces)
    mapping used_vouchers: field => bool;

    // Official Archetypes:
    // 0: DIAMOND_HAND
    // 1: IRON_PILLAR
    // 2: PROFIT_PHANTOM
    // 3: EXIT_VOYAGER

    @noupgrade
    constructor() {}

    /**
     * Claim a behavioral rebate using a signed voucher from the treasury.
     * This follows the 'Pull' model for maximum security.
     */
    fn claim_rebate(
        public recipient: address,
        public amount: u64,
        public nonce: field,
        public sig: signature
    ) -> Final {
        // 1. Recreate the message hash that was signed by the treasury
        let message: field = nonce;

        // The treasury address (the one we generated earlier)
        let treasury: address = aleo1lsjcz7402z2zxuzznltcx4r37ys39w0gktxr3rmtce2kqqdwr5xq020tl2;
        
        // 2. Verify the signature from the treasury
        assert(signature::verify(sig, treasury, message));

        // 3. Execute the transfer of credits (acting as behavioral rewards)
        // We use credits.aleo for the demo's cross-program execution.
        let f: Final = credits.aleo::transfer_public(recipient, amount);

        return final {
            // Await the external transfer to complete
            f.run();
            // Prevent replay attacks by ensuring this voucher hash hasn't been used
            assert(!used_vouchers.contains(message));
            used_vouchers.set(message, true);
        };
    }

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
