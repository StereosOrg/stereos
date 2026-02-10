import { Hono } from 'hono';
import { toolProfiles, telemetrySpans, telemetryLogs, telemetryMetrics } from '@stereos/shared/schema';
import { eq, and, desc, sql, gte, lte } from 'drizzle-orm';
import { authMiddleware, sessionOrTokenAuth } from '../lib/api-token.js';
import type { ApiTokenPayload } from '../lib/api-token.js';
import { canonicalizeVendor, flattenOtelAttributes } from '../lib/vendor-map.js';
import { trackUsage } from '../lib/stripe.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

// ── Pre-flight for Cloudflare Observability Destinations ─────────────────
// Cloudflare probes the endpoint with GET/HEAD/OPTIONS before saving; OTLP is POST-only.
// Returning 200 for these methods allows the destination to be created.
// Use router.on() so HEAD/OPTIONS work in Workers (router.head may be missing in bundle).

router.on(['HEAD', 'OPTIONS'], '/traces', (c) => c.body(null, 200));
router.on(['HEAD', 'OPTIONS'], '/logs', (c) => c.body(null, 200));
router.on(['HEAD', 'OPTIONS'], '/metrics', (c) => c.body(null, 200));

// ── OTLP Ingestion: Traces ──────────────────────────────────────────────

router.post('/traces', authMiddleware, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');

  const customerId = apiToken.customer.id;
  const userId = apiToken.user_id ?? apiToken.customer?.user_id ?? null;

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

  let totalInserted = 0;
  let totalErrors = 0;
  const traceIds = new Set<string>();

  for (const rs of resourceSpans) {
    const resourceAttrs = flattenOtelAttributes(rs.resource?.attributes);
    const vendor = canonicalizeVendor(resourceAttrs);
    const serviceName = resourceAttrs['service.name'] || null;

    // Upsert ToolProfile
    const now = new Date();
    const scopeSpans = rs.scopeSpans || [];
    let spanCount = 0;
    let errorCount = 0;

    const spanRows: Array<typeof telemetrySpans.$inferInsert> = [];

    for (const ss of scopeSpans) {
      const spans = ss.spans || [];
      for (const span of spans) {
        spanCount++;
        const spanAttrs = flattenOtelAttributes(span.attributes);
        const startNano = span.startTimeUnixNano ? BigInt(span.startTimeUnixNano) : BigInt(0);
        const endNano = span.endTimeUnixNano ? BigInt(span.endTimeUnixNano) : BigInt(0);
        const startTime = new Date(Number(startNano / BigInt(1_000_000)));
        const endTime = endNano ? new Date(Number(endNano / BigInt(1_000_000))) : null;
        const durationMs = endNano && startNano ? Number((endNano - startNano) / BigInt(1_000_000)) : null;
        const statusCode = span.status?.code === 2 ? 'ERROR' : span.status?.code === 1 ? 'OK' : 'UNSET';
        if (statusCode === 'ERROR') errorCount++;

        const traceId = span.traceId || '';
        traceIds.add(traceId);

        // Map span kind number to string
        const SPAN_KINDS = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];
        const spanKind = SPAN_KINDS[span.kind ?? 0] || 'UNSPECIFIED';

        spanRows.push({
          customer_id: customerId,
          user_id: userId,
          trace_id: traceId,
          span_id: span.spanId || '',
          parent_span_id: span.parentSpanId || null,
          span_name: span.name || 'unknown',
          span_kind: spanKind,
          start_time: startTime,
          end_time: endTime,
          duration_ms: durationMs,
          status_code: statusCode,
          status_message: span.status?.message || null,
          vendor: vendor.slug,
          service_name: serviceName,
          resource_attributes: resourceAttrs,
          span_attributes: spanAttrs,
          signal_type: 'trace',
        });
      }
    }

    if (spanRows.length === 0) continue;

    const [profile] = await db
      .insert(toolProfiles)
      .values({
        customer_id: customerId,
        vendor: vendor.slug,
        display_name: vendor.displayName,
        vendor_category: vendor.category,
        total_spans: spanCount,
        total_traces: traceIds.size,
        total_errors: errorCount,
        first_seen_at: now,
        last_seen_at: now,
      })
      .onConflictDoUpdate({
        target: [toolProfiles.customer_id, toolProfiles.vendor],
        set: {
          display_name: vendor.displayName,
          vendor_category: vendor.category,
          total_spans: sql`"ToolProfile"."total_spans" + ${spanCount}`,
          total_traces: sql`"ToolProfile"."total_traces" + ${traceIds.size}`,
          total_errors: sql`"ToolProfile"."total_errors" + ${errorCount}`,
          last_seen_at: now,
          updated_at: now,
        },
      })
      .returning({ id: toolProfiles.id });

    for (const row of spanRows) {
      row.tool_profile_id = profile.id;
    }
    await db.insert(telemetrySpans).values(spanRows);
    totalInserted += spanRows.length;
    totalErrors += errorCount;
  }

  // Track usage
  const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
  if (totalInserted > 0) {
    await trackUsage(db, customerId, 'telemetry_span', totalInserted, {
      trace_count: traceIds.size,
    }, stripeKey);
  }

  return c.json({ partialSuccess: { rejectedSpans: 0, acceptedSpans: totalInserted } });
});

