import { Hono } from 'hono';
import { toolProfiles, telemetrySpans, telemetryLogs } from '@stereos/shared/schema';
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
  const partnerId = apiToken.customer.partner.id;

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
          partner_id: partnerId,
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

    // Upsert tool profile
    const [profile] = await db
      .insert(toolProfiles)
      .values({
        customer_id: customerId,
        partner_id: partnerId,
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

    // Set tool_profile_id on all span rows
    for (const row of spanRows) {
      row.tool_profile_id = profile.id;
    }

    // Batch insert spans
    await db.insert(telemetrySpans).values(spanRows);
    totalInserted += spanRows.length;
    totalErrors += errorCount;
  }

  // Track usage
  const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
  if (totalInserted > 0) {
    await trackUsage(db, customerId, partnerId, 'telemetry_span', totalInserted, {
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

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const resourceLogs = body?.resourceLogs;
  if (!Array.isArray(resourceLogs)) {
    return c.json({ error: 'Missing resourceLogs array' }, 400);
  }

  let totalInserted = 0;

  for (const rl of resourceLogs) {
    const resourceAttrs = flattenOtelAttributes(rl.resource?.attributes);
    const vendor = canonicalizeVendor(resourceAttrs);

    const logRows: Array<typeof telemetryLogs.$inferInsert> = [];

    const scopeLogs = rl.scopeLogs || [];
    for (const sl of scopeLogs) {
      const logRecords = sl.logRecords || [];
      for (const lr of logRecords) {
        const SEVERITY_MAP: Record<number, string> = { 1: 'TRACE', 5: 'DEBUG', 9: 'INFO', 13: 'WARN', 17: 'ERROR', 21: 'FATAL' };
        const severity = SEVERITY_MAP[lr.severityNumber] || lr.severityText || 'INFO';
        const tsNano = lr.timeUnixNano ? BigInt(lr.timeUnixNano) : BigInt(Date.now() * 1_000_000);
        const timestamp = new Date(Number(tsNano / BigInt(1_000_000)));

        logRows.push({
          customer_id: customerId,
          vendor: vendor.slug,
          trace_id: lr.traceId || null,
          span_id: lr.spanId || null,
          severity,
          body: lr.body?.stringValue || (typeof lr.body === 'string' ? lr.body : JSON.stringify(lr.body)),
          resource_attributes: resourceAttrs,
          log_attributes: flattenOtelAttributes(lr.attributes),
          timestamp,
        });
      }
    }

    if (logRows.length === 0) continue;

    // Upsert profile for logs too
    const now = new Date();
    const [profile] = await db
      .insert(toolProfiles)
      .values({
        customer_id: customerId,
        partner_id: apiToken.customer.partner.id,
        vendor: vendor.slug,
        display_name: vendor.displayName,
        vendor_category: vendor.category,
        first_seen_at: now,
        last_seen_at: now,
      })
      .onConflictDoUpdate({
        target: [toolProfiles.customer_id, toolProfiles.vendor],
        set: {
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
  }

  return c.json({ partialSuccess: { rejectedLogRecords: 0, acceptedLogRecords: totalInserted } });
});

// ── OTLP Ingestion: Metrics (summary only) ──────────────────────────────

router.post('/metrics', authMiddleware, async (c) => {
  // Accept the payload but don't store individual metric points — just acknowledge
  return c.json({ partialSuccess: { rejectedDataPoints: 0 } });
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

// ── Read: LLM Stats (gen_ai attributes) ─────────────────────────────────

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
      count(DISTINCT span_attributes->>'gen_ai.request.model') FILTER (WHERE span_attributes->>'gen_ai.request.model' IS NOT NULL)::int AS distinct_models
    FROM "TelemetrySpan"
    WHERE tool_profile_id = ${profileId}
  `);

  const modelUsage = Array.isArray(modelUsageResult) ? modelUsageResult : (modelUsageResult as { rows?: unknown[] })?.rows ?? [];
  const dailyUsage = Array.isArray(dailyUsageResult) ? dailyUsageResult : (dailyUsageResult as { rows?: unknown[] })?.rows ?? [];
  const totalsRow = Array.isArray(totalsResult) ? totalsResult[0] : (totalsResult as { rows?: unknown[] })?.rows?.[0];

  return c.json({
    modelUsage,
    dailyUsage,
    totals: {
      totalInputTokens: Number((totalsRow as Record<string, unknown>)?.total_input_tokens ?? 0),
      totalOutputTokens: Number((totalsRow as Record<string, unknown>)?.total_output_tokens ?? 0),
      distinctModels: Number((totalsRow as Record<string, unknown>)?.distinct_models ?? 0),
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
