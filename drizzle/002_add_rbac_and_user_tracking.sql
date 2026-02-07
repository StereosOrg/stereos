-- Migration: Add RBAC and user tracking
-- Adds role column to users and user_id to provenance events

-- Add role column to users table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS role user_role DEFAULT 'user' NOT NULL;

-- Add user_id column to ProvenanceEvent table
ALTER TABLE "ProvenanceEvent" ADD COLUMN IF NOT EXISTS user_id text REFERENCES "User"(id) ON DELETE CASCADE;

-- Create index on user_id for ProvenanceEvent
CREATE INDEX IF NOT EXISTS "ProvenanceEvent_user_id_idx" ON "ProvenanceEvent"(user_id);

-- Update existing provenance events to link to users through customers
-- This is a one-time migration to backfill user_id from customer relationships
UPDATE "ProvenanceEvent" pe
SET user_id = c.user_id
FROM "Customer" c
WHERE pe.customer_id = c.id
  AND pe.user_id IS NULL;

-- Create view for user activity summary
CREATE OR REPLACE VIEW user_activity_summary AS
SELECT 
  u.id as user_id,
  u.email,
  u.name,
  u.role,
  COUNT(DISTINCT pe.id) as total_events,
  COUNT(DISTINCT DATE_TRUNC('day', pe.timestamp)) as active_days,
  MIN(pe.timestamp) as first_activity,
  MAX(pe.timestamp) as last_activity,
  SUM(CASE WHEN pe.files_written IS NOT NULL THEN array_length(pe.files_written, 1) ELSE 0 END) as files_modified
FROM "User" u
LEFT JOIN "ProvenanceEvent" pe ON u.id = pe.user_id
GROUP BY u.id, u.email, u.name, u.role;
