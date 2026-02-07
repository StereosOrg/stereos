-- Recreate UserFavoriteToolMonthly to use actor_id (product: Cursor, cursor-v1, etc.)
-- instead of tool (which can be intent like "refactor").
DROP MATERIALIZED VIEW IF EXISTS "UserFavoriteToolMonthly";

CREATE MATERIALIZED VIEW "UserFavoriteToolMonthly" AS
WITH counts AS (
  SELECT
    user_id,
    actor_id,
    DATE_TRUNC('month', timestamp) AS month,
    COUNT(*) AS cnt
  FROM "ProvenanceEvent"
  WHERE user_id IS NOT NULL
  GROUP BY user_id, actor_id, DATE_TRUNC('month', timestamp)
),
ranked AS (
  SELECT
    user_id,
    month,
    actor_id,
    cnt,
    ROW_NUMBER() OVER (PARTITION BY user_id, month ORDER BY cnt DESC) AS rn
  FROM counts
)
SELECT
  user_id,
  month,
  actor_id AS favorite_tool,
  cnt AS event_count
FROM ranked
WHERE rn = 1;

CREATE UNIQUE INDEX idx_user_favorite_tool_monthly_user_month
ON "UserFavoriteToolMonthly" (user_id, month);

CREATE INDEX idx_user_favorite_tool_monthly_month
ON "UserFavoriteToolMonthly" (month);

REFRESH MATERIALIZED VIEW "UserFavoriteToolMonthly";
