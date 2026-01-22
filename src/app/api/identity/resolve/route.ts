/**
 * Identity Resolution API Endpoint
 * 
 * Resolves wallet addresses, ENS names, Farcaster handles into unified identity.
 * Used by wallet search/input components.
 */

import { NextRequest, NextResponse } from 'next/server';
import { identityResolver } from '@/lib/services/identity-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/identity/resolve
 * 
 * Body: { input: string } // Address, ENS, Farcaster handle, etc.
 * Returns: ResolvedIdentity or null
 */
export async function POST(request: NextRequest) {
  try {
    const { input } = await request.json();

    if (!input || typeof input !== 'string') {
      return NextResponse.json(
        { error: 'Invalid input. Provide an address, ENS, or Farcaster handle.' },
        { status: 400 }
      );
    }

    const identity = await identityResolver.resolve(input);

    if (!identity) {
      return NextResponse.json(
        { error: 'Could not resolve identity', input },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      identity,
    });
  } catch (error) {
    console.error('Identity resolution error:', error);
    return NextResponse.json(
      { error: 'Internal server error during identity resolution' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/identity/resolve?input=...
 * Alternative query param interface
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const input = searchParams.get('input');

    if (!input) {
      return NextResponse.json(
        { error: 'Missing input parameter' },
        { status: 400 }
      );
    }

    const identity = await identityResolver.resolve(input);

    if (!identity) {
      return NextResponse.json(
        { error: 'Could not resolve identity', input },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      identity,
    });
  } catch (error) {
    console.error('Identity resolution error:', error);
    return NextResponse.json(
      { error: 'Internal server error during identity resolution' },
      { status: 500 }
    );
  }
}
