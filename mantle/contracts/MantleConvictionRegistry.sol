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
        address user;
        bytes32 thesisHash;    // Hashed behavioral analysis/thesis
        uint256 convictionScore; // 0-100
        string archetype;      // e.g., "High Conviction", "Early but Right"
        uint256 timestamp;
        bool verified;         // Whether this has been validated by a validation registry
    }

    // Mapping from user address to their conviction history
    mapping(address => ConvictionRecord[]) public userConvictionHistory;
    
    // Mapping from thesisHash to its metadata
    mapping(bytes32 => ConvictionRecord) public convictionByThesis;

    event ConvictionAnchored(
        address indexed user,
        bytes32 indexed thesisHash,
        uint256 convictionScore,
        string archetype
    );

    event ConvictionVerified(bytes32 indexed thesisHash);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Anchors a new conviction score for a user.
     * Only the authorized ENW agent (owner) can call this.
     */
    function anchorConviction(
        address _user,
        bytes32 _thesisHash,
        uint256 _convictionScore,
        string calldata _archetype
    ) external onlyOwner {
        require(_convictionScore <= 100, "Score must be 0-100");
        
        ConvictionRecord memory newRecord = ConvictionRecord({
            user: _user,
            thesisHash: _thesisHash,
            convictionScore: _convictionScore,
            archetype: _archetype,
            timestamp: block.timestamp,
            verified: false
        });

        userConvictionHistory[_user].push(newRecord);
        convictionByThesis[_thesisHash] = newRecord;

        emit ConvictionAnchored(_user, _thesisHash, _convictionScore, _archetype);
    }

    /**
     * @dev Marks a conviction as verified (e.g., by a Validation Registry or ZK proof).
     */
    function verifyConviction(bytes32 _thesisHash) external onlyOwner {
        require(convictionByThesis[_thesisHash].timestamp > 0, "Record not found");
        convictionByThesis[_thesisHash].verified = true;
        
        // Update in history as well (optimization: would be better with mapping of index)
        ConvictionRecord[] storage history = userConvictionHistory[convictionByThesis[_thesisHash].user];
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
    function getLatestConviction(address _user) external view returns (ConvictionRecord memory) {
        uint256 length = userConvictionHistory[_user].length;
        require(length > 0, "No records found");
        return userConvictionHistory[_user][length - 1];
    }
}
