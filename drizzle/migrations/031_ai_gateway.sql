-- Add cf_gateway_id to Customer (idempotent)
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "cf_gateway_id" text UNIQUE;

-- Create budget reset enum
DO $$ BEGIN
  CREATE TYPE "ai_gateway_key_budget_reset" AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create AiGatewayKey table
CREATE TABLE IF NOT EXISTS "AiGatewayKey" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" text NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "user_id" text REFERENCES "User"("id") ON DELETE SET NULL,
  "team_id" text REFERENCES "Team"("id") ON DELETE SET NULL,
  "key_hash" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "budget_usd" numeric(10, 4),
  "budget_reset" "ai_gateway_key_budget_reset",
  "spend_usd" numeric(10, 4) NOT NULL DEFAULT '0',
  "spend_reset_at" timestamp with time zone,
  "allowed_models" jsonb,
  "disabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "AiGatewayKey_customer_id_idx" ON "AiGatewayKey" ("customer_id");
CREATE INDEX IF NOT EXISTS "AiGatewayKey_user_id_idx" ON "AiGatewayKey" ("user_id");
CREATE INDEX IF NOT EXISTS "AiGatewayKey_team_id_idx" ON "AiGatewayKey" ("team_id");

-- Drop OpenRouter tables
DROP TABLE IF EXISTS "OpenRouterKey" CASCADE;
DROP TYPE IF EXISTS "openrouter_key_limit_reset";
