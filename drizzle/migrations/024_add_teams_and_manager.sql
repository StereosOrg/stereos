-- Add manager role to enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'manager'
  ) THEN
    ALTER TYPE user_role ADD VALUE 'manager';
  END IF;
END $$;

-- Teams table
CREATE TABLE IF NOT EXISTS "Team" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "customer_id" text NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "profile_pic" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "Team_customer_name_idx" ON "Team" ("customer_id", "name");
CREATE INDEX IF NOT EXISTS "Team_customer_id_idx" ON "Team" ("customer_id");

-- Team members
CREATE TABLE IF NOT EXISTS "TeamMember" (
  "team_id" text NOT NULL REFERENCES "Team"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now(),
  PRIMARY KEY ("team_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "TeamMember_user_id_idx" ON "TeamMember" ("user_id");

-- Add team_id to ApiToken
ALTER TABLE "ApiToken" ADD COLUMN IF NOT EXISTS "team_id" text REFERENCES "Team"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ApiToken_team_id_idx" ON "ApiToken" ("team_id");

-- Add team_id to telemetry tables
ALTER TABLE "TelemetrySpan" ADD COLUMN IF NOT EXISTS "team_id" text REFERENCES "Team"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "TelemetrySpan_team_id_idx" ON "TelemetrySpan" ("team_id");

ALTER TABLE "TelemetryMetric" ADD COLUMN IF NOT EXISTS "team_id" text REFERENCES "Team"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "TelemetryMetric_team_id_idx" ON "TelemetryMetric" ("team_id");
