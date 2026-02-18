CREATE TABLE "GatewayEvent" (
  "id" text PRIMARY KEY NOT NULL,
  "customer_id" text NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "key_id" text NOT NULL REFERENCES "AiGatewayKey"("id") ON DELETE CASCADE,
  "key_hash" text NOT NULL,
  "user_id" text REFERENCES "User"("id") ON DELETE SET NULL,
  "team_id" text REFERENCES "Team"("id") ON DELETE SET NULL,
  "model" text NOT NULL,
  "provider" text NOT NULL,
  "prompt_tokens" integer DEFAULT 0 NOT NULL,
  "completion_tokens" integer DEFAULT 0 NOT NULL,
  "total_tokens" integer DEFAULT 0 NOT NULL,
  "status_code" integer NOT NULL,
  "duration_ms" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "GatewayEvent_customer_id_idx" ON "GatewayEvent" ("customer_id");
CREATE INDEX "GatewayEvent_key_id_idx" ON "GatewayEvent" ("key_id");
CREATE INDEX "GatewayEvent_user_id_idx" ON "GatewayEvent" ("user_id");
CREATE INDEX "GatewayEvent_team_id_idx" ON "GatewayEvent" ("team_id");
CREATE INDEX "GatewayEvent_created_at_idx" ON "GatewayEvent" ("created_at");

DROP TABLE "UsageEvent";
