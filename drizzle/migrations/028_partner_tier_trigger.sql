-- Trigger: when a referral is inserted or updated (status -> converted),
-- recalculate the partner's tier and update it.

CREATE OR REPLACE FUNCTION partner_evaluate_tier()
RETURNS TRIGGER AS $$
DECLARE
  p_id text;
  conv_count integer;
  new_tier partner_tier;
  cfg record;
BEGIN
  -- Get partner_id: from NEW (insert/update on Referral)
  p_id := COALESCE(NEW.partner_id, OLD.partner_id);
  IF p_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Count converted referrals for this partner
  SELECT COUNT(*)::integer INTO conv_count
  FROM "Referral"
  WHERE partner_id = p_id AND status = 'converted';

  -- Find highest tier the partner qualifies for (order: gold > silver > bronze)
  SELECT t.tier INTO new_tier
  FROM "PartnerTierConfig" t
  WHERE t.min_conversions <= conv_count
  ORDER BY
    CASE t.tier WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 ELSE 1 END DESC
  LIMIT 1;

  -- Default to bronze if no config matches
  IF new_tier IS NULL THEN
    new_tier := 'bronze';
  END IF;

  -- Update partner tier
  UPDATE "Partner"
  SET tier = new_tier, updated_at = NOW()
  WHERE id = p_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS referral_tier_trigger ON "Referral";
CREATE TRIGGER referral_tier_trigger
  AFTER INSERT OR UPDATE OF status
  ON "Referral"
  FOR EACH ROW
  EXECUTE PROCEDURE partner_evaluate_tier();
