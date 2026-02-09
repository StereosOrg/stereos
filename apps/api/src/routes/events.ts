import { Hono } from 'hono';
import { newUuid } from '@stereos/shared/ids';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { users, provenanceEvents, artifactLinks, outcomes } from '@stereos/shared/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
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

// GET /v1/dashboard - Stats and recent events for the current customer
router.get('/dashboard', sessionOrTokenAuth, async (c) => {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  const [statsResult, recentList] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM "ProvenanceEvent" WHERE customer_id = ${customerId}) AS total_events,
        (SELECT COUNT(DISTINCT a.commit) FROM "ArtifactLink" a
         INNER JOIN "ProvenanceEvent" e ON e.id = a.event_id
         WHERE e.customer_id = ${customerId} AND a.commit IS NOT NULL AND a.commit != '') AS total_commits,
        (SELECT COUNT(DISTINCT actor_id) FROM "ProvenanceEvent" WHERE customer_id = ${customerId}) AS active_agents
    `),
    db.query.provenanceEvents.findMany({
      where: eq(provenanceEvents.customer_id, customerId),
      with: { artifacts: true, outcomes: true },
      orderBy: desc(provenanceEvents.timestamp),
      limit: 15,
    }),
  ]);

  const statsRow = Array.isArray(statsResult) ? statsResult[0] : (statsResult as { rows?: unknown[] })?.rows?.[0];
  const total_events = Number((statsRow as Record<string, unknown>)?.total_events ?? 0);
  const total_commits = Number((statsRow as Record<string, unknown>)?.total_commits ?? 0);
  const active_agents = Number((statsRow as Record<string, unknown>)?.active_agents ?? 0);

  const userIds = [...new Set(recentList.map((e) => e.user_id).filter(Boolean))] as string[];
  const userList = userIds.length > 0
    ? await db.query.users.findMany({
        where: inArray(users.id, userIds),
        columns: { id: true, name: true, image: true, email: true },
      })
    : [];
  const userMap = Object.fromEntries(userList.map((u: { id: string }) => [u.id, u]));

  const recent_events = recentList.map((event) => ({
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

// GET /v1/events/search
router.get('/events/search', sessionOrTokenAuth, async (c) => {
  const actorId = c.req.query('actor_id');
  const tool = c.req.query('tool');
  const intent = c.req.query('intent');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;

  let conditions = [eq(provenanceEvents.customer_id, customerId)];

  if (actorId) {
    conditions.push(eq(provenanceEvents.actor_id, actorId));
  }
  if (tool) {
    conditions.push(eq(provenanceEvents.tool, tool));
  }
  if (intent) {
    conditions.push(sql`${provenanceEvents.intent} ILIKE ${`%${intent}%`}`);
  }
  if (startDate) {
    conditions.push(sql`${provenanceEvents.timestamp} >= ${new Date(startDate)}`);
  }
  if (endDate) {
    conditions.push(sql`${provenanceEvents.timestamp} <= ${new Date(endDate)}`);
  }

  const events = await db.query.provenanceEvents.findMany({
    where: and(...conditions),
    with: {
      artifacts: true,
      outcomes: true,
    },
    orderBy: desc(provenanceEvents.timestamp),
    limit,
    offset,
  });

  const userIds = [...new Set(events.map((e: { user_id: string | null }) => e.user_id).filter(Boolean))] as string[];
  const userList = userIds.length > 0
    ? await db.query.users.findMany({
        where: inArray(users.id, userIds),
        columns: { id: true, name: true, image: true, email: true },
      })
    : [];
  const userMap = Object.fromEntries(userList.map((u: { id: string }) => [u.id, u]));

  const eventsWithUser = events.map((event: { user_id: string | null; [key: string]: unknown }) => ({
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
