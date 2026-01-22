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
