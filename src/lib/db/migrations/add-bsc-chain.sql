-- Migration: allow BSC chain in wallet-score + conviction analyses
-- Run in Neon dashboard after deploying the bsc wallet-score code.
-- Idempotent: drops the old CHECK then re-adds with 'bsc'.
ALTER TABLE IF EXISTS conviction_analyses DROP CONSTRAINT IF EXISTS conviction_analyses_chain_check;
ALTER TABLE IF EXISTS conviction_analyses ADD CHECK (chain IN ('solana', 'base', 'bsc'));
ALTER TABLE IF EXISTS analysis_positions DROP CONSTRAINT IF EXISTS analysis_positions_chain_check;
ALTER TABLE IF EXISTS analysis_positions ADD CHECK (chain IN ('solana', 'base', 'bsc'));
ALTER TABLE IF EXISTS watchlist_traders DROP CONSTRAINT IF EXISTS watchlist_traders_chain_check;
ALTER TABLE IF EXISTS watchlist_traders ADD CHECK (chain IN ('solana', 'base', 'bsc'));
ALTER TABLE IF EXISTS alpha_leaderboard DROP CONSTRAINT IF EXISTS alpha_leaderboard_chain_check;
ALTER TABLE IF EXISTS alpha_leaderboard ADD CHECK (chain IN ('solana', 'base', 'bsc'));
ALTER TABLE IF EXISTS personal_watchlists DROP CONSTRAINT IF EXISTS personal_watchlists_chain_check;
ALTER TABLE IF EXISTS personal_watchlists ADD CHECK (chain IN ('solana', 'base', 'bsc'));
ALTER TABLE IF EXISTS cluster_signals DROP CONSTRAINT IF EXISTS cluster_signals_chain_check;
ALTER TABLE IF EXISTS cluster_signals ADD CHECK (chain IN ('solana', 'base', 'bsc'));