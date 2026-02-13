CREATE TABLE IF NOT EXISTS "Destination" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "customer_id" text NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "config" jsonb,
  "secret_ciphertext" text,
  "secret_iv" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_error" text,
  "last_success_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "Destination_customer_id_idx" ON "Destination" ("customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "Destination_customer_name_idx" ON "Destination" ("customer_id", "name");
CREATE INDEX IF NOT EXISTS "Destination_type_idx" ON "Destination" ("type");
