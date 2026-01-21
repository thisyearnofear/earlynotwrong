/**
 * EAS GraphQL Client
 * Queries Ethereum Attestation Service attestations from Base network via GraphQL
 */

import { decodeAbiParameters, parseAbiParameters } from 'viem';
import { CONVICTION_SCHEMA_UID } from './eas-config';

const EAS_GRAPHQL_ENDPOINT = 'https://base.easscan.org/graphql';

export interface EASAttestation {
  id: string;
  attester: string;
  recipient: string;
  time: number;
  data: string; // Hex-encoded ABI data
  txid: string;
  revoked: boolean;
  expirationTime: number;
}

export interface DecodedConvictionData {
  score: bigint;
  patienceTax: bigint;
  archetype: string;
}

/**
 * Query attestations from EAS GraphQL API
 */
async function queryEAS(query: string, variables: Record<string, any>): Promise<any> {
  try {
    const response = await fetch(EAS_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`EAS GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`EAS GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  } catch (error) {
    console.error('EAS GraphQL query failed:', error);
    throw error;
  }
}

/**
 * Get conviction attestations for a specific recipient address
 */
export async function getConvictionAttestationsByRecipient(
  recipient: string
): Promise<EASAttestation[]> {
  const query = `
    query GetConvictionAttestations($schema: String!, $recipient: String!) {
      attestations(
        where: {
          schemaId: { equals: $schema }
          recipient: { equals: $recipient }
          revoked: { equals: false }
        }
        orderBy: [{ time: desc }]
        take: 50
      ) {
        id
        attester
        recipient
        time
        data
        txid
        revoked
        expirationTime
      }
    }
  `;

  const variables = {
    schema: CONVICTION_SCHEMA_UID,
    recipient: recipient.toLowerCase(),
  };

  try {
    const data = await queryEAS(query, variables);
    return data.attestations || [];
  } catch (error) {
    console.warn('Failed to fetch conviction attestations:', error);
    return [];
  }
}

/**
 * Get a single attestation by UID
 */
export async function getAttestationByUID(uid: string): Promise<EASAttestation | null> {
  const query = `
    query GetAttestationByUID($uid: String!) {
      attestation(where: { id: $uid }) {
        id
        attester
        recipient
        time
        data
        txid
        revoked
        expirationTime
      }
    }
  `;

  const variables = { uid };

  try {
    const data = await queryEAS(query, variables);
    return data.attestation || null;
  } catch (error) {
    console.warn('Failed to fetch attestation by UID:', error);
    return null;
  }
}

/**
 * Decode conviction attestation data
 * Schema: "uint256 score, uint256 patienceTax, string archetype"
 */
export function decodeConvictionData(encodedData: string): DecodedConvictionData | null {
  try {
    // Remove 0x prefix if present
    const dataHex = encodedData.startsWith('0x') ? encodedData : `0x${encodedData}`;

    // Decode according to schema
    const decoded = decodeAbiParameters(
      parseAbiParameters('uint256 score, uint256 patienceTax, string archetype'),
      dataHex as `0x${string}`
    );

    return {
      score: decoded[0],
      patienceTax: decoded[1],
      archetype: decoded[2],
    };
  } catch (error) {
    console.error('Failed to decode conviction attestation data:', error);
    return null;
  }
}

/**
 * Get attestation count for a recipient
 */
export async function getAttestationCount(recipient: string): Promise<number> {
  const query = `
    query GetAttestationCount($schema: String!, $recipient: String!) {
      attestations(
        where: {
          schemaId: { equals: $schema }
          recipient: { equals: $recipient }
          revoked: { equals: false }
        }
      ) {
        id
      }
    }
  `;

  const variables = {
    schema: CONVICTION_SCHEMA_UID,
    recipient: recipient.toLowerCase(),
  };

  try {
    const data = await queryEAS(query, variables);
    return data.attestations?.length || 0;
  } catch (error) {
    console.warn('Failed to fetch attestation count:', error);
    return 0;
  }
}

/**
 * Check if an address has any conviction attestations
 */
export async function hasConvictionAttestations(address: string): Promise<boolean> {
  const count = await getAttestationCount(address);
  return count > 0;
}

/**
 * Get the latest conviction attestation for a recipient
 */
export async function getLatestConvictionAttestation(
  recipient: string
): Promise<EASAttestation | null> {
  const attestations = await getConvictionAttestationsByRecipient(recipient);
  return attestations.length > 0 ? attestations[0] : null;
}
