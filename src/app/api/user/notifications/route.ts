/**
 * User Notification Preferences API
 * GET: Fetch current preferences
 * POST: Create/update preferences
 * DELETE: Disable notifications
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

interface NotificationPreferences {
  email?: string;
  telegramChatId?: string;
  channels: string[];
  minTrustScore: number;
  minClusterSize: number;
  chainFilter: string[];
  tokenFilter: string[];
  maxAlertsPerHour: number;
  isActive: boolean;
}

// GET: Fetch preferences
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userAddress = searchParams.get("address");

    if (!userAddress) {
      return NextResponse.json(
        { error: "Missing address parameter" },
        { status: 400 }
      );
    }

    const result = await sql`
      SELECT 
        email,
        telegram_chat_id,
        channels,
        min_trust_score,
        min_cluster_size,
        chain_filter,
        token_filter,
        max_alerts_per_hour,
        is_active,
        created_at,
        updated_at
      FROM notification_subscriptions
      WHERE user_address = ${userAddress.toLowerCase()}
    `;

    if (result.rows.length === 0) {
      return NextResponse.json({
        success: true,
        preferences: null,
        message: "No notification preferences set",
      });
    }

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      preferences: {
        email: row.email,
        telegramChatId: row.telegram_chat_id,
        channels: row.channels || ["in_app"],
        minTrustScore: row.min_trust_score,
        minClusterSize: row.min_cluster_size,
        chainFilter: row.chain_filter || [],
        tokenFilter: row.token_filter || [],
        maxAlertsPerHour: row.max_alerts_per_hour,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error("Fetch preferences error:", error);
    return NextResponse.json(
      { error: "Failed to fetch preferences", details: String(error) },
      { status: 500 }
    );
  }
}

// POST: Create or update preferences
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      userAddress,
      email,
      telegramChatId,
      channels = ["in_app"],
      minTrustScore = 65,
      minClusterSize = 3,
      chainFilter = [],
      tokenFilter = [],
      maxAlertsPerHour = 10,
    } = body;

    if (!userAddress) {
      return NextResponse.json(
        { error: "Missing userAddress" },
        { status: 400 }
      );
    }

    // Validate channels
    const validChannels = ["in_app", "email", "telegram"];
    const filteredChannels = channels.filter((c: string) =>
      validChannels.includes(c)
    );

    if (filteredChannels.includes("email") && !email) {
      return NextResponse.json(
        { error: "Email required when email channel is enabled" },
        { status: 400 }
      );
    }

    if (filteredChannels.includes("telegram") && !telegramChatId) {
      return NextResponse.json(
        { error: "Telegram chat ID required when telegram channel is enabled" },
        { status: 400 }
      );
    }

    // Serialize arrays for Postgres
    const channelsArray = `{${filteredChannels.map((c: string) => `"${c}"`).join(",")}}`;
    const chainFilterArray =
      chainFilter.length > 0
        ? `{${chainFilter.map((c: string) => `"${c}"`).join(",")}}`
        : null;
    const tokenFilterArray =
      tokenFilter.length > 0
        ? `{${tokenFilter.map((t: string) => `"${t}"`).join(",")}}`
        : null;

    const result = await sql`
      INSERT INTO notification_subscriptions (
        user_address,
        email,
        telegram_chat_id,
        channels,
        min_trust_score,
        min_cluster_size,
        chain_filter,
        token_filter,
        max_alerts_per_hour,
        is_active,
        updated_at
      ) VALUES (
        ${userAddress.toLowerCase()},
        ${email || null},
        ${telegramChatId || null},
        ${channelsArray}::varchar[],
        ${minTrustScore},
        ${minClusterSize},
        ${chainFilterArray}::varchar[],
        ${tokenFilterArray}::varchar[],
        ${maxAlertsPerHour},
        true,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (user_address) DO UPDATE SET
        email = EXCLUDED.email,
        telegram_chat_id = EXCLUDED.telegram_chat_id,
        channels = EXCLUDED.channels,
        min_trust_score = EXCLUDED.min_trust_score,
        min_cluster_size = EXCLUDED.min_cluster_size,
        chain_filter = EXCLUDED.chain_filter,
        token_filter = EXCLUDED.token_filter,
        max_alerts_per_hour = EXCLUDED.max_alerts_per_hour,
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    return NextResponse.json({
      success: true,
      message: "Notification preferences saved",
      preferences: {
        email: result.rows[0].email,
        telegramChatId: result.rows[0].telegram_chat_id,
        channels: result.rows[0].channels,
        minTrustScore: result.rows[0].min_trust_score,
        minClusterSize: result.rows[0].min_cluster_size,
        chainFilter: result.rows[0].chain_filter || [],
        tokenFilter: result.rows[0].token_filter || [],
        maxAlertsPerHour: result.rows[0].max_alerts_per_hour,
        isActive: result.rows[0].is_active,
      },
    });
  } catch (error) {
    console.error("Save preferences error:", error);
    return NextResponse.json(
      { error: "Failed to save preferences", details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE: Disable notifications
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userAddress = searchParams.get("address");

    if (!userAddress) {
      return NextResponse.json(
        { error: "Missing address parameter" },
        { status: 400 }
      );
    }

    await sql`
      UPDATE notification_subscriptions
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE user_address = ${userAddress.toLowerCase()}
    `;

    return NextResponse.json({
      success: true,
      message: "Notifications disabled",
    });
  } catch (error) {
    console.error("Disable notifications error:", error);
    return NextResponse.json(
      { error: "Failed to disable notifications", details: String(error) },
      { status: 500 }
    );
  }
}
