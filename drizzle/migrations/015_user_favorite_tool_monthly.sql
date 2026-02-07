-- Materialized view: most-used tool per user per month (from ProvenanceEvent)
CREATE MATERIALIZED VIEW IF NOT EXISTS "UserFavoriteToolMonthly" AS
WITH counts AS (
  SELECT
    user_id,
    tool,
    DATE_TRUNC('month', timestamp) AS month,
    COUNT(*) AS cnt
  FROM "ProvenanceEvent"
  WHERE user_id IS NOT NULL
  GROUP BY user_id, tool, DATE_TRUNC('month', timestamp)
),
ranked AS (
  SELECT
    user_id,
    month,
    tool,
    cnt,
    ROW_NUMBER() OVER (PARTITION BY user_id, month ORDER BY cnt DESC) AS rn
  FROM counts
)
SELECT
  user_id,
  month,
  tool AS favorite_tool,
  cnt AS event_count
FROM ranked
WHERE rn = 1;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorite_tool_monthly_user_month
ON "UserFavoriteToolMonthly" (user_id, month);

-- Index for lookups by user_id + current month
CREATE INDEX IF NOT EXISTS idx_user_favorite_tool_monthly_month
ON "UserFavoriteToolMonthly" (month);

-- Populate the view (run once after creation; for updates run: REFRESH MATERIALIZED VIEW CONCURRENTLY "UserFavoriteToolMonthly")
REFRESH MATERIALIZED VIEW "UserFavoriteToolMonthly";
