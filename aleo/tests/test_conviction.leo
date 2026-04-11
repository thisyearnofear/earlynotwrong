import early_not_wrong_v2.aleo;

program test_conviction.aleo {
    @noupgrade
    constructor() {}

    @test
    fn test_issue_and_verify_score() {
        let receiver: address = self.signer;
        let score: u32 = 85u32;
        let patience_tax: u64 = 500u64;
        let archetype: u8 = 1u8;
        let timestamp: u64 = 1712844600u64;

        let my_record = early_not_wrong_v2.aleo::issue_conviction(receiver, score, patience_tax, archetype, timestamp);
        
        assert_eq(my_record.score, 85u32);
        assert_eq(my_record.archetype, 1u8);

        let is_above: bool = early_not_wrong_v2.aleo::verify_score_threshold(my_record, 80u32);
        assert(is_above);
    }

    @test
    fn test_verify_archetype() {
        let receiver: address = self.signer;
        let my_record = early_not_wrong_v2.aleo::issue_conviction(receiver, 95u32, 100u64, 1u8, 1712844600u64);
        
        let is_iron_pillar: bool = early_not_wrong_v2.aleo::verify_archetype(my_record, 1u8);
        assert(is_iron_pillar);
    }
}
