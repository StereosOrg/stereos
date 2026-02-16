/**
 * Shared OTLP trace ingestion logic.
 * Extracted from the POST /v1/traces route handler so the AI proxy can reuse it.
 */

import type { Database } from '@stereos/shared/db';
import { toolProfiles, telemetrySpans, users, customers, teamMembers, teams } from '@stereos/shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { canonicalizeVendor, flattenOtelAttributes } from './vendor-map.js';
import { trackTelemetryEventsUsage } from './stripe.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface IngestOtelSpansResult {
  acceptedSpans: number;
  rejectedSpans: number;
}

// ── Helpers: attribute extraction ─────────────────────────────────────────

const USER_ATTR_KEYS = ['user.id', 'user_id', 'trace.metadata.user.id', 'trace.metadata.user_id'];
const TEAM_ATTR_KEYS = ['team.id', 'team_id', 'trace.metadata.team.id', 'trace.metadata.team_id'];

function extractUserId(attrs: Record<string, string>): string | null {
  for (const k of USER_ATTR_KEYS) {
    const v = attrs[k]?.trim();
    if (v) return v;
  }
  return null;
}

function extractTeamId(attrs: Record<string, string>): string | null {
  for (const k of TEAM_ATTR_KEYS) {
    const v = attrs[k]?.trim();
    if (v) return v;
  }
  return null;
}

// ── Helpers: OTEL attribute conversion ───────────────────────────────────

export function toOtelAttributes(attrs: Record<string, string>): Array<{ key: string; value: { stringValue: string } }> {
  return Object.entries(attrs).map(([key, val]) => ({
    key,
    value: { stringValue: String(val) },
  }));
}

// ── Helpers: customer / team resolution ──────────────────────────────────

/** Resolve customer_id for a Stereos user_id. */
export async function resolveCustomerForUserId(db: Database, userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { customer_id: true },
  });
  if (user?.customer_id) return user.customer_id;
  const owner = await db.query.customers.findFirst({
    where: eq(customers.user_id, userId),
    columns: { id: true },
  });
  return owner?.id ?? null;
}

/** Resolve team_id from trace attributes or user's team membership. */
export async function resolveTeamId(
  db: Database,
  customerId: string,
  userId: string,
  traceTeamId: string | null
): Promise<string | null> {
  if (traceTeamId?.trim()) {
    const team = await db.query.teams.findFirst({
      where: and(eq(teams.id, traceTeamId), eq(teams.customer_id, customerId)),
      columns: { id: true },
    });
    if (team) {
      const member = await db.query.teamMembers.findFirst({
        where: and(eq(teamMembers.team_id, team.id), eq(teamMembers.user_id, userId)),
        columns: { team_id: true },
      });
      if (member) return team.id;
    }
  }
  const membership = await db.query.teamMembers.findFirst({
    where: eq(teamMembers.user_id, userId),
    columns: { team_id: true },
  });
  if (membership) {
    const team = await db.query.teams.findFirst({
      where: and(eq(teams.id, membership.team_id), eq(teams.customer_id, customerId)),
      columns: { id: true },
    });
    if (team) return team.id;
  }
  return null;
}

// ── Main ingestion function ──────────────────────────────────────────────

/**
 * Ingest OTLP trace spans into the database.
 *
 * Throws an error if the customer / user cannot be resolved so the caller
 * can map it to the appropriate HTTP status.
 */
export async function ingestOtelSpans(
  db: Database,
  body: { resourceSpans: any[] },
  stripeApiKey?: string
): Promise<IngestOtelSpansResult> {
  const resourceSpans = body.resourceSpans;

  // Extract user.id and team.id from spans/resource attributes; resolve to customer and team
  let customerId: string | null = null;
  let userId: string | null = null;
  let traceTeamId: string | null = null;
  for (const rs of resourceSpans) {
    const resourceAttrs = flattenOtelAttributes(rs.resource?.attributes);
    userId = extractUserId(resourceAttrs);
    traceTeamId = traceTeamId ?? extractTeamId(resourceAttrs);
    if (!userId) {
      for (const ss of rs.scopeSpans || []) {
        for (const span of ss.spans || []) {
          const spanAttrs = flattenOtelAttributes(span.attributes);
          userId = userId ?? extractUserId(spanAttrs);
          traceTeamId = traceTeamId ?? extractTeamId(spanAttrs);
          if (userId) break;
        }
        if (userId) break;
      }
    }
    if (userId) {
      customerId = await resolveCustomerForUserId(db, userId);
      if (customerId) break;
    }
  }
  if (!customerId || !userId) {
    throw new Error(
      'Unable to attribute traces - OpenRouter requests must include user (Stereos user_id) in request body'
    );
  }

  const teamId = await resolveTeamId(db, customerId, userId, traceTeamId);

  const existingVendors = new Set(
    (await db.select({ vendor: toolProfiles.vendor }).from(toolProfiles).where(eq(toolProfiles.customer_id, customerId))).map((r) => r.vendor)
  );

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
        spanAttrs['user.id'] = userId;
        if (teamId) spanAttrs['team.id'] = teamId;
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
          team_id: teamId,
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

    if (!existingVendors.has(vendor.slug)) {
      existingVendors.add(vendor.slug);
    }
  }

  if (totalInserted > 0) {
    await trackTelemetryEventsUsage(db, customerId, totalInserted, {
      trace_count: traceIds.size,
    }, stripeApiKey);
  }

  return { acceptedSpans: totalInserted, rejectedSpans: 0 };
}
