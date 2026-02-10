import { Hono } from 'hono';
import { newUuid } from '@stereos/shared/ids';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { users, provenanceEvents, artifactLinks, outcomes, telemetrySpans } from '@stereos/shared/schema';
import { eq, and, desc, sql, inArray, gte, lte } from 'drizzle-orm';
import { trackUsage } from '../lib/stripe.js';
import { authMiddleware, sessionOrTokenAuth } from '../lib/api-token.js';
import type { ApiTokenPayload } from '../lib/api-token.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

// Event ingestion schemas
const agentActionSchema = z.object({
  event_type: z.literal('agent_action'),
  actor_type: z.literal('agent'),
  actor_id: z.string(),
  intent: z.string(),
  model: z.string().optional(),
  tool: z.string(),
  files_written: z.array(z.string()).optional(),
  timestamp: z.string().datetime().optional(),
  repo: z.string(),
  branch: z.string().optional(),
  commit: z.string().optional(),
  diff_hash: z.string().optional(),
  diff_content: z.string().optional(),
});

const outcomeSchema = z.object({
  event_type: z.literal('outcome'),
  original_event_id: z.string().uuid(),
  status: z.enum(['accepted', 'rejected', 'superseded']),
  linked_commit: z.string().optional(),
});

const eventSchema = z.discriminatedUnion('event_type', [
  agentActionSchema,
  outcomeSchema,
]);

// POST /v1/events - Ingest events
router.post('/events', authMiddleware, zValidator('json', eventSchema), async (c) => {
  const data = c.req.valid('json');
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const partnerId = apiToken.customer.partner.id;

  try {
    if (data.event_type === 'agent_action') {
      // Get user_id from customer relationship
      const userId = apiToken.customer.user_id;
      
      // Create provenance event
      const [event] = await db
        .insert(provenanceEvents)
        .values({
          customer_id: customerId,
          partner_id: partnerId,
          user_id: userId,
          actor_type: data.actor_type,
          actor_id: data.actor_id,
          tool: data.tool,
          model: data.model,
          intent: data.intent,
          files_written: data.files_written || [],
          timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        })
        .returning();

      // Create artifact link — use raw SQL so diff_content is always written (avoids stale schema in dist omitting the column)
      const diffContent = typeof data.diff_content === 'string' && data.diff_content.length > 0 ? data.diff_content : null;
      if (diffContent) {
        console.log(`[events] Storing diff_content length=${diffContent.length} for event ${event.id}`);
      }
      await db.execute(sql`
        INSERT INTO "ArtifactLink" (id, event_id, repo, branch, commit, diff_hash, diff_content)
        VALUES (
          ${newUuid()},
          ${event.id},
          ${data.repo},
          ${data.branch ?? null},
          ${data.commit ?? null},
          ${data.diff_hash ?? null},
          ${diffContent}
        )
      `);

      // Record usage in DB and report to Stripe meter "provenance_events" (1 unit per provenance event)
      const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
      await trackUsage(db, customerId, partnerId, 'agent_action', 1, {
        event_id: event.id,
        actor_id: data.actor_id,
        tool: data.tool,
      }, stripeKey, true);

      return c.json({ success: true, event_id: event.id }, 201);
    } else if (data.event_type === 'outcome') {
      // Create outcome record
      const [outcome] = await db
        .insert(outcomes)
        .values({
          event_id: data.original_event_id,
          status: data.status,
          linked_commit: data.linked_commit,
        })
        .returning();

      // Record outcome in usage table only (no Stripe meter — provenance_events meter is for new provenance events only)
      await trackUsage(db, customerId, partnerId, 'outcome', 1, {
        status: data.status,
      });

      return c.json({ success: true, outcome_id: outcome.id }, 201);
    }
  } catch (error) {
    console.error('Event ingestion error:', error);
    return c.json({ error: 'Failed to ingest event' }, 500);
  }
});

