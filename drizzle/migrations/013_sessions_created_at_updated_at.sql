-- Migration: Add createdAt/updatedAt to Session for Better Auth

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "createdAt" timestamp with time zone DEFAULT now();
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone;
