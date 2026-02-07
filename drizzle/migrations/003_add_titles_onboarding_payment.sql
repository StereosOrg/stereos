-- Migration: Add user titles, onboarding fields, and payment tracking

-- Add user title enum
CREATE TYPE user_title AS ENUM ('engineer', 'manager', 'cto', 'founder', 'vp', 'lead', 'architect', 'product_manager');

-- Add columns to users table
ALTER TABLE "User" 
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS title user_title DEFAULT 'engineer';

-- Add columns to customers table
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS payment_info_provided boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_link_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;

-- Add title column to ProvenanceEvent
ALTER TABLE "ProvenanceEvent"
  ADD COLUMN IF NOT EXISTS title text;

-- Create index on title column
CREATE INDEX IF NOT EXISTS "ProvenanceEvent_title_idx" ON "ProvenanceEvent"(title);

-- Create index on customer payment status
CREATE INDEX IF NOT EXISTS "Customer_payment_info_idx" ON "Customer"(payment_info_provided) WHERE payment_info_provided = false;

-- Create index on customer onboarding status
CREATE INDEX IF NOT EXISTS "Customer_onboarding_idx" ON "Customer"(onboarding_completed) WHERE onboarding_completed = false;
