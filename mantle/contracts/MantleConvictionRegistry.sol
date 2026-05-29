// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MantleConvictionRegistry
 * @dev Anchors AI-generated conviction scores and behavioral insights on Mantle L2.
 * This contract serves as the "Proof of Analysis" layer for the Early Not Wrong (ENW) agent.
 */
contract MantleConvictionRegistry is Ownable {
    
    struct ConvictionRecord {
        bytes32 subjectHash;   // Cross-chain subject identifier, e.g. keccak256("solana:<wallet>")
        address anchoredBy;    // Agent/operator wallet that anchored the analysis
        bytes32 thesisHash;    // Hashed behavioral analysis/thesis
        uint256 convictionScore; // 0-100
        string archetype;      // e.g., "High Conviction", "Early but Right"
        uint256 timestamp;
        bool verified;         // Whether this has been validated by a validation registry
    }

    // Mapping from cross-chain subject hash to conviction history
    mapping(bytes32 => ConvictionRecord[]) public subjectConvictionHistory;
    
    // Mapping from thesisHash to its metadata
    mapping(bytes32 => ConvictionRecord) public convictionByThesis;

    event ConvictionAnchored(
        bytes32 indexed subjectHash,
        address indexed anchoredBy,
        bytes32 indexed thesisHash,
        uint256 convictionScore,
        string archetype
    );

    event ConvictionVerified(bytes32 indexed thesisHash);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Anchors a new conviction score for a cross-chain wallet or identity.
     * Only the authorized ENW agent (owner) can call this.
     */
    function anchorConviction(
        bytes32 _subjectHash,
        bytes32 _thesisHash,
        uint256 _convictionScore,
        string calldata _archetype
    ) external onlyOwner {
        require(_convictionScore <= 100, "Score must be 0-100");

        ConvictionRecord memory newRecord = ConvictionRecord({
            subjectHash: _subjectHash,
            anchoredBy: msg.sender,
            thesisHash: _thesisHash,
            convictionScore: _convictionScore,
            archetype: _archetype,
            timestamp: block.timestamp,
            verified: false
        });

        subjectConvictionHistory[_subjectHash].push(newRecord);
        convictionByThesis[_thesisHash] = newRecord;

        emit ConvictionAnchored(_subjectHash, msg.sender, _thesisHash, _convictionScore, _archetype);
    }

    /**
     * @dev Marks a conviction as verified (e.g., by a Validation Registry or ZK proof).
     */
    function verifyConviction(bytes32 _thesisHash) external onlyOwner {
        require(convictionByThesis[_thesisHash].timestamp > 0, "Record not found");
        convictionByThesis[_thesisHash].verified = true;
        
        // Update in history as well (optimization: would be better with mapping of index)
        ConvictionRecord[] storage history = subjectConvictionHistory[convictionByThesis[_thesisHash].subjectHash];
        for (uint i = 0; i < history.length; i++) {
            if (history[i].thesisHash == _thesisHash) {
                history[i].verified = true;
                break;
            }
        }

        emit ConvictionVerified(_thesisHash);
    }

    /**
     * @dev Returns the latest conviction record for a user.
     */
    function getLatestConviction(bytes32 _subjectHash) external view returns (ConvictionRecord memory) {
        uint256 length = subjectConvictionHistory[_subjectHash].length;
        require(length > 0, "No records found");
        return subjectConvictionHistory[_subjectHash][length - 1];
    }
}
