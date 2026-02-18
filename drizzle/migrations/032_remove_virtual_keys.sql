-- Migration 032: Remove virtual keys and teams, switch to direct Cloudflare Gateway

-- Drop AiGatewayKey table
DROP TABLE IF EXISTS "AiGatewayKey" CASCADE;

-- Drop team-related tables
DROP TABLE IF EXISTS "TeamMember" CASCADE;
DROP TABLE IF EXISTS "Team" CASCADE;

-- Remove team_id from users
ALTER TABLE "User" DROP COLUMN IF EXISTS "team_id";

-- Keep cf_gateway_id on Customer - we'll use this for direct gateway access
-- Keep customers, users, and basic auth infrastructure

-- Add provider_keys JSONB column to Customer for storing encrypted provider keys
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "provider_keys" jsonb DEFAULT '{}';

-- Update existing customers to have empty provider_keys
UPDATE "Customer" SET "provider_keys" = '{}' WHERE "provider_keys" IS NULL;
