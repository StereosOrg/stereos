import { Hono } from 'hono';
import { toolProfiles, telemetrySpans, telemetryMetrics, users } from '@stereos/shared/schema';
import { eq, and, desc, sql, gte, lte } from 'drizzle-orm';
import { authMiddleware, sessionOrTokenAuth } from '../lib/api-token.js';
import { getCurrentUser } from '../lib/middleware.js';
import type { ApiTokenPayload } from '../lib/api-token.js';
import { ingestOtelSpans } from '../lib/telemetry-ingest.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

/** Middleware: require trace ingest secret (Authorization: Bearer TRACE_INGEST_SECRET or OPENROUTER_BROADCAST_SECRET). */
async function traceIngestAuth(c: any, next: any) {
  const env = c.env ?? process.env;
  const secret = env?.TRACE_INGEST_SECRET ?? env?.OPENROUTER_BROADCAST_SECRET;
  if (!secret) {
    return c.json({ error: 'Trace ingest not configured' }, 503);
  }
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized - Missing Bearer token' }, 401);
  }
  const token = authHeader.substring(7).trim();
  if (token !== secret) {
    return c.json({ error: 'Unauthorized - Invalid token' }, 401);
  }
  return next();
}

// ── Pre-flight for OTLP trace ingestion ───────────────────────────────
router.on(['HEAD', 'OPTIONS'], '/traces', (c) => c.body(null, 200));

// ── OTLP Ingestion: Traces ───────────────────────────────────────────
// Endpoint: https://api.trystereos.com/v1/traces
// Headers: { "Authorization": "Bearer <TRACE_INGEST_SECRET>" }

router.post('/traces', traceIngestAuth, async (c) => {
  const db = c.get('db');

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const resourceSpans = body?.resourceSpans;
  if (!Array.isArray(resourceSpans)) {
    return c.json({ error: 'Missing resourceSpans array' }, 400);
  }

  try {
    const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
    const result = await ingestOtelSpans(db, body, stripeKey);
    return c.json({ partialSuccess: result });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// ── Read: Tool Profiles ─────────────────────────────────────────────────

router.get('/tool-profiles', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  const profiles = await db.query.toolProfiles.findMany({
    where: eq(toolProfiles.customer_id, customerId),
    orderBy: desc(toolProfiles.last_seen_at),
  });

  return c.json({ profiles });
});

router.get('/tool-profiles/:profileId', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const profileId = c.req.param('profileId');

  const profile = await db.query.toolProfiles.findFirst({
    where: and(eq(toolProfiles.id, profileId), eq(toolProfiles.customer_id, customerId)),
  });

  if (!profile) {
    return c.json({ error: 'Tool profile not found' }, 404);
  }

  // Compute latency percentiles from spans
  const latencyResult = await db.execute(sql`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99,
      avg(duration_ms) AS avg_latency
    FROM "TelemetrySpan"
    WHERE tool_profile_id = ${profileId}
      AND duration_ms IS NOT NULL
  `);

  const row = Array.isArray(latencyResult) ? latencyResult[0] : (latencyResult as { rows?: unknown[] })?.rows?.[0];
  const latency = {
    p50: Number((row as Record<string, unknown>)?.p50 ?? 0),
    p95: Number((row as Record<string, unknown>)?.p95 ?? 0),
    p99: Number((row as Record<string, unknown>)?.p99 ?? 0),
    avg: Number((row as Record<string, unknown>)?.avg_latency ?? 0),
  };

  return c.json({ profile, latency });
});

// Delete tool profile and all associated telemetry
router.delete('/tool-profiles/:profileId', sessionOrTokenAuth, async (c) => {
  const currentUser = await getCurrentUser(c as any);
  if (!currentUser || (currentUser as { role?: string }).role !== 'admin') {
    return c.json({ error: 'Forbidden - Admin access required' }, 403);
  }
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const profileId = c.req.param('profileId');

  const profile = await db.query.toolProfiles.findFirst({
    where: and(eq(toolProfiles.id, profileId), eq(toolProfiles.customer_id, customerId)),
    columns: { id: true },
  });
  if (!profile) {
    return c.json({ error: 'Tool profile not found' }, 404);
  }

  await db.delete(telemetrySpans).where(eq(telemetrySpans.tool_profile_id, profileId));
  await db.delete(telemetryMetrics).where(eq(telemetryMetrics.tool_profile_id, profileId));
  await db.delete(toolProfiles).where(eq(toolProfiles.id, profileId));

  return c.json({ success: true });
});

router.get('/tool-profiles/:profileId/spans', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const profileId = c.req.param('profileId');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  // Verify profile belongs to customer
  const profile = await db.query.toolProfiles.findFirst({
    where: and(eq(toolProfiles.id, profileId), eq(toolProfiles.customer_id, customerId)),
    columns: { id: true },
  });

  if (!profile) {
    return c.json({ error: 'Tool profile not found' }, 404);
  }

  const spans = await db.query.telemetrySpans.findMany({
    where: eq(telemetrySpans.tool_profile_id, profileId),
    orderBy: desc(telemetrySpans.start_time),
    limit,
    offset,
  });

  return c.json({ spans, limit, offset });
});

