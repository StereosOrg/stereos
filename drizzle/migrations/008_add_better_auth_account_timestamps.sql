-- Migration: Add createdAt/updatedAt for Better Auth Account

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "createdAt" timestamp with time zone DEFAULT now();
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone;
