-- OpenRouter keys table: links OpenRouter API keys (provisioned via OpenRouter API) to Stereos customers/users/teams
DO $$ BEGIN
  CREATE TYPE openrouter_key_limit_reset AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "OpenRouterKey" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  customer_id text NOT NULL REFERENCES "Customer"(id) ON DELETE CASCADE,
  user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  team_id text REFERENCES "Team"(id) ON DELETE SET NULL,
  openrouter_key_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  limit_usd decimal(10,4),
  limit_reset openrouter_key_limit_reset,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  created_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "OpenRouterKey_customer_id_idx" ON "OpenRouterKey"(customer_id);
CREATE INDEX IF NOT EXISTS "OpenRouterKey_user_id_idx" ON "OpenRouterKey"(user_id);
CREATE INDEX IF NOT EXISTS "OpenRouterKey_team_id_idx" ON "OpenRouterKey"(team_id);