// GET /v1/spans - List spans (observability)
router.get('/spans', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const spans = await db.query.telemetrySpans.findMany({
    where: eq(telemetrySpans.customer_id, customerId),
    orderBy: desc(telemetrySpans.start_time),
    limit,
    offset,
    columns: {
      id: true,
      span_name: true,
      vendor: true,
      start_time: true,
      status_code: true,
      span_attributes: true,
      user_id: true,
      team_id: true,
    },
  });

  return c.json({ spans, limit, offset });
});

// GET /v1/spans/:spanId - Get a single span detail
router.get('/spans/:spanId', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const spanId = c.req.param('spanId');

  const span = await db.query.telemetrySpans.findFirst({
    where: and(eq(telemetrySpans.id, spanId), eq(telemetrySpans.customer_id, customerId)),
  });

  if (!span) return c.json({ error: 'Span not found' }, 404);
  return c.json({ span });
});

// GET /v1/dashboard - Summary stats from spans (auth)
router.get('/dashboard', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  const totalsResult = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_spans,
      COUNT(DISTINCT trace_id)::int AS total_traces,
      COUNT(DISTINCT vendor)::int AS active_sources
    FROM "TelemetrySpan"
    WHERE customer_id = ${customerId}
  `);
  const totalsRow = Array.isArray(totalsResult) ? totalsResult[0] : (totalsResult as { rows?: unknown[] })?.rows?.[0];

  // Get total AI spend from AiGatewayKey
  const spendResult = await db.execute(sql`
    SELECT COALESCE(SUM(spend_usd), 0)::numeric AS total_spend
    FROM "AiGatewayKey"
    WHERE customer_id = ${customerId}
  `);
  const spendRow = Array.isArray(spendResult) ? spendResult[0] : (spendResult as { rows?: unknown[] })?.rows?.[0];

  // Get active users count (users with spans in last 30 days)
  const activeUsersResult = await db.execute(sql`
    SELECT COUNT(DISTINCT COALESCE(user_id, span_attributes->>'user.id'))::int AS active_users
    FROM "TelemetrySpan"
    WHERE customer_id = ${customerId}
      AND start_time >= NOW() - INTERVAL '30 days'
  `);
  const activeUsersRow = Array.isArray(activeUsersResult) ? activeUsersResult[0] : (activeUsersResult as { rows?: unknown[] })?.rows?.[0];

  const recentSpans = await db.query.telemetrySpans.findMany({
    where: eq(telemetrySpans.customer_id, customerId),
    orderBy: desc(telemetrySpans.start_time),
    limit: 20,
    columns: {
      id: true,
      span_name: true,
      vendor: true,
      start_time: true,
      span_attributes: true,
      tool_profile_id: true,
      user_id: true,
    },
  });

  const recent = recentSpans.map((s) => ({
    id: s.id,
    intent: s.span_name,
    vendor: s.vendor,
    timestamp: s.start_time,
    tool_profile_id: s.tool_profile_id,
    model: (s.span_attributes as Record<string, string> | null)?.['gen_ai.request.model'] ?? (s.span_attributes as Record<string, string> | null)?.['gen_ai.response.model'] ?? null,
  }));

  const mostActiveResult = await db.execute(sql`
    SELECT COALESCE(user_id, span_attributes->>'user.id') AS user_id, COUNT(*)::int AS span_count
    FROM "TelemetrySpan"
    WHERE customer_id = ${customerId}
      AND (user_id IS NOT NULL OR span_attributes->>'user.id' IS NOT NULL)
      AND start_time >= NOW() - INTERVAL '30 days'
    GROUP BY COALESCE(user_id, span_attributes->>'user.id')
    ORDER BY span_count DESC
    LIMIT 1
  `);
  const mostRow = Array.isArray(mostActiveResult) ? mostActiveResult[0] : (mostActiveResult as { rows?: unknown[] })?.rows?.[0];
  let mostActiveUser: { id: string; name: string | null; email: string | null; span_count: number } | null = null;
  if (mostRow?.user_id) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, String(mostRow.user_id)),
      columns: { id: true, name: true, email: true },
    });
    mostActiveUser = {
      id: String(mostRow.user_id),
      name: user?.name ?? null,
      email: user?.email ?? null,
      span_count: Number(mostRow.span_count ?? 0),
    };
  }
  if (!mostActiveUser && apiToken.user_id) {
    const fallbackUser = await db.query.users.findFirst({
      where: eq(users.id, String(apiToken.user_id)),
      columns: { id: true, name: true, email: true },
    });
    mostActiveUser = {
      id: String(apiToken.user_id),
      name: fallbackUser?.name ?? null,
      email: fallbackUser?.email ?? null,
      span_count: 0,
    };
  }

  return c.json({
    total_spans: Number((totalsRow as Record<string, unknown>)?.total_spans ?? 0),
    total_traces: Number((totalsRow as Record<string, unknown>)?.total_traces ?? 0),
    active_sources: Number((totalsRow as Record<string, unknown>)?.active_sources ?? 0),
    total_spend: Number((spendRow as Record<string, unknown>)?.total_spend ?? 0),
    active_users: Number((activeUsersRow as Record<string, unknown>)?.active_users ?? 0),
    recent_spans: recent,
    most_active_user: mostActiveUser,
  });
});

// ── Read: Custom Metrics ────────────────────────────────────────────────

router.get('/tool-profiles/:profileId/metrics', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const profileId = c.req.param('profileId');

  const profile = await db.query.toolProfiles.findFirst({
    where: and(eq(toolProfiles.id, profileId), eq(toolProfiles.customer_id, customerId)),
    columns: { id: true },
  });

  if (!profile) {
    return c.json({ error: 'Tool profile not found' }, 404);
  }

  const metricsResult = await db.execute(sql`
    SELECT
      metric_name,
      metric_type,
      unit,
      value_double,
      value_int,
      count,
      sum,
      min,
      max,
      time
    FROM "TelemetryMetric"
    WHERE tool_profile_id = ${profileId}
    ORDER BY time DESC
    LIMIT 500
  `);

  const rows: MetricRow[] = Array.isArray(metricsResult)
    ? (metricsResult as MetricRow[])
    : ((metricsResult as unknown as { rows?: MetricRow[] })?.rows ?? []);

  const metricMap = new Map<string, { metric_name: string; metric_type: string; unit: string | null; last_value: number | null; last_time: string; datapoints: number }>();

  for (const row of rows) {
    const key = `${row.metric_name}::${row.metric_type}`;
    if (!metricMap.has(key)) {
      metricMap.set(key, {
        metric_name: row.metric_name,
        metric_type: row.metric_type,
        unit: row.unit || null,
        last_value: getMetricValue(row) ?? (row.sum != null ? Number(row.sum) : null),
        last_time: new Date(row.time).toISOString(),
        datapoints: 0,
      });
    }
    const entry = metricMap.get(key)!;
    entry.datapoints += 1;
  }

  return c.json({ metrics: Array.from(metricMap.values()) });
});

// ── Read: LLM Stats (gen_ai attributes) ─────────────────────────────────

type MetricRow = {
  metric_name: string;
  metric_type: string;
  unit: string | null;
  attributes: Record<string, string> | null;
  value_double: number | null;
  value_int: number | null;
  count: number | null;
  sum: number | null;
  bucket_counts: number[] | null;
  explicit_bounds: number[] | null;
  time: Date;
};

const REQUEST_COUNT_RE = /(gen_ai\.)?(request|requests)\.(count|total)|request_count|requests_total/i;
const ERROR_COUNT_RE = /(gen_ai\.)?(error|errors|failure|failed)\.(count|total)|error_count|errors_total/i;
const LATENCY_RE = /(latency|duration|response\.time)/i;
const TOKEN_INPUT_RE = /(gen_ai\.)?(usage\.)?input_tokens|token\.input|tokens\.input|input_tokens_total/i;
const TOKEN_OUTPUT_RE = /(gen_ai\.)?(usage\.)?output_tokens|token\.output|tokens\.output|output_tokens_total/i;

function getMetricValue(row: MetricRow): number | null {
  if (row.value_double != null) return Number(row.value_double);
  if (row.value_int != null) return Number(row.value_int);
  return null;
}

function getModelKey(attrs: Record<string, string> | null): string {
  return attrs?.['gen_ai.request.model'] || attrs?.['gen_ai.response.model'] || 'unknown';
}

function isRequestCountMetric(name: string): boolean {
  return REQUEST_COUNT_RE.test(name);
}

function isErrorCountMetric(name: string): boolean {
  return ERROR_COUNT_RE.test(name);
}

function isLatencyMetric(name: string): boolean {
  return LATENCY_RE.test(name);
}

function tokenMetricType(name: string, attrs: Record<string, string> | null): 'input' | 'output' | null {
  const attrType = (attrs?.['gen_ai.token.type'] || attrs?.['token.type'] || '').toLowerCase();
  if (attrType === 'input' || attrType === 'prompt') return 'input';
  if (attrType === 'output' || attrType === 'completion') return 'output';
  if (TOKEN_INPUT_RE.test(name)) return 'input';
  if (TOKEN_OUTPUT_RE.test(name)) return 'output';
  return null;
}

function toNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const nums = value.map((v) => Number(v));
  if (nums.some((v) => Number.isNaN(v))) return null;
  return nums;
}

function histogramPercentiles(rows: MetricRow[]) {
  let bounds: number[] | null = null;
  let buckets: number[] | null = null;
  let totalCount = 0;
  let totalSum = 0;

  for (const row of rows) {
    if (row.metric_type !== 'histogram') continue;
    const rowBounds = toNumberArray(row.explicit_bounds);
    const rowBuckets = toNumberArray(row.bucket_counts);
    if (!rowBounds || !rowBuckets) continue;
    if (!bounds) {
      bounds = rowBounds;
      buckets = new Array(rowBuckets.length).fill(0);
    }
    if (bounds.length !== rowBounds.length || buckets?.length !== rowBuckets.length) continue;

    for (let i = 0; i < rowBuckets.length; i++) {
      buckets![i] += rowBuckets[i];
    }
    totalCount += rowBuckets.reduce((sum, v) => sum + v, 0);
    if (row.sum != null) totalSum += Number(row.sum);
  }

  if (!bounds || !buckets || totalCount === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0 };
  }

  const percentile = (p: number) => {
    const target = totalCount * p;
    let cumulative = 0;
    for (let i = 0; i < buckets.length; i++) {
      cumulative += buckets[i];
      if (cumulative >= target) {
        return bounds[i] ?? bounds[bounds.length - 1];
      }
    }
    return bounds[bounds.length - 1];
  };

  const avg = totalCount > 0 ? totalSum / totalCount : 0;
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    avg,
  };
}

router.get('/tool-profiles/:profileId/llm-stats', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const profileId = c.req.param('profileId');

  // Verify profile belongs to customer and is an LLM vendor
  const profile = await db.query.toolProfiles.findFirst({
    where: and(eq(toolProfiles.id, profileId), eq(toolProfiles.customer_id, customerId)),
    columns: { id: true, vendor_category: true },
  });

  if (!profile) {
    return c.json({ error: 'Tool profile not found' }, 404);
  }

  const metricsResult = await db.execute(sql`
    SELECT
      metric_name,
      metric_type,
      unit,
      attributes,
      value_double,
      value_int,
      count,
      sum,
      bucket_counts,
      explicit_bounds,
      time
    FROM "TelemetryMetric"
    WHERE tool_profile_id = ${profileId}
      AND time >= ${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)}
    ORDER BY time ASC
  `);

  const metricsRows: MetricRow[] = Array.isArray(metricsResult)
    ? (metricsResult as MetricRow[])
    : ((metricsResult as unknown as { rows?: MetricRow[] })?.rows ?? []);

  if (metricsRows.length > 0) {
    const modelMap = new Map<string, { request_count: number; error_count: number; total_input_tokens: number; total_output_tokens: number; latency_sum: number; latency_count: number; last_used: string | null }>();
    const dailyMap = new Map<string, { request_count: number; input_tokens: number; output_tokens: number; error_count: number }>();
    const hourlyMap = new Map<string, { input_tokens: number; output_tokens: number; request_count: number; latency_sum: number; latency_count: number }>();
    const modelLatencyRows = new Map<string, MetricRow[]>();
    const overallLatencyRows: MetricRow[] = [];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalRequests = 0;
    let totalErrors = 0;

    for (const row of metricsRows) {
      const attrs = row.attributes || {};
      const model = getModelKey(attrs);
      const value = getMetricValue(row);
      const name = row.metric_name || '';
      const time = new Date(row.time);
      const dayKey = time.toISOString().slice(0, 10);
      const hourKey = time.toISOString().slice(0, 13);

      if (!modelMap.has(model)) {
        modelMap.set(model, { request_count: 0, error_count: 0, total_input_tokens: 0, total_output_tokens: 0, latency_sum: 0, latency_count: 0, last_used: null });
      }
      const modelEntry = modelMap.get(model)!;

      if (value != null && isRequestCountMetric(name)) {
        modelEntry.request_count += value;
        totalRequests += value;
        const day = dailyMap.get(dayKey) || { request_count: 0, input_tokens: 0, output_tokens: 0, error_count: 0 };
        day.request_count += value;
        dailyMap.set(dayKey, day);
      }

      if (value != null && isErrorCountMetric(name)) {
        modelEntry.error_count += value;
        totalErrors += value;
        const day = dailyMap.get(dayKey) || { request_count: 0, input_tokens: 0, output_tokens: 0, error_count: 0 };
        day.error_count += value;
        dailyMap.set(dayKey, day);
      }

      const tokenType = tokenMetricType(name, attrs);
      if (value != null && tokenType) {
        if (tokenType === 'input') {
          modelEntry.total_input_tokens += value;
          totalInputTokens += value;
          const day = dailyMap.get(dayKey) || { request_count: 0, input_tokens: 0, output_tokens: 0, error_count: 0 };
          day.input_tokens += value;
          dailyMap.set(dayKey, day);
          const hour = hourlyMap.get(hourKey) || { input_tokens: 0, output_tokens: 0, request_count: 0, latency_sum: 0, latency_count: 0 };
          hour.input_tokens += value;
          hourlyMap.set(hourKey, hour);
        } else {
          modelEntry.total_output_tokens += value;
          totalOutputTokens += value;
          const day = dailyMap.get(dayKey) || { request_count: 0, input_tokens: 0, output_tokens: 0, error_count: 0 };
          day.output_tokens += value;
          dailyMap.set(dayKey, day);
          const hour = hourlyMap.get(hourKey) || { input_tokens: 0, output_tokens: 0, request_count: 0, latency_sum: 0, latency_count: 0 };
          hour.output_tokens += value;
          hourlyMap.set(hourKey, hour);
        }
      }

      if (isLatencyMetric(name)) {
        if (row.metric_type === 'histogram') {
          overallLatencyRows.push(row);
          if (!modelLatencyRows.has(model)) modelLatencyRows.set(model, []);
          modelLatencyRows.get(model)!.push(row);
        } else if (value != null) {
          modelEntry.latency_sum += value;
          modelEntry.latency_count += 1;
        }
      }

      modelEntry.last_used = time.toISOString();
    }

    const latencyOverall = histogramPercentiles(overallLatencyRows);
    const avgDurationMs = latencyOverall.avg || 0;
    const totalTokens = totalInputTokens + totalOutputTokens;
    const avgTokensPerSec = avgDurationMs > 0 ? Number((totalTokens / (avgDurationMs / 1000)).toFixed(1)) : 0;

    const modelUsage = Array.from(modelMap.entries()).map(([model, data]) => ({
      model,
      request_count: Math.round(data.request_count),
      error_count: Math.round(data.error_count),
      avg_latency_ms: data.latency_count > 0 ? Math.round(data.latency_sum / data.latency_count) : 0,
      total_input_tokens: Math.round(data.total_input_tokens),
      total_output_tokens: Math.round(data.total_output_tokens),
      last_used: data.last_used || new Date().toISOString(),
    }));

    const dailyUsage = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, data]) => ({
        day,
        request_count: Math.round(data.request_count),
        input_tokens: Math.round(data.input_tokens),
        output_tokens: Math.round(data.output_tokens),
        error_count: Math.round(data.error_count),
      }));

    const hourlyTokens = Array.from(hourlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, data]) => ({
        hour,
        input_tokens: Math.round(data.input_tokens),
        output_tokens: Math.round(data.output_tokens),
        request_count: Math.round(data.request_count),
        avg_latency_ms: data.latency_count > 0 ? Math.round(data.latency_sum / data.latency_count) : 0,
      }));

    const modelLatency = Array.from(modelLatencyRows.entries()).map(([model, rows]) => {
      const percentiles = histogramPercentiles(rows);
      return {
        model,
        p50: Math.round(percentiles.p50),
        p95: Math.round(percentiles.p95),
        p99: Math.round(percentiles.p99),
        avg_ms: Math.round(percentiles.avg),
        min_ms: 0,
        max_ms: 0,
      };
    });

    return c.json({
      modelUsage,
      dailyUsage,
      hourlyTokens,
      modelLatency,
      topOperations: [],
      totals: {
        totalInputTokens: Math.round(totalInputTokens),
        totalOutputTokens: Math.round(totalOutputTokens),
        distinctModels: modelMap.size,
        avgDurationMs: Math.round(avgDurationMs),
        avgTokensPerSec,
        requestCount: Math.round(totalRequests),
        errorCount: Math.round(totalErrors),
      },
    });
  }

  // Aggregate model usage from span_attributes
  const modelUsageResult = await db.execute(sql`
    SELECT
      COALESCE(span_attributes->>'gen_ai.request.model', span_attributes->>'gen_ai.response.model', 'unknown') AS model,
      count(*)::int AS request_count,
      count(*) FILTER (WHERE status_code = 'ERROR')::int AS error_count,
      avg(duration_ms)::int AS avg_latency_ms,
      sum(COALESCE((span_attributes->>'gen_ai.usage.input_tokens')::int, 0))::bigint AS total_input_tokens,
      sum(COALESCE((span_attributes->>'gen_ai.usage.output_tokens')::int, 0))::bigint AS total_output_tokens,
      max(start_time) AS last_used
    FROM "TelemetrySpan"
    WHERE tool_profile_id = ${profileId}
    GROUP BY COALESCE(span_attributes->>'gen_ai.request.model', span_attributes->>'gen_ai.response.model', 'unknown')
    ORDER BY request_count DESC
  `);

  // Aggregate daily token usage for the chart
  const dailyUsageResult = await db.execute(sql`
    SELECT
      date_trunc('day', start_time) AS day,
      count(*)::int AS request_count,
      sum(COALESCE((span_attributes->>'gen_ai.usage.input_tokens')::int, 0))::bigint AS input_tokens,
      sum(COALESCE((span_attributes->>'gen_ai.usage.output_tokens')::int, 0))::bigint AS output_tokens,
      count(*) FILTER (WHERE status_code = 'ERROR')::int AS error_count
    FROM "TelemetrySpan"
    WHERE tool_profile_id = ${profileId}
      AND start_time >= ${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)}
    GROUP BY date_trunc('day', start_time)
    ORDER BY day ASC
  `);

  // Aggregate totals
  const totalsResult = await db.execute(sql`
    SELECT
      sum(COALESCE((span_attributes->>'gen_ai.usage.input_tokens')::int, 0))::bigint AS total_input_tokens,
      sum(COALESCE((span_attributes->>'gen_ai.usage.output_tokens')::int, 0))::bigint AS total_output_tokens,
      count(DISTINCT span_attributes->>'gen_ai.request.model') FILTER (WHERE span_attributes->>'gen_ai.request.model' IS NOT NULL)::int AS distinct_models,
      count(*)::int AS request_count,
      count(*) FILTER (WHERE status_code = 'ERROR')::int AS error_count,
      avg(duration_ms)::int AS avg_duration_ms,
      avg(COALESCE((span_attributes->>'gen_ai.usage.output_tokens')::float, 0) /
        NULLIF(duration_ms::float / 1000.0, 0))::numeric(10,1) AS avg_tokens_per_sec
    FROM "TelemetrySpan"
    WHERE tool_profile_id = ${profileId}
  `);

  // Hourly token throughput (last 24h)
  const hourlyTokensResult = await db.execute(sql`
    SELECT
      date_trunc('hour', start_time) AS hour,
      sum(COALESCE((span_attributes->>'gen_ai.usage.input_tokens')::int, 0))::bigint AS input_tokens,
      sum(COALESCE((span_attributes->>'gen_ai.usage.output_tokens')::int, 0))::bigint AS output_tokens,
      count(*)::int AS request_count,
      avg(duration_ms)::int AS avg_latency_ms
    FROM "TelemetrySpan"
    WHERE tool_profile_id = ${profileId}
      AND start_time >= ${new Date(Date.now() - 24 * 60 * 60 * 1000)}
    GROUP BY date_trunc('hour', start_time)
    ORDER BY hour ASC
  `);

  // Per-model latency percentiles
  const modelLatencyResult = await db.execute(sql`
    SELECT
      COALESCE(span_attributes->>'gen_ai.request.model', span_attributes->>'gen_ai.response.model', 'unknown') AS model,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::int AS p99,
      avg(duration_ms)::int AS avg_ms,
      min(duration_ms)::int AS min_ms,
      max(duration_ms)::int AS max_ms
    FROM "TelemetrySpan"
    WHERE tool_profile_id = ${profileId}
      AND duration_ms IS NOT NULL
    GROUP BY COALESCE(span_attributes->>'gen_ai.request.model', span_attributes->>'gen_ai.response.model', 'unknown')
    ORDER BY avg(duration_ms) DESC
  `);

  // Top span operations
  const topOperationsResult = await db.execute(sql`
    SELECT
      span_name,
      count(*)::int AS call_count,
      avg(duration_ms)::int AS avg_latency_ms,
      count(*) FILTER (WHERE status_code = 'ERROR')::int AS error_count,
      sum(COALESCE((span_attributes->>'gen_ai.usage.input_tokens')::int, 0))::bigint AS total_input_tokens,
      sum(COALESCE((span_attributes->>'gen_ai.usage.output_tokens')::int, 0))::bigint AS total_output_tokens
    FROM "TelemetrySpan"
    WHERE tool_profile_id = ${profileId}
    GROUP BY span_name
    ORDER BY call_count DESC
    LIMIT 10
  `);

  const modelUsage = Array.isArray(modelUsageResult) ? modelUsageResult : (modelUsageResult as { rows?: unknown[] })?.rows ?? [];
  const dailyUsage = Array.isArray(dailyUsageResult) ? dailyUsageResult : (dailyUsageResult as { rows?: unknown[] })?.rows ?? [];
  const totalsRow = Array.isArray(totalsResult) ? totalsResult[0] : (totalsResult as { rows?: unknown[] })?.rows?.[0];
  const hourlyTokens = Array.isArray(hourlyTokensResult) ? hourlyTokensResult : (hourlyTokensResult as { rows?: unknown[] })?.rows ?? [];
  const modelLatency = Array.isArray(modelLatencyResult) ? modelLatencyResult : (modelLatencyResult as { rows?: unknown[] })?.rows ?? [];
  const topOperations = Array.isArray(topOperationsResult) ? topOperationsResult : (topOperationsResult as { rows?: unknown[] })?.rows ?? [];

  return c.json({
    modelUsage,
    dailyUsage,
    hourlyTokens,
    modelLatency,
    topOperations,
    totals: {
      totalInputTokens: Number((totalsRow as Record<string, unknown>)?.total_input_tokens ?? 0),
      totalOutputTokens: Number((totalsRow as Record<string, unknown>)?.total_output_tokens ?? 0),
      distinctModels: Number((totalsRow as Record<string, unknown>)?.distinct_models ?? 0),
      avgDurationMs: Number((totalsRow as Record<string, unknown>)?.avg_duration_ms ?? 0),
      avgTokensPerSec: Number((totalsRow as Record<string, unknown>)?.avg_tokens_per_sec ?? 0),
      requestCount: Number((totalsRow as Record<string, unknown>)?.request_count ?? 0),
      errorCount: Number((totalsRow as Record<string, unknown>)?.error_count ?? 0),
    },
  });
});

router.get('/tool-profiles/:profileId/timeline', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const profileId = c.req.param('profileId');

  // Verify profile belongs to customer
  const profile = await db.query.toolProfiles.findFirst({
    where: and(eq(toolProfiles.id, profileId), eq(toolProfiles.customer_id, customerId)),
    columns: { id: true },
  });

  if (!profile) {
    return c.json({ error: 'Tool profile not found' }, 404);
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT
      date_trunc('hour', start_time) AS hour,
      count(*)::int AS span_count,
      count(*) FILTER (WHERE status_code = 'ERROR')::int AS error_count,
      avg(duration_ms)::int AS avg_latency_ms
    FROM "TelemetrySpan"
    WHERE tool_profile_id = ${profileId}
      AND start_time >= ${since}
    GROUP BY date_trunc('hour', start_time)
    ORDER BY hour ASC
  `);

  const buckets = Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows ?? [];

  return c.json({ buckets });
});

export default router;
