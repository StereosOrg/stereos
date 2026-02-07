-- Migration: Add password for Better Auth (email/password auth)

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "password" text;
