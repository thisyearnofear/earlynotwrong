// Base Mainnet EAS Contract Address
export const EAS_CONTRACT_ADDRESS = "0x4200000000000000000000000000000000000021";

// Schema Registry Contract (for reference)
export const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020";

// Placeholder Schema UID for "uint256 score, uint256 patienceTax, string archetype"
// In a real deployment, we would register this schema first and use the resulting UID.
// For now, we use a valid-looking 32-byte hash.
export const CONVICTION_SCHEMA_UID = "0x4c20790757788476d05903b22b28c50257322920257053073733560737033575"; 

export const EAS_ABI = [
  {
    "inputs": [
      {
        "components": [
          { "internalType": "bytes32", "name": "schema", "type": "bytes32" },
          {
            "components": [
              { "internalType": "address", "name": "recipient", "type": "address" },
              { "internalType": "uint64", "name": "expirationTime", "type": "uint64" },
              { "internalType": "bool", "name": "revocable", "type": "bool" },
              { "internalType": "bytes32", "name": "refUID", "type": "bytes32" },
              { "internalType": "bytes", "name": "data", "type": "bytes" },
              { "internalType": "uint256", "name": "value", "type": "uint256" }
            ],
            "internalType": "struct AttestationRequestData",
            "name": "data",
            "type": "tuple"
          }
        ],
        "internalType": "struct AttestationRequest",
        "name": "request",
        "type": "tuple"
      }
    ],
    "name": "attest",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "payable",
    "type": "function"
  }
] as const;