// ── OTLP Ingestion: Logs ────────────────────────────────────────────────

router.post('/logs', authMiddleware, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');

  const customerId = apiToken.customer.id;
  const userId = apiToken.user_id ?? apiToken.customer?.user_id ?? null;

  const contentType = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType === 'application/x-protobuf' || contentType === 'application/protobuf') {
    return c.json(
      {
        error: 'OTLP binary protobuf is not supported',
        hint: 'This endpoint accepts JSON only. Configure your OTLP exporter to use JSON encoding (e.g. protocol "http" with JSON, or Content-Type: application/json).',
      },
      415
    );
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: 'Invalid JSON body',
        hint: 'Body must be JSON. If your exporter sends binary protobuf, configure it to use JSON encoding.',
      },
      400
    );
  }

  const resourceLogs = body?.resourceLogs ?? body?.resource_logs;
  if (!Array.isArray(resourceLogs)) {
    return c.json({ error: 'Missing resourceLogs array', hint: 'OTLP JSON expects root key "resourceLogs".' }, 400);
  }

  let totalInserted = 0;

  for (const rl of resourceLogs) {
    const resourceAttrs = flattenOtelAttributes(rl.resource?.attributes);
    const vendor = canonicalizeVendor(resourceAttrs);
    const serviceName = resourceAttrs['service.name'] || null;

    const logRows: Array<typeof telemetryLogs.$inferInsert> = [];
    const spanRows: Array<typeof telemetrySpans.$inferInsert> = [];
    const traceIds = new Set<string>();
    let errorCount = 0;
    let logErrorCount = 0;

    const scopeLogs = rl.scopeLogs || [];
    for (const sl of scopeLogs) {
      const logRecords = sl.logRecords || [];
      for (const lr of logRecords) {
        const SEVERITY_MAP: Record<number, string> = { 1: 'TRACE', 5: 'DEBUG', 9: 'INFO', 13: 'WARN', 17: 'ERROR', 21: 'FATAL' };
        const severity = SEVERITY_MAP[lr.severityNumber] || lr.severityText || 'INFO';
        const tsNano = lr.timeUnixNano ? BigInt(lr.timeUnixNano) : BigInt(Date.now() * 1_000_000);
        const timestamp = new Date(Number(tsNano / BigInt(1_000_000)));
        const logAttrs = flattenOtelAttributes(lr.attributes);
        // Support both camelCase (OTLP JSON) and snake_case, and fallback to attributes
        const traceIdRaw = lr.traceId ?? (lr as { trace_id?: string }).trace_id ?? logAttrs['trace_id'] ?? logAttrs['traceId'] ?? null;
        const spanIdRaw = lr.spanId ?? (lr as { span_id?: string }).span_id ?? logAttrs['span_id'] ?? logAttrs['spanId'] ?? null;

        logRows.push({
          customer_id: customerId,
          user_id: userId,
          vendor: vendor.slug,
          trace_id: traceIdRaw,
          span_id: spanIdRaw,
          severity,
          body: lr.body?.stringValue || (typeof lr.body === 'string' ? lr.body : JSON.stringify(lr.body)),
          resource_attributes: resourceAttrs,
          log_attributes: logAttrs,
          timestamp,
        });

        // Synthesize a TelemetrySpan from log records that carry span context
        if (severity === 'ERROR' || severity === 'FATAL') {
          logErrorCount++;
        }

        if (traceIdRaw && spanIdRaw) {
          traceIds.add(traceIdRaw);
          const isError = severity === 'ERROR' || severity === 'FATAL';
          if (isError) errorCount++;

          // Derive a span name from log attributes or body
          const spanName = logAttrs['name']
            || logAttrs['operation']
            || logAttrs['http.method']
            || lr.body?.stringValue
            || (typeof lr.body === 'string' ? lr.body : '')
            || 'log';

          spanRows.push({
            customer_id: customerId,
            user_id: userId,
            trace_id: traceIdRaw,
            span_id: spanIdRaw,
            parent_span_id: null,
            span_name: spanName.length > 200 ? spanName.slice(0, 200) : spanName,
            span_kind: 'INTERNAL',
            start_time: timestamp,
            end_time: null,
            duration_ms: null,
            status_code: isError ? 'ERROR' : 'OK',
            status_message: isError ? (lr.body?.stringValue || null) : null,
            vendor: vendor.slug,
            service_name: serviceName,
            resource_attributes: resourceAttrs,
            span_attributes: logAttrs,
            signal_type: 'log',
          });
        }
      }
    }

    if (logRows.length === 0) continue;

    const now = new Date();
    const profileSpanCount = spanRows.length;
    const profileErrorCount = profileSpanCount > 0 ? errorCount : logErrorCount;
    const [profile] = await db
      .insert(toolProfiles)
      .values({
        customer_id: customerId,
        vendor: vendor.slug,
        display_name: vendor.displayName,
        vendor_category: vendor.category,
        total_spans: profileSpanCount,
        total_traces: traceIds.size,
        total_errors: profileErrorCount,
        first_seen_at: now,
        last_seen_at: now,
      })
      .onConflictDoUpdate({
        target: [toolProfiles.customer_id, toolProfiles.vendor],
        set: {
          display_name: vendor.displayName,
          vendor_category: vendor.category,
          total_spans: sql`"ToolProfile"."total_spans" + ${profileSpanCount}`,
          total_traces: sql`"ToolProfile"."total_traces" + ${traceIds.size}`,
          total_errors: sql`"ToolProfile"."total_errors" + ${profileErrorCount}`,
          last_seen_at: now,
          updated_at: now,
        },
      })
      .returning({ id: toolProfiles.id });

    for (const row of logRows) {
      row.tool_profile_id = profile.id;
    }

    await db.insert(telemetryLogs).values(logRows);
    totalInserted += logRows.length;

    if (spanRows.length > 0) {
      for (const row of spanRows) {
        row.tool_profile_id = profile.id;
      }
      await db.insert(telemetrySpans).values(spanRows);
    }
  }

  return c.json({ partialSuccess: { rejectedLogRecords: 0, acceptedLogRecords: totalInserted } });
});

