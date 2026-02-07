-- Migration: Add providerId for Better Auth (required for sign-up/email)

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "providerId" text;

-- Backfill from provider
UPDATE "Account" SET "providerId" = "provider" WHERE "providerId" IS NULL;

ALTER TABLE "Account" ALTER COLUMN "providerId" SET NOT NULL;
