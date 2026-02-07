-- Migration: Drop providerAccountId; use accountId only (Better Auth maps providerAccountId -> accountId)

DROP INDEX IF EXISTS "Account_provider_providerAccountId";
ALTER TABLE "Account" DROP COLUMN IF EXISTS "providerAccountId";
CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_accountId" ON "Account"("provider", "accountId");
