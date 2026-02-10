-- Add user_id to ApiToken for user-scoped keys
ALTER TABLE "ApiToken" ADD COLUMN IF NOT EXISTS "user_id" text REFERENCES "User"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ApiToken_user_id_idx" ON "ApiToken" USING btree ("user_id");

-- Add user_id to TelemetrySpan, TelemetryLog, TelemetryMetric for attribution
ALTER TABLE "TelemetrySpan" ADD COLUMN IF NOT EXISTS "user_id" text REFERENCES "User"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "TelemetrySpan_user_id_idx" ON "TelemetrySpan" USING btree ("user_id");

ALTER TABLE "TelemetryLog" ADD COLUMN IF NOT EXISTS "user_id" text REFERENCES "User"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "TelemetryLog_user_id_idx" ON "TelemetryLog" USING btree ("user_id");

ALTER TABLE "TelemetryMetric" ADD COLUMN IF NOT EXISTS "user_id" text REFERENCES "User"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "TelemetryMetric_user_id_idx" ON "TelemetryMetric" USING btree ("user_id");
