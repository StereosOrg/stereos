-- Migration: Add ipAddress and userAgent to Session for Better Auth

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "ipAddress" text;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "userAgent" text;
