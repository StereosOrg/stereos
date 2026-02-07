-- Invited users join the same workspace (Customer) via membership; no separate Customer row per invite
CREATE TABLE IF NOT EXISTS "CustomerMember" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  customer_id TEXT NOT NULL REFERENCES "Customer"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES "User"(id) ON DELETE CASCADE,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  onboarding_completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS CustomerMember_customer_id_idx ON "CustomerMember" (customer_id);
CREATE INDEX IF NOT EXISTS CustomerMember_user_id_idx ON "CustomerMember" (user_id);
