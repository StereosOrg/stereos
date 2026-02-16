-- Add status enum column to Partner table

DO $$ BEGIN
  CREATE TYPE partner_status AS ENUM ('pending', 'active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add column if it doesn't exist, or alter its type if it does
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Partner' AND column_name = 'status'
  ) THEN
    ALTER TABLE "Partner" ADD COLUMN status partner_status NOT NULL DEFAULT 'pending';
  ELSE
    ALTER TABLE "Partner" ALTER COLUMN status TYPE partner_status USING status::partner_status;
    ALTER TABLE "Partner" ALTER COLUMN status SET DEFAULT 'pending';
    ALTER TABLE "Partner" ALTER COLUMN status SET NOT NULL;
  END IF;
END $$;
