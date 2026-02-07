-- Migration: Create materialized view for events by title

CREATE MATERIALIZED VIEW IF NOT EXISTS provenance_events_by_title AS
SELECT 
  pe.title as user_title,
  u.first_name || ' ' || u.last_name as user_full_name,
  c.company_name,
  p.partner_id,
  COUNT(pe.id) as total_events,
  COUNT(DISTINCT DATE_TRUNC('day', pe.timestamp)) as active_days,
  COUNT(DISTINCT unnest(pe.files_written)) FILTER (WHERE pe.files_written IS NOT NULL AND array_length(pe.files_written, 1) > 0) as files_modified,
  MIN(pe.timestamp) as first_event,
  MAX(pe.timestamp) as last_event,
  DATE_TRUNC('month', pe.timestamp) as event_month
FROM "ProvenanceEvent" pe
JOIN "User" u ON pe.user_id = u.id
JOIN "Customer" c ON pe.customer_id = c.id
JOIN "Partner" p ON pe.partner_id = p.id
WHERE pe.title IS NOT NULL
GROUP BY pe.title, u.first_name, u.last_name, c.company_name, p.partner_id, DATE_TRUNC('month', pe.timestamp);

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_provenance_events_by_title_unique 
ON provenance_events_by_title(user_title, user_full_name, company_name, partner_id, event_month);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_provenance_events_by_title_title 
ON provenance_events_by_title(user_title);

CREATE INDEX IF NOT EXISTS idx_provenance_events_by_title_company 
ON provenance_events_by_title(company_name);

CREATE INDEX IF NOT EXISTS idx_provenance_events_by_title_month 
ON provenance_events_by_title(event_month);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_provenance_events_by_title()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY provenance_events_by_title;
END;
$$ LANGUAGE plpgsql;
