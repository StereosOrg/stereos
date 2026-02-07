-- Migration: Drop redundant providerId column (Better Auth maps providerId -> provider via auth config)

ALTER TABLE "Account" DROP COLUMN IF EXISTS "providerId";
