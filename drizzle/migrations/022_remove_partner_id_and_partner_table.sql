-- Remove all partner_id columns and the Partner table.

-- Drop materialized views that depend on Partner / partner_id
DROP MATERIALIZED VIEW IF EXISTS provenance_events_by_title;
DROP MATERIALIZED VIEW IF EXISTS partner_sourced_revenue;

-- Drop partner_id column from all tables (drops FK automatically)
ALTER TABLE "UsageEvent" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "ProvenanceEvent" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "ToolProfile" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "TelemetrySpan" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "TelemetryMetric" DROP COLUMN IF EXISTS "partner_id";

-- Drop Partner table
DROP TABLE IF EXISTS "Partner";
