import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Database } from '@stereos/shared/db';
import * as schema from '@stereos/shared/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { getCurrentUser, getCustomerForUser } from '../lib/middleware.js';
import { getCfGateway, updateCfGateway } from '../lib/cloudflare-ai.js';
import { listCfDlpProfiles } from '../lib/cloudflare-dlp.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

const requireAuth = async (c: any, next: any) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('user', user);
  await next();
};

const requireAdminOrManager = async (c: any, next: any) => {
  const user = c.get('user');
  const role = user?.role;
  if (!user || (role !== 'admin' && role !== 'manager')) {
    return c.json({ error: 'Forbidden - Admin or manager access required' }, 403);
  }
  await next();
};

function getCfCredentials(c: any) {
  // Support both Node.js (process.env) and Cloudflare Workers (c.env)
  const accountId = c.env?.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const apiToken = c.env?.CF_AI_GATEWAY_API_TOKEN || process.env.CF_AI_GATEWAY_API_TOKEN;
  return { accountId, apiToken };
}

// GET /v1/dlp/profiles — list available DLP profiles from the CF account
router.get('/dlp/profiles', requireAuth, requireAdminOrManager, async (c) => {
  const { accountId, apiToken } = getCfCredentials(c);
  if (!accountId || !apiToken) {
    return c.json({ error: 'Cloudflare not configured on server' }, 503);
  }

  try {
    const profiles = await listCfDlpProfiles(accountId, apiToken);
    return c.json({ profiles });
  } catch (error) {
    console.error('Failed to list DLP profiles:', error);
    return c.json({ error: 'Failed to list DLP profiles' }, 500);
  }
});

// GET /v1/dlp/config — get the customer's gateway DLP state from CF
router.get('/dlp/config', requireAuth, requireAdminOrManager, async (c) => {
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as any, user.id);

  if (!customer) {
    return c.json({ error: 'No customer found' }, 404);
  }
  if (!customer.cf_gateway_id) {
    return c.json({ error: 'No AI Gateway provisioned' }, 400);
  }

  const { accountId, apiToken } = getCfCredentials(c);
  if (!accountId || !apiToken) {
    return c.json({ error: 'Cloudflare not configured on server' }, 503);
  }

  try {
    const gateway = await getCfGateway(accountId, apiToken, customer.cf_gateway_id);
    return c.json({
      dlp_enabled: gateway.dlp?.enabled ?? false,
      dlp_action: gateway.dlp?.action ?? 'BLOCK',
      dlp_profile_ids: gateway.dlp?.profiles ?? [],
    });
  } catch (error) {
    console.error('Failed to get DLP config:', error);
    return c.json({ error: 'Failed to get DLP config' }, 500);
  }
});

// PUT /v1/dlp/config — update the customer's gateway DLP settings
const updateConfigSchema = z.object({
  dlp_enabled: z.boolean(),
  dlp_action: z.enum(['BLOCK', 'FLAG']),
  dlp_profile_ids: z.array(z.string()),
});

router.put('/dlp/config', requireAuth, requireAdminOrManager, zValidator('json', updateConfigSchema), async (c) => {
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as any, user.id);

  if (!customer) {
    return c.json({ error: 'No customer found' }, 404);
  }
  if (!customer.cf_gateway_id) {
    return c.json({ error: 'No AI Gateway provisioned. Provision a gateway first.' }, 400);
  }

  const body = c.req.valid('json') as z.infer<typeof updateConfigSchema>;
  const { accountId, apiToken } = getCfCredentials(c);

  if (!accountId || !apiToken) {
    return c.json({ error: 'Cloudflare not configured on server' }, 503);
  }

  try {
    await updateCfGateway(accountId, apiToken, customer.cf_gateway_id, {
      dlp: {
        enabled: body.dlp_enabled,
        action: body.dlp_action,
        profiles: body.dlp_profile_ids,
      },
    });

    // Auto-enable logpush when DLP is set to FLAG mode (logpush needed to capture flagged events)
    if (body.dlp_enabled && body.dlp_action === 'FLAG') {
      const logpushPublicKey = process.env.LOGPUSH_PUBLIC_KEY ?? (c.env as any)?.LOGPUSH_PUBLIC_KEY;
      try {
        await updateCfGateway(accountId, apiToken, customer.cf_gateway_id, {
          logpush: true,
          ...(logpushPublicKey ? { logpush_public_key: logpushPublicKey } : {}),
        });
      } catch (err) {
        console.error('Auto-enable logpush for DLP FLAG failed (non-fatal):', err);
      }
    }

    return c.json({
      success: true,
      dlp_enabled: body.dlp_enabled,
      dlp_action: body.dlp_action,
      dlp_profile_ids: body.dlp_profile_ids,
    });
  } catch (error) {
    console.error('DLP config update failed:', error);
    return c.json({ error: 'Failed to update DLP config' }, 500);
  }
});

