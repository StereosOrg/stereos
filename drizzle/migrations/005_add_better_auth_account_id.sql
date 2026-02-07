-- Migration: Add accountId for Better Auth (required for sign-up/email)

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "accountId" text;

-- Backfill: use providerAccountId (or id) for existing rows
UPDATE "Account" SET "accountId" = "providerAccountId" WHERE "accountId" IS NULL;
UPDATE "Account" SET "accountId" = id WHERE "accountId" IS NULL OR "accountId" = '';

ALTER TABLE "Account" ALTER COLUMN "accountId" SET NOT NULL;
