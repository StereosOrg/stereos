-- Migration 033: Add provider_keys to Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "provider_keys" jsonb DEFAULT '{}';

-- Update existing customers to have empty provider_keys
UPDATE "Customer" SET "provider_keys" = '{}' WHERE "provider_keys" IS NULL;
