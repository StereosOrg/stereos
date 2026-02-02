-- Stereos API Database Schema
-- Initial migration

-- Users table (simplified - in production, integrate with your auth system)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'scale')),
  monthly_quota INTEGER NOT NULL DEFAULT 10,
  used_this_month INTEGER NOT NULL DEFAULT 0,
  quota_reset_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_quota_reset ON api_keys(quota_reset_at);

-- Usage tracking table (for detailed analytics)
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('token_issued', 'conversion_started', 'conversion_completed', 'conversion_failed')),
  metadata TEXT, -- JSON blob for additional data
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_key ON usage_events(api_key_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
