ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DROP INDEX IF EXISTS "Team_customer_name_idx";
CREATE UNIQUE INDEX "Team_customer_name_idx" ON "Team" (customer_id, name) WHERE archived_at IS NULL;
