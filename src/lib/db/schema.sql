-- Conviction Analysis Storage Schema
-- Run this in your Neon Postgres dashboard

-- Table: Store all conviction analyses for real cohort data
CREATE TABLE IF NOT EXISTS conviction_analyses (
  id SERIAL PRIMARY KEY,
  address VARCHAR(64) NOT NULL,
  chain VARCHAR(10) NOT NULL CHECK (chain IN ('solana', 'base')),
  
  -- Core metrics
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  patience_tax DECIMAL(5,2) NOT NULL,
  upside_capture DECIMAL(5,2) NOT NULL,
  early_exits INTEGER NOT NULL DEFAULT 0,
  conviction_wins INTEGER NOT NULL DEFAULT 0,
  percentile INTEGER NOT NULL,
  archetype VARCHAR(50),
  total_positions INTEGER NOT NULL DEFAULT 0,
  avg_holding_period DECIMAL(10,2) NOT NULL DEFAULT 0,
  win_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  
  -- Metadata
  time_horizon INTEGER NOT NULL DEFAULT 30,
  analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Identity (optional)
  ens_name VARCHAR(255),
  farcaster_username VARCHAR(100),
  ethos_score INTEGER,
  unified_trust_score INTEGER,
  unified_trust_tier VARCHAR(20),

  -- Date for unique constraint (computed on insert)
  analyzed_date DATE DEFAULT CURRENT_DATE,

  -- For tracking unique analyses per day
  UNIQUE(address, chain, time_horizon, analyzed_date)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_analyses_address ON conviction_analyses(address);
CREATE INDEX IF NOT EXISTS idx_analyses_chain ON conviction_analyses(chain);
CREATE INDEX IF NOT EXISTS idx_analyses_score ON conviction_analyses(score DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_percentile ON conviction_analyses(percentile DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_analyzed_at ON conviction_analyses(analyzed_at DESC);

-- Table: Editable watchlist (includes community nominations)
CREATE TABLE IF NOT EXISTS watchlist_traders (
  id SERIAL PRIMARY KEY,
  trader_id VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  chain VARCHAR(10) NOT NULL CHECK (chain IN ('solana', 'base')),
  wallets TEXT[] NOT NULL, -- Array of wallet addresses
  
  -- Socials
  farcaster VARCHAR(100),
  twitter VARCHAR(100),
  ens VARCHAR(255),
  
  -- Community contribution tracking
  added_by VARCHAR(64), -- wallet that added this trader
  added_by_ethos INTEGER DEFAULT 0, -- Ethos score at time of addition
  added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Status: 'nominated' -> 'approved' -> 'featured' or 'rejected'
  status VARCHAR(20) DEFAULT 'approved' CHECK (status IN ('nominated', 'approved', 'featured', 'rejected')),
  endorsement_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Analytics (updated periodically)
  avg_conviction_score INTEGER,
  total_analyses INTEGER DEFAULT 0,
  last_analyzed_at TIMESTAMP WITH TIME ZONE
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_watchlist_chain ON watchlist_traders(chain);
CREATE INDEX IF NOT EXISTS idx_watchlist_active ON watchlist_traders(is_active);
CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist_traders(status);
CREATE INDEX IF NOT EXISTS idx_watchlist_endorsements ON watchlist_traders(endorsement_count DESC);

-- Table: Endorsements for community nominations
CREATE TABLE IF NOT EXISTS watchlist_endorsements (
  id SERIAL PRIMARY KEY,
  trader_id VARCHAR(100) NOT NULL REFERENCES watchlist_traders(trader_id) ON DELETE CASCADE,
  endorser_address VARCHAR(64) NOT NULL,
  endorser_ethos INTEGER NOT NULL,
  endorsed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Prevent duplicate endorsements
  UNIQUE(trader_id, endorser_address)
);

CREATE INDEX IF NOT EXISTS idx_endorsements_trader ON watchlist_endorsements(trader_id);

-- Table: Alpha Leaderboard (top conviction wallets)
CREATE TABLE IF NOT EXISTS alpha_leaderboard (
  id SERIAL PRIMARY KEY,
  address VARCHAR(64) NOT NULL,
  chain VARCHAR(10) NOT NULL CHECK (chain IN ('solana', 'base')),
  
  -- Latest metrics
  conviction_score INTEGER NOT NULL,
  patience_tax DECIMAL(10,2),
  win_rate DECIMAL(5,2),
  archetype VARCHAR(50),
  total_positions INTEGER DEFAULT 0,
  
  -- Identity
  display_name VARCHAR(255),
  farcaster VARCHAR(100),
  ens VARCHAR(255),
  ethos_score INTEGER,
  unified_trust_score INTEGER,
  unified_trust_tier VARCHAR(20),

  -- Ranking
  rank INTEGER,
  previous_rank INTEGER,
  rank_change INTEGER GENERATED ALWAYS AS (COALESCE(previous_rank, rank) - rank) STORED,

  -- Timestamps
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(address, chain)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON alpha_leaderboard(conviction_score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_chain ON alpha_leaderboard(chain);
CREATE INDEX IF NOT EXISTS idx_leaderboard_ethos ON alpha_leaderboard(ethos_score DESC);

-- View: Aggregate stats for real cohort comparison
CREATE OR REPLACE VIEW cohort_stats AS
SELECT 
  chain,
  COUNT(DISTINCT address) as total_wallets,
  AVG(score) as avg_score,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score) as median_score,
  AVG(patience_tax) as avg_patience_tax,
  AVG(win_rate) as avg_win_rate,
  MODE() WITHIN GROUP (ORDER BY archetype) as most_common_archetype
FROM conviction_analyses
WHERE analyzed_at > NOW() - INTERVAL '90 days'
GROUP BY chain;

-- Table: Personal Watchlists (User-specific tracking)
CREATE TABLE IF NOT EXISTS personal_watchlists (
  id SERIAL PRIMARY KEY,
  user_address VARCHAR(64) NOT NULL, -- The user who is watching
  watched_address VARCHAR(64) NOT NULL, -- The wallet being watched
  chain VARCHAR(10) NOT NULL CHECK (chain IN ('solana', 'base')),
  
  -- Metadata snapshot (optional, can be refreshed)
  name VARCHAR(255),
  tags VARCHAR(100)[], -- e.g., ['whale', 'competitor']
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Prevent duplicate tracking of same wallet by same user
  UNIQUE(user_address, watched_address, chain)
);

CREATE INDEX IF NOT EXISTS idx_personal_watchlist_user ON personal_watchlists(user_address);

-- =============================================================================
-- Notification System (Phase 3: Social Signals)
-- =============================================================================

-- Table: Notification Subscriptions
CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id SERIAL PRIMARY KEY,
  user_address VARCHAR(64) NOT NULL,
  
  -- Channels
  email VARCHAR(255),
  telegram_chat_id VARCHAR(100),
  
  -- Preferences
  channels VARCHAR(20)[] DEFAULT ARRAY['in_app']::VARCHAR[], -- in_app, email, telegram
  min_trust_score INTEGER DEFAULT 65, -- Minimum trust score to trigger alerts
  min_cluster_size INTEGER DEFAULT 3, -- Minimum traders in cluster
  
  -- Filters (empty = all)
  chain_filter VARCHAR(10)[], -- e.g., ['solana', 'base'] or empty for all
  token_filter VARCHAR(64)[], -- Specific token addresses to watch
  
  -- Rate limiting
  max_alerts_per_hour INTEGER DEFAULT 10,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(user_address)
);

CREATE INDEX IF NOT EXISTS idx_notification_subs_active ON notification_subscriptions(is_active);

-- Table: Notification Deliveries (for idempotency and audit)
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id SERIAL PRIMARY KEY,
  user_address VARCHAR(64) NOT NULL,
  alert_id VARCHAR(255) NOT NULL, -- cluster:solana:tokenaddr:timestamp
  channel VARCHAR(20) NOT NULL, -- email, telegram, in_app
  
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'rate_limited')),
  error_message TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP WITH TIME ZONE,
  
  -- Prevent duplicate deliveries
  UNIQUE(user_address, alert_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON notification_deliveries(user_address);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries(status);

-- Table: Cluster Signals (persistent record for analytics)
CREATE TABLE IF NOT EXISTS cluster_signals (
  id SERIAL PRIMARY KEY,
  signal_id VARCHAR(255) NOT NULL UNIQUE, -- cluster:chain:token:bucket
  chain VARCHAR(10) NOT NULL CHECK (chain IN ('solana', 'base')),
  token_address VARCHAR(64) NOT NULL,
  token_symbol VARCHAR(50),
  
  cluster_size INTEGER NOT NULL,
  avg_trust_score INTEGER NOT NULL,
  unique_traders JSONB NOT NULL, -- Array of {walletAddress, traderId?, trustScore}
  
  window_minutes INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cluster_signals_chain ON cluster_signals(chain);
CREATE INDEX IF NOT EXISTS idx_cluster_signals_token ON cluster_signals(token_address);
CREATE INDEX IF NOT EXISTS idx_cluster_signals_created ON cluster_signals(created_at DESC);