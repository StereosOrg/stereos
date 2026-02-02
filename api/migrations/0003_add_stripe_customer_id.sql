-- Migration: Add Stripe customer ID to users table
-- This allows linking Stripe customers to our internal users

-- Add stripe_customer_id column to users table
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT UNIQUE;

-- Add index for quick lookups by Stripe customer ID
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

-- Add stripe_subscription_id to track active subscription
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