// GET /v1/provenance/by-commit/:sha
router.get('/provenance/by-commit/:sha', sessionOrTokenAuth, async (c) => {
  const sha = c.req.param('sha');
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  const events = await db.query.provenanceEvents.findMany({
    where: and(
      eq(provenanceEvents.customer_id, customerId),
      sql`EXISTS (
        SELECT 1 FROM "ArtifactLink"
        WHERE "ArtifactLink".event_id = "provenanceEvents".id
        AND "ArtifactLink".commit = ${sha}
      )`
    ),
    with: {
      artifacts: true,
      outcomes: true,
    },
    orderBy: desc(provenanceEvents.timestamp),
  });

  return c.json({ events });
});

// GET /v1/provenance/by-file
router.get('/provenance/by-file', sessionOrTokenAuth, async (c) => {
  const filePath = c.req.query('path');
  const repo = c.req.query('repo');
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  if (!filePath) {
    return c.json({ error: 'File path is required' }, 400);
  }

  const events = await db.query.provenanceEvents.findMany({
    where: and(
      eq(provenanceEvents.customer_id, customerId),
      sql`${filePath} = ANY(${provenanceEvents.files_written})`
    ),
    with: {
      artifacts: repo ? {
        where: eq(artifactLinks.repo, repo),
      } : true,
      outcomes: true,
    },
    orderBy: desc(provenanceEvents.timestamp),
  });

  return c.json({ events });
});

