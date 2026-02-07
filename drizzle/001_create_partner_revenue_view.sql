-- Materialized View: Partner Sourced Revenue
-- Run this migration to create the view for partner revenue tracking

CREATE MATERIALIZED VIEW IF NOT EXISTS partner_sourced_revenue AS
SELECT
  p.id AS partner_id,
  p.name AS partner_name,
  p.partner_id AS partner_external_id,
  COUNT(DISTINCT ue.customer_id) AS total_customers,
  COUNT(ue.id) AS total_events,
  SUM(ue.quantity) AS total_units,
  SUM(ue.total_price) AS total_revenue,
  SUM(ue.total_price) * 0.20 AS partner_share, -- 20% revenue share
  DATE_TRUNC('month', ue.timestamp) AS billing_month
FROM "Partner" p
LEFT JOIN "UsageEvent" ue ON p.id = ue.partner_id
GROUP BY
  p.id,
  p.name,
  p.partner_id,
  DATE_TRUNC('month', ue.timestamp);

-- Indexes for the materialized view
CREATE INDEX IF NOT EXISTS idx_partner_sourced_revenue_partner_id 
  ON partner_sourced_revenue(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_sourced_revenue_month 
  ON partner_sourced_revenue(billing_month);

-- Function to refresh the materialized view concurrently
CREATE OR REPLACE FUNCTION refresh_partner_revenue_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY partner_sourced_revenue;
END;
$$ LANGUAGE plpgsql;
