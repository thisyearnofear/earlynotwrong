/**
 * Ethos Review Integration
 * Writes optional reviews/endorsements to Ethos Network for conviction scores
 */

import { ConvictionMetrics } from './market';
import { ethosClient } from './ethos';

export type ReviewSentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';

export interface EthosReview {
  subject: string; // Wallet address
  sentiment: ReviewSentiment;
  comment: string;
  score: number; // Conviction score
  metadata?: Record<string, any>;
}

export interface EthosReviewResponse {
  reviewId?: string;
  reviewUrl?: string;
  success: boolean;
  error?: string;
}

/**
 * Determine review sentiment based on conviction score
 */
export function getReviewSentiment(convictionScore: number): ReviewSentiment {
  if (convictionScore >= 80) return 'POSITIVE';
  if (convictionScore >= 60) return 'POSITIVE';
  if (convictionScore >= 40) return 'NEUTRAL';
  return 'NEUTRAL'; // Don't auto-write negative reviews
}

/**
 * Generate review comment text based on conviction metrics
 */
export function generateReviewComment(metrics: ConvictionMetrics): string {
  const { score, archetype, upsideCapture, patienceTax, convictionWins } = metrics;
  
  if (score >= 90) {
    return `Exceptional conviction trader - ${archetype} with ${score}/100 score. Captured ${upsideCapture}% of upside potential with ${convictionWins} conviction wins. A true diamond hand. 💎`;
  }
  
  if (score >= 80) {
    return `High conviction ${archetype} - ${score}/100 score with ${upsideCapture}% upside capture. ${convictionWins} conviction wins demonstrate strong holding power.`;
  }
  
  if (score >= 70) {
    return `Solid ${archetype} performance - ${score}/100 conviction score. ${upsideCapture}% upside capture shows good patience, with ${convictionWins} conviction wins.`;
  }
  
  if (score >= 60) {
    return `Decent conviction trader - ${archetype} with ${score}/100 score. ${upsideCapture}% upside capture and ${convictionWins} conviction wins.`;
  }
  
  if (score >= 50) {
    return `Moderate conviction - ${archetype} profile with ${score}/100 score. ${upsideCapture}% upside capture. Room for patience improvement.`;
  }
  
  // For scores below 50, still provide neutral, constructive feedback
  return `${archetype} profile - ${score}/100 conviction score. Early analysis shows ${upsideCapture}% upside capture. Patience tax of $${patienceTax.toFixed(0)} suggests opportunity for improvement.`;
}

/**
 * Check if user should be prompted to write an Ethos review
 */
export function shouldPromptForReview(convictionScore: number): boolean {
  // Only prompt for scores 50+, let users decide for lower scores
  return convictionScore >= 50;
}

/**
 * Write a review to Ethos Network (placeholder for actual implementation)
 * 
 * Note: Ethos Everywhere Wallet requires:
 * - Domain allowlisting (must be approved Ethos partner)
 * - JWT authentication via Privy
 * - Gas sponsorship for qualified users
 * 
 * Alternative approaches:
 * 1. Direct smart contract interaction (if Ethos exposes review contracts)
 * 2. Ethos SDK if available
 * 3. Partner API integration after approval
 */
export async function writeEthosReview(
  review: EthosReview
): Promise<EthosReviewResponse> {
  try {
    // Check if user has sufficient Ethos credibility to write reviews
    const score = await ethosClient.getScoreByAddress(review.subject);
    
    if (!score || score.score < 100) {
      return {
        success: false,
        error: 'Insufficient Ethos credibility to write reviews. Build your Ethos profile first.',
      };
    }

    // TODO: Implement actual Ethos review writing
    // Options:
    // 1. Ethos Everywhere Wallet API (requires partner approval)
    // 2. Direct contract interaction (if public)
    // 3. Ethos SDK integration
    
    console.log('Ethos review writing not yet implemented. Would write:', review);
    
    // For now, return success=false to indicate feature is pending
    return {
      success: false,
      error: 'Ethos review writing requires partner integration. Feature coming soon.',
    };

    // Future implementation would look like:
    /*
    const response = await fetch('https://api.ethos.network/api/v2/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${privyToken}`,
        'X-Ethos-Client': 'early-not-wrong@1.0.0',
      },
      body: JSON.stringify({
        subject: review.subject,
        sentiment: review.sentiment,
        comment: review.comment,
        // Additional fields as per Ethos API spec
      }),
    });

    if (!response.ok) {
      throw new Error(`Ethos API error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      reviewId: data.id,
      reviewUrl: `https://app.ethos.network/review/${data.id}`,
      success: true,
    };
    */

  } catch (error) {
    console.error('Failed to write Ethos review:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate a deep-link URL to write an Ethos review
 * Opens Ethos app at the profile page where user can manually write review
 */
export function getEthosReviewURL(
  subject: string,
  metrics: ConvictionMetrics
): string {
  // Simply link to the profile page - Ethos will handle the review UI
  // Users can manually write reviews based on our conviction insights
  return `https://app.ethos.network/profile/${subject}`;
}

/**
 * Generate review text for clipboard copy
 * User can paste this into Ethos review form
 */
export function getReviewTextForClipboard(metrics: ConvictionMetrics): string {
  return generateReviewComment(metrics);
}

/**
 * Prepare review data from conviction metrics
 */
export function prepareEthosReview(
  walletAddress: string,
  metrics: ConvictionMetrics
): EthosReview {
  return {
    subject: walletAddress,
    sentiment: getReviewSentiment(metrics.score),
    comment: generateReviewComment(metrics),
    score: metrics.score,
    metadata: {
      archetype: metrics.archetype,
      upsideCapture: metrics.upsideCapture,
      patienceTax: metrics.patienceTax,
      convictionWins: metrics.convictionWins,
      totalPositions: metrics.totalPositions,
      source: 'early-not-wrong',
    },
  };
}
