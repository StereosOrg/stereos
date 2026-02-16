-- Remove metadata and add audience_size, industry, type, image_url to Partner

DO $$ BEGIN
  CREATE TYPE partner_type AS ENUM ('Individual', 'Organization', 'Government Agency');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Partner" DROP COLUMN IF EXISTS metadata;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS audience_size integer;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS type partner_type;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS image_url text;
