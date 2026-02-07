-- Migration: Default type/provider/providerId to 'credential' for email/password accounts

ALTER TABLE "Account" ALTER COLUMN "type" SET DEFAULT 'credential';
ALTER TABLE "Account" ALTER COLUMN "provider" SET DEFAULT 'credential';
ALTER TABLE "Account" ALTER COLUMN "providerId" SET DEFAULT 'credential';
