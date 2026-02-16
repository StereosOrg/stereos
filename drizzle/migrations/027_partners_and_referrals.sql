-- Partners and Referrals tables with three tiers (Bronze, Silver, Gold)

DO $$ BEGIN
  CREATE TYPE partner_tier AS ENUM ('bronze', 'silver', 'gold');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE referral_status AS ENUM ('pending', 'converted', 'churned');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Partner" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  email text NOT NULL,
  partner_code text NOT NULL UNIQUE,
  tier partner_tier NOT NULL DEFAULT 'bronze',
  metadata jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Partner_partner_code_idx" ON "Partner"(partner_code);

CREATE TABLE IF NOT EXISTS "PartnerTierConfig" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tier partner_tier NOT NULL UNIQUE,
  min_conversions integer NOT NULL DEFAULT 0,
  commission_flat_usd decimal(10,2) NOT NULL DEFAULT 0,
  benefits jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- Seed tier config: Bronze $25, Silver $50, Gold $75 per conversion
INSERT INTO "PartnerTierConfig" (tier, min_conversions, commission_flat_usd, benefits)
VALUES
  ('bronze', 0, 25, '{"label": "Standard referral tracking"}'::jsonb),
  ('silver', 5, 50, '{"label": "Partner dashboard access"}'::jsonb),
  ('gold', 25, 75, '{"label": "Co-marketing, dedicated support"}'::jsonb)
ON CONFLICT (tier) DO NOTHING;

CREATE TABLE IF NOT EXISTS "Referral" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  partner_id text NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  customer_id text NOT NULL UNIQUE REFERENCES "Customer"(id) ON DELETE CASCADE,
  referred_at timestamptz NOT NULL DEFAULT NOW(),
  status referral_status NOT NULL DEFAULT 'pending',
  converted_at timestamptz,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Referral_partner_id_idx" ON "Referral"(partner_id);
