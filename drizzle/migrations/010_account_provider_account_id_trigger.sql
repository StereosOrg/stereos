-- Migration: When providerAccountId is null on insert (credential accounts), set it from accountId

CREATE OR REPLACE FUNCTION set_provider_account_id_from_account_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."providerAccountId" IS NULL THEN
    NEW."providerAccountId" := NEW."accountId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS account_set_provider_account_id ON "Account";
CREATE TRIGGER account_set_provider_account_id
  BEFORE INSERT ON "Account"
  FOR EACH ROW
  EXECUTE PROCEDURE set_provider_account_id_from_account_id();