// ── OTLP Ingestion: Metrics (OTLP JSON) ─────────────────────────────────

router.post('/metrics', authMiddleware, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');

  const customerId = apiToken.customer.id;
  const userId = apiToken.user_id ?? apiToken.customer?.user_id ?? null;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const resourceMetrics = body?.resourceMetrics;
  if (!Array.isArray(resourceMetrics)) {
    return c.json({ error: 'Missing resourceMetrics array' }, 400);
  }

  let totalInserted = 0;

  for (const rm of resourceMetrics) {
    const resourceAttrs = flattenOtelAttributes(rm.resource?.attributes);
    const vendor = canonicalizeVendor(resourceAttrs);
    const serviceName = resourceAttrs['service.name'] || null;

    const now = new Date();
    const [profile] = await db
      .insert(toolProfiles)
      .values({
        customer_id: customerId,
        vendor: vendor.slug,
        display_name: vendor.displayName,
        vendor_category: vendor.category,
        first_seen_at: now,
        last_seen_at: now,
      })
      .onConflictDoUpdate({
        target: [toolProfiles.customer_id, toolProfiles.vendor],
        set: {
          display_name: vendor.displayName,
          vendor_category: vendor.category,
          last_seen_at: now,
          updated_at: now,
        },
      })
      .returning({ id: toolProfiles.id });

    const scopeMetrics = rm.scopeMetrics || [];
    const metricRows: Array<typeof telemetryMetrics.$inferInsert> = [];

    for (const sm of scopeMetrics) {
      const metrics = sm.metrics || [];
      for (const metric of metrics) {
        const metricName = metric.name || 'unknown';
        const unit = metric.unit || null;
        const description = metric.description || null;

        const num = (v: unknown): number | null => {
          if (v === undefined || v === null) return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        const pushRow = (dp: any, metricType: string, extras: Partial<typeof telemetryMetrics.$inferInsert> = {}) => {
          const attrs = flattenOtelAttributes(dp.attributes);
          const timeNano = dp.timeUnixNano ? BigInt(dp.timeUnixNano) : BigInt(Date.now() * 1_000_000);
          const startNano = dp.startTimeUnixNano ? BigInt(dp.startTimeUnixNano) : null;
          const time = new Date(Number(timeNano / BigInt(1_000_000)));
          const startTime = startNano ? new Date(Number(startNano / BigInt(1_000_000))) : null;

          metricRows.push({
            customer_id: customerId,
            user_id: userId,
            tool_profile_id: profile.id,
            vendor: vendor.slug,
            service_name: serviceName,
            metric_name: metricName,
            metric_type: metricType,
            unit,
            description,
            attributes: attrs,
            start_time: startTime,
            time,
            data_point: dp,
            ...extras,
          });
        };

        if (metric.sum?.dataPoints) {
          for (const dp of metric.sum.dataPoints) {
            pushRow(dp, 'sum', {
              value_double: num(dp.asDouble),
              value_int: num(dp.asInt) as number | null,
            });
          }
        } else if (metric.gauge?.dataPoints) {
          for (const dp of metric.gauge.dataPoints) {
            pushRow(dp, 'gauge', {
              value_double: num(dp.asDouble),
              value_int: num(dp.asInt) as number | null,
            });
          }
        } else if (metric.histogram?.dataPoints) {
          for (const dp of metric.histogram.dataPoints) {
            pushRow(dp, 'histogram', {
              count: num(dp.count) as number | null,
              sum: num(dp.sum),
              min: num(dp.min),
              max: num(dp.max),
              bucket_counts: dp.bucketCounts ?? null,
              explicit_bounds: dp.explicitBounds ?? null,
            });
          }
        } else if (metric.exponentialHistogram?.dataPoints) {
          for (const dp of metric.exponentialHistogram.dataPoints) {
            pushRow(dp, 'exponential_histogram', {
              count: num(dp.count) as number | null,
              sum: num(dp.sum),
            });
          }
        } else if (metric.summary?.dataPoints) {
          for (const dp of metric.summary.dataPoints) {
            pushRow(dp, 'summary', {
              count: num(dp.count) as number | null,
              sum: num(dp.sum),
              quantile_values: dp.quantileValues ?? null,
            });
          }
        }
      }
    }

    if (metricRows.length > 0) {
      await db.insert(telemetryMetrics).values(metricRows);
      totalInserted += metricRows.length;
    }
  }

  return c.json({ partialSuccess: { rejectedDataPoints: 0, acceptedDataPoints: totalInserted } });
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
