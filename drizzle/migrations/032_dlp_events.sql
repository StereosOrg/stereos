-- Create DLP severity enum
DO $$ BEGIN
  CREATE TYPE "dlp_severity" AS ENUM ('flag', 'block');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create DlpEvent table
CREATE TABLE IF NOT EXISTS "DlpEvent" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" text NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "gateway_id" text NOT NULL,
  "request_id" text NOT NULL,
  "timestamp" timestamp with time zone NOT NULL,
  "model" text,
  "provider" text,
  "prompt_excerpt" text,
  "response_excerpt" text,
  "topic" text,
  "summary" text,
  "dlp_profile_matches" jsonb NOT NULL DEFAULT '[]',
  "severity" "dlp_severity" NOT NULL DEFAULT 'flag',
  "raw_payload" jsonb,
  "ingested_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "DlpEvent_customer_id_idx" ON "DlpEvent" ("customer_id");
CREATE INDEX IF NOT EXISTS "DlpEvent_timestamp_idx" ON "DlpEvent" ("timestamp");
CREATE INDEX IF NOT EXISTS "DlpEvent_gateway_id_idx" ON "DlpEvent" ("gateway_id");
CREATE INDEX IF NOT EXISTS "DlpEvent_customer_timestamp_idx" ON "DlpEvent" ("customer_id", "timestamp");
