/**
 * Migration: Add notification system tables
 * Run with: npx tsx scripts/migrate-notifications.ts
 */

import { sql } from "@vercel/postgres";

async function migrate() {
  console.log("🚀 Running notification system migration...\n");

  try {
    // Table: Notification Subscriptions
    console.log("Creating notification_subscriptions table...");
    await sql`
      CREATE TABLE IF NOT EXISTS notification_subscriptions (
        id SERIAL PRIMARY KEY,
        user_address VARCHAR(64) NOT NULL,
        
        email VARCHAR(255),
        telegram_chat_id VARCHAR(100),
        
        channels VARCHAR(20)[] DEFAULT ARRAY['in_app']::VARCHAR[],
        min_trust_score INTEGER DEFAULT 65,
        min_cluster_size INTEGER DEFAULT 3,
        
        chain_filter VARCHAR(10)[],
        token_filter VARCHAR(64)[],
        
        max_alerts_per_hour INTEGER DEFAULT 10,
        
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(user_address)
      )
    `;
    console.log("✅ notification_subscriptions created");

    await sql`CREATE INDEX IF NOT EXISTS idx_notification_subs_active ON notification_subscriptions(is_active)`;

    // Table: Notification Deliveries
    console.log("Creating notification_deliveries table...");
    await sql`
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id SERIAL PRIMARY KEY,
        user_address VARCHAR(64) NOT NULL,
        alert_id VARCHAR(255) NOT NULL,
        channel VARCHAR(20) NOT NULL,
        
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'rate_limited')),
        error_message TEXT,
        
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMP WITH TIME ZONE,
        
        UNIQUE(user_address, alert_id, channel)
      )
    `;
    console.log("✅ notification_deliveries created");

    await sql`CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON notification_deliveries(user_address)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries(status)`;

    // Table: Cluster Signals
    console.log("Creating cluster_signals table...");
    await sql`
      CREATE TABLE IF NOT EXISTS cluster_signals (
        id SERIAL PRIMARY KEY,
        signal_id VARCHAR(255) NOT NULL UNIQUE,
        chain VARCHAR(10) NOT NULL CHECK (chain IN ('solana', 'base')),
        token_address VARCHAR(64) NOT NULL,
        token_symbol VARCHAR(50),
        
        cluster_size INTEGER NOT NULL,
        avg_trust_score INTEGER NOT NULL,
        unique_traders JSONB NOT NULL,
        
        window_minutes INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log("✅ cluster_signals created");

    await sql`CREATE INDEX IF NOT EXISTS idx_cluster_signals_chain ON cluster_signals(chain)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cluster_signals_token ON cluster_signals(token_address)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cluster_signals_created ON cluster_signals(created_at DESC)`;

    console.log("\n🎉 Migration complete!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
