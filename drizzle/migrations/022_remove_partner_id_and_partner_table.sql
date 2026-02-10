-- Remove all partner_id columns and the Partner table.

-- Drop materialized views that depend on Partner / partner_id
DROP MATERIALIZED VIEW IF EXISTS provenance_events_by_title;
DROP MATERIALIZED VIEW IF EXISTS partner_sourced_revenue;

-- Drop FK constraints first (IF EXISTS so we don't fail if already gone)
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_partner_id_Partner_id_fk";
ALTER TABLE "ProvenanceEvent" DROP CONSTRAINT IF EXISTS "ProvenanceEvent_partner_id_Partner_id_fk";
ALTER TABLE "UsageEvent" DROP CONSTRAINT IF EXISTS "UsageEvent_partner_id_Partner_id_fk";
ALTER TABLE "TelemetrySpan" DROP CONSTRAINT IF EXISTS "TelemetrySpan_partner_id_Partner_id_fk";
ALTER TABLE "ToolProfile" DROP CONSTRAINT IF EXISTS "ToolProfile_partner_id_Partner_id_fk";
ALTER TABLE "TelemetryMetric" DROP CONSTRAINT IF EXISTS "TelemetryMetric_partner_id_Partner_id_fk";

-- Drop partner_id column from all tables
ALTER TABLE "UsageEvent" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "ProvenanceEvent" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "ToolProfile" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "TelemetrySpan" DROP COLUMN IF EXISTS "partner_id";
ALTER TABLE "TelemetryMetric" DROP COLUMN IF EXISTS "partner_id";

-- Drop Partner table
DROP TABLE IF EXISTS "Partner";