// GET /v1/dlp/events — paginated list of DLP events for customer
router.get('/dlp/events', requireAuth, requireAdminOrManager, async (c) => {
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as any, user.id);
  if (!customer) return c.json({ error: 'No customer found' }, 404);

  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const dbInstance = c.get('db') as Database;

  try {
    const events = await dbInstance.query.dlpEvents.findMany({
      where: eq(schema.dlpEvents.customer_id, customer.id),
      orderBy: [desc(schema.dlpEvents.timestamp)],
      limit,
      offset,
    });

    const [{ total }] = await dbInstance
      .select({ total: count() })
      .from(schema.dlpEvents)
      .where(eq(schema.dlpEvents.customer_id, customer.id));

    return c.json({ events, total, limit, offset });
  } catch (error) {
    console.error('Failed to list DLP events:', error);
    return c.json({ error: 'Failed to list DLP events' }, 500);
  }
});

// GET /v1/dlp/events/:eventId — single event detail
router.get('/dlp/events/:eventId', requireAuth, requireAdminOrManager, async (c) => {
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as any, user.id);
  if (!customer) return c.json({ error: 'No customer found' }, 404);

  const eventId = c.req.param('eventId');
  const dbInstance = c.get('db') as Database;

  try {
    const event = await dbInstance.query.dlpEvents.findFirst({
      where: and(
        eq(schema.dlpEvents.id, eventId),
        eq(schema.dlpEvents.customer_id, customer.id),
      ),
    });

    if (!event) return c.json({ error: 'Event not found' }, 404);
    return c.json({ event });
  } catch (error) {
    console.error('Failed to get DLP event:', error);
    return c.json({ error: 'Failed to get DLP event' }, 500);
  }
});

// GET /v1/dlp/stats — aggregate DLP event counts
router.get('/dlp/stats', requireAuth, requireAdminOrManager, async (c) => {
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as any, user.id);
  if (!customer) return c.json({ error: 'No customer found' }, 404);

  const dbInstance = c.get('db') as Database;

  try {
    const baseWhere = eq(schema.dlpEvents.customer_id, customer.id);

    const [totals] = await dbInstance
      .select({ total: count() })
      .from(schema.dlpEvents)
      .where(baseWhere);

    const [flagged] = await dbInstance
      .select({ total: count() })
      .from(schema.dlpEvents)
      .where(and(baseWhere, eq(schema.dlpEvents.severity, 'flag')));

    const [blocked] = await dbInstance
      .select({ total: count() })
      .from(schema.dlpEvents)
      .where(and(baseWhere, eq(schema.dlpEvents.severity, 'block')));

    const modelsResult = await dbInstance
      .select({ model: schema.dlpEvents.model })
      .from(schema.dlpEvents)
      .where(baseWhere)
      .groupBy(schema.dlpEvents.model);

    const [dateRange] = await dbInstance
      .select({
        earliest: sql<string>`MIN(${schema.dlpEvents.timestamp})`,
        latest: sql<string>`MAX(${schema.dlpEvents.timestamp})`,
      })
      .from(schema.dlpEvents)
      .where(baseWhere);

    return c.json({
      total: totals.total,
      flagged: flagged.total,
      blocked: blocked.total,
      affected_models: modelsResult.map((r) => r.model).filter(Boolean),
      date_range: {
        earliest: dateRange.earliest,
        latest: dateRange.latest,
      },
    });
  } catch (error) {
    console.error('Failed to get DLP stats:', error);
    return c.json({ error: 'Failed to get DLP stats' }, 500);
  }
});

export default router;