// GET /v1/dashboard - Stats and recent events (provenance + spans) for the current customer
router.get('/dashboard', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  const [statsResult, recentProvenance, recentSpans] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM "ProvenanceEvent" WHERE customer_id = ${customerId}) AS provenance_count,
        (SELECT COUNT(*) FROM "TelemetrySpan" WHERE customer_id = ${customerId}) AS span_count,
        (SELECT COUNT(DISTINCT a.commit) FROM "ArtifactLink" a
         INNER JOIN "ProvenanceEvent" e ON e.id = a.event_id
         WHERE e.customer_id = ${customerId} AND a.commit IS NOT NULL AND a.commit != '') AS total_commits,
        (SELECT COUNT(DISTINCT actor_id) FROM "ProvenanceEvent" WHERE customer_id = ${customerId}) AS provenance_agents,
        (SELECT COUNT(DISTINCT vendor) FROM "TelemetrySpan" WHERE customer_id = ${customerId}) AS span_vendors
    `),
    db.query.provenanceEvents.findMany({
      where: eq(provenanceEvents.customer_id, customerId),
      with: { artifacts: true, outcomes: true },
      orderBy: desc(provenanceEvents.timestamp),
      limit: 20,
    }),
    db.query.telemetrySpans.findMany({
      where: eq(telemetrySpans.customer_id, customerId),
      orderBy: desc(telemetrySpans.start_time),
      limit: 20,
      columns: {
        id: true,
        span_name: true,
        vendor: true,
        start_time: true,
        user_id: true,
        tool_profile_id: true,
        span_attributes: true,
      },
    }),
  ]);

  const statsRow = Array.isArray(statsResult) ? statsResult[0] : (statsResult as { rows?: unknown[] })?.rows?.[0];
  const r = statsRow as Record<string, unknown>;
  const provenanceCount = Number(r?.provenance_count ?? 0);
  const spanCount = Number(r?.span_count ?? 0);
  const total_events = provenanceCount + spanCount;
  const total_commits = Number(r?.total_commits ?? 0);
  const active_agents = Math.max(
    Number(r?.provenance_agents ?? 0),
    Number(r?.span_vendors ?? 0),
  );

  const provenanceAsEvents = recentProvenance.map((e) => ({
    id: e.id,
    type: 'provenance' as const,
    intent: e.intent,
    actor_id: e.actor_id,
    tool: e.tool,
    model: e.model ?? null,
    timestamp: e.timestamp,
    user_id: e.user_id,
    tool_profile_id: null as string | null,
  }));
  const spansAsEvents = recentSpans.map((s) => ({
    id: `span-${s.id}`,
    type: 'span' as const,
    intent: s.span_name,
    actor_id: s.vendor,
    tool: s.vendor,
    model: (s.span_attributes as Record<string, string> | null)?.['gen_ai.request.model'] ?? (s.span_attributes as Record<string, string> | null)?.['gen_ai.response.model'] ?? null,
    timestamp: s.start_time,
    user_id: s.user_id,
    tool_profile_id: s.tool_profile_id,
  }));

  const merged = [...provenanceAsEvents, ...spansAsEvents]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 15);

  const userIds = [...new Set(merged.map((e) => e.user_id).filter(Boolean))] as string[];
  const userList = userIds.length > 0
    ? await db.query.users.findMany({
        where: inArray(users.id, userIds),
        columns: { id: true, name: true, image: true, email: true },
      })
    : [];
  const userMap = Object.fromEntries(userList.map((u: { id: string }) => [u.id, u]));

  const recent_events = merged.map((event) => ({
    ...event,
    user: event.user_id ? userMap[event.user_id] ?? null : null,
  }));

  return c.json({
    total_events,
    total_commits,
    active_agents,
    recent_events,
  });
});

// GET /v1/events/search - Provenance events + spans as unified feed (no double request)
router.get('/events/search', sessionOrTokenAuth, async (c) => {
  const actorId = c.req.query('actor_id');
  const tool = c.req.query('tool');
  const intent = c.req.query('intent');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const limit = Math.min(parseInt(c.req.query('limit') || '50') || 50, 100);
  const offset = parseInt(c.req.query('offset') || '0') || 0;

  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  const provConditions = [eq(provenanceEvents.customer_id, customerId)];
  if (actorId) provConditions.push(eq(provenanceEvents.actor_id, actorId));
  if (tool) provConditions.push(eq(provenanceEvents.tool, tool));
  if (intent) provConditions.push(sql`${provenanceEvents.intent} ILIKE ${`%${intent}%`}`);
  if (startDate) provConditions.push(sql`${provenanceEvents.timestamp} >= ${new Date(startDate)}`);
  if (endDate) provConditions.push(sql`${provenanceEvents.timestamp} <= ${new Date(endDate)}`);

  const spanConditions = [eq(telemetrySpans.customer_id, customerId)];
  if (actorId || tool) spanConditions.push(eq(telemetrySpans.vendor, actorId || tool));
  if (intent) spanConditions.push(sql`${telemetrySpans.span_name} ILIKE ${`%${intent}%`}`);
  if (startDate) spanConditions.push(gte(telemetrySpans.start_time, new Date(startDate)));
  if (endDate) spanConditions.push(lte(telemetrySpans.start_time, new Date(endDate)));

  const fetchLimit = limit + offset + 50;
  const [provEvents, spanRows] = await Promise.all([
    db.query.provenanceEvents.findMany({
      where: and(...provConditions),
      with: { artifacts: true, outcomes: true },
      orderBy: desc(provenanceEvents.timestamp),
      limit: fetchLimit,
    }),
    db.query.telemetrySpans.findMany({
      where: and(...spanConditions),
      orderBy: desc(telemetrySpans.start_time),
      limit: fetchLimit,
      columns: {
        id: true,
        span_name: true,
        vendor: true,
        start_time: true,
        user_id: true,
        tool_profile_id: true,
        span_attributes: true,
      },
    }),
  ]);

  const provenanceAsEvents = provEvents.map((e) => ({
    ...e,
    _type: 'provenance' as const,
    tool_profile_id: null as string | null,
  }));
  const spansAsEvents = spanRows.map((s) => ({
    id: `span-${s.id}`,
    type: 'span' as const,
    intent: s.span_name,
    actor_id: s.vendor,
    tool: s.vendor,
    model: (s.span_attributes as Record<string, string> | null)?.['gen_ai.request.model'] ?? (s.span_attributes as Record<string, string> | null)?.['gen_ai.response.model'] ?? null,
    timestamp: s.start_time,
    user_id: s.user_id,
    tool_profile_id: s.tool_profile_id,
  }));

  const provNormalized = provenanceAsEvents.map((e) => ({
    id: e.id,
    type: 'provenance' as const,
    intent: e.intent,
    actor_id: e.actor_id,
    tool: e.tool,
    model: e.model ?? null,
    timestamp: e.timestamp,
    user_id: e.user_id,
    tool_profile_id: e.tool_profile_id,
    artifacts: (e as { artifacts?: unknown }).artifacts,
    outcomes: (e as { outcomes?: unknown }).outcomes,
  }));

  const merged = [...provNormalized, ...spansAsEvents]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const paginated = merged.slice(offset, offset + limit);

  const userIds = [...new Set(paginated.map((e) => e.user_id).filter(Boolean))] as string[];
  const userList = userIds.length > 0
    ? await db.query.users.findMany({
        where: inArray(users.id, userIds),
        columns: { id: true, name: true, image: true, email: true },
      })
    : [];
  const userMap = Object.fromEntries(userList.map((u: { id: string }) => [u.id, u]));

  const eventsWithUser = paginated.map((event) => ({
    ...event,
    user: event.user_id ? userMap[event.user_id] ?? null : null,
  }));

  return c.json({ events: eventsWithUser, limit, offset });
});

// GET /v1/events/:eventId/file?path=... - Single file diff drilldown
router.get('/events/:eventId/file', sessionOrTokenAuth, async (c) => {
  const eventId = c.req.param('eventId');
  const filePath = c.req.query('path');
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  if (!filePath) {
    return c.json({ error: 'File path is required (use ?path=...)' }, 400);
  }

  const event = await db.query.provenanceEvents.findFirst({
    where: and(
      eq(provenanceEvents.id, eventId),
      eq(provenanceEvents.customer_id, customerId)
    ),
    with: {
      artifacts: true,
    },
  });

  if (!event) {
    return c.json({ error: 'Event not found' }, 404);
  }

  // Check that this file is in the event's files_written
  if (!event.files_written?.includes(filePath)) {
    return c.json({ error: 'File not found in this event' }, 404);
  }

  // Extract the single file diff from artifacts' diff_content
  let fileDiff: { path: string; hunks: unknown[] } | null = null;
  for (const artifact of event.artifacts) {
    if (!artifact.diff_content) continue;
    try {
      const parsed = JSON.parse(artifact.diff_content);
      if (Array.isArray(parsed)) {
        const match = parsed.find((f: { path: string }) => f.path === filePath);
        if (match) {
          fileDiff = match;
          break;
        }
      }
    } catch {
      // Not JSON — skip
    }
  }

  const user = event.user_id
    ? await db.query.users.findFirst({
        where: eq(users.id, event.user_id),
        columns: { id: true, name: true, image: true, email: true },
      })
    : null;

  return c.json({
    event: {
      id: event.id,
      intent: event.intent,
      actor_id: event.actor_id,
      tool: event.tool,
      model: event.model,
      timestamp: event.timestamp,
      user,
    },
    file_path: filePath,
    diff: fileDiff,
  });
});

// GET /v1/events/:eventId - Single event drilldown
router.get('/events/:eventId', sessionOrTokenAuth, async (c) => {
  const eventId = c.req.param('eventId');
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  const event = await db.query.provenanceEvents.findFirst({
    where: and(
      eq(provenanceEvents.id, eventId),
      eq(provenanceEvents.customer_id, customerId)
    ),
    with: {
      artifacts: true,
      outcomes: true,
    },
  });

  if (!event) {
    return c.json({ error: 'Event not found' }, 404);
  }

  const user = event.user_id
    ? await db.query.users.findFirst({
        where: eq(users.id, event.user_id),
        columns: { id: true, name: true, image: true, email: true },
      })
    : null;

  return c.json({ event: { ...event, user } });
});

export default router;
