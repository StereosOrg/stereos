-- Invites: admin invites new members to their workspace (customer)
CREATE TABLE IF NOT EXISTS "Invite" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  customer_id TEXT NOT NULL REFERENCES "Customer"(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS Invite_token_idx ON "Invite" (token);
CREATE INDEX IF NOT EXISTS Invite_customer_id_idx ON "Invite" (customer_id);
CREATE INDEX IF NOT EXISTS Invite_email_idx ON "Invite" (email);
