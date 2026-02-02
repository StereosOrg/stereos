-- Migration: Simplify API Keys for Paid Integration
-- Removes tier/quota system and usage tracking

-- Step 1: Add new active/inactive columns first
ALTER TABLE api_keys ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE api_keys ADD COLUMN deactivated_at INTEGER;

-- Step 2: Migrate revoked keys to inactive status
UPDATE api_keys SET is_active = 0, deactivated_at = revoked_at WHERE revoked_at IS NOT NULL;

-- Step 3: Drop indexes BEFORE dropping their columns
DROP INDEX IF EXISTS idx_api_keys_quota_reset;

-- Step 4: Drop old quota/tier columns
ALTER TABLE api_keys DROP COLUMN tier;
ALTER TABLE api_keys DROP COLUMN monthly_quota;
ALTER TABLE api_keys DROP COLUMN used_this_month;
ALTER TABLE api_keys DROP COLUMN quota_reset_at;
ALTER TABLE api_keys DROP COLUMN revoked_at;

-- Step 5: Add new index for active status
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- Step 6: Drop usage tracking table (no longer needed)
DROP INDEX IF EXISTS idx_usage_events_key;
DROP INDEX IF EXISTS idx_usage_events_created;
DROP TABLE IF EXISTS usage_events;
