-- Migration: Replace VerificationToken with Verification table
-- Better Auth with usePlural:true expects a "Verification" table (model: "verifications")
-- The old VerificationToken table used Auth.js conventions that don't match Better Auth

-- Drop the old table if it exists
DROP TABLE IF EXISTS "VerificationToken";

-- Create the new Verification table matching Better Auth's expected schema
CREATE TABLE IF NOT EXISTS "Verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now(),
  "updatedAt" timestamp with time zone
);
