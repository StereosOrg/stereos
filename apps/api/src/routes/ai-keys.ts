import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as schema from '@stereos/shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { getCurrentUser, getCustomerForUser } from '../lib/middleware.js';
import type { AppVariables } from '../types/app.js';
import type { Database } from '@stereos/shared/db';

const router = new Hono<{ Variables: AppVariables }>();

// Inline middleware to avoid type issues
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

// Hash a key for storage
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// Generate a new virtual key
function generateVirtualKey(): string {
  return `stereos_${crypto.randomUUID().replace(/-/g, '')}`;
}

// Check budget before allowing request
export async function checkBudget(
  key: { budget_usd: string | null; spend_usd: string; budget_reset: string | null; spend_reset_at: Date | null; disabled: boolean }
): Promise<{ allowed: boolean; remaining_usd?: number }> {
  if (key.disabled) return { allowed: false };
  if (!key.budget_usd) return { allowed: true };

  // Check if we need to reset spend
  if (key.budget_reset && key.spend_reset_at && new Date() > key.spend_reset_at) {
    return { allowed: true, remaining_usd: parseFloat(key.budget_usd) };
  }

  const budget = parseFloat(key.budget_usd);
  const spend = parseFloat(key.spend_usd);
  
  if (spend >= budget) return { allowed: false, remaining_usd: 0 };
  return { allowed: true, remaining_usd: budget - spend };
}

// Schema for creating a key
const createKeySchema = z.object({
  name: z.string().min(1),
  customer_id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  budget_usd: z.string().optional(),
  budget_reset: z.enum(['daily', 'weekly', 'monthly']).optional(),
  allowed_models: z.array(z.string()).optional(),
});

// POST /v1/ai/keys/user - Create a user key
router.post('/ai/keys/user', requireAuth, requireAdminOrManager, zValidator('json', createKeySchema), async (c) => {
  const db = c.get('db') as Database;
  const data = c.req.valid('json') as z.infer<typeof createKeySchema>;
  const createdByUserId = c.get('user')?.id;

  try {
    // Generate virtual key
    const rawKey = generateVirtualKey();
    const keyHash = hashKey(rawKey);

    // Calculate spend_reset_at if budget_reset is set
    let spendResetAt: Date | null = null;
    if (data.budget_reset) {
      spendResetAt = new Date();
      if (data.budget_reset === 'daily') {
        spendResetAt.setDate(spendResetAt.getDate() + 1);
      } else if (data.budget_reset === 'weekly') {
        spendResetAt.setDate(spendResetAt.getDate() + 7);
      } else if (data.budget_reset === 'monthly') {
        spendResetAt.setMonth(spendResetAt.getMonth() + 1);
      }
    }

    // Insert key
    const [key] = await db.insert(schema.aiGatewayKeys).values({
      customer_id: data.customer_id,
      user_id: data.user_id || null,
      team_id: data.team_id || null,
      key_hash: keyHash,
      name: data.name,
      budget_usd: data.budget_usd || null,
      budget_reset: data.budget_reset || null,
      spend_reset_at: spendResetAt,
      allowed_models: data.allowed_models || null,
      created_by_user_id: createdByUserId || null,
    }).returning();

    return c.json({
      id: key.id,
      name: key.name,
      key: rawKey, // Show once
      budget_usd: key.budget_usd,
      budget_reset: key.budget_reset,
      allowed_models: key.allowed_models,
    }, 201);
  } catch (error) {
    console.error('Error creating AI key:', error);
    return c.json({ error: 'Failed to create key' }, 500);
  }
});

// POST /v1/ai/keys/team/:teamId - Create a team key
router.post('/ai/keys/team/:teamId', requireAuth, requireAdminOrManager, zValidator('json', createKeySchema.omit({ team_id: true })), async (c) => {
  const db = c.get('db') as Database;
  const teamId = c.req.param('teamId');
  const data = c.req.valid('json') as z.infer<typeof createKeySchema>;
  const createdByUserId = c.get('user')?.id;

  try {
    // Verify user is on the team
    const membership = await db.query.teamMembers.findFirst({
      where: and(
        eq(schema.teamMembers.team_id, teamId),
        eq(schema.teamMembers.user_id, createdByUserId as string)
      ),
    });

    if (!membership) {
      return c.json({ error: 'Not a member of this team' }, 403);
    }

    const rawKey = generateVirtualKey();
    const keyHash = hashKey(rawKey);

    let spendResetAt: Date | null = null;
    if (data.budget_reset) {
      spendResetAt = new Date();
      if (data.budget_reset === 'daily') {
        spendResetAt.setDate(spendResetAt.getDate() + 1);
      } else if (data.budget_reset === 'weekly') {
        spendResetAt.setDate(spendResetAt.getDate() + 7);
      } else if (data.budget_reset === 'monthly') {
        spendResetAt.setMonth(spendResetAt.getMonth() + 1);
      }
    }

    const [key] = await db.insert(schema.aiGatewayKeys).values({
      customer_id: data.customer_id,
      team_id: teamId,
      user_id: null,
      key_hash: keyHash,
      name: data.name,
      budget_usd: data.budget_usd || null,
      budget_reset: data.budget_reset || null,
      spend_reset_at: spendResetAt,
      allowed_models: data.allowed_models || null,
      created_by_user_id: createdByUserId || null,
    }).returning();

    return c.json({
      id: key.id,
      name: key.name,
      key: rawKey,
      budget_usd: key.budget_usd,
      budget_reset: key.budget_reset,
      allowed_models: key.allowed_models,
    }, 201);
  } catch (error) {
    console.error('Error creating team AI key:', error);
    return c.json({ error: 'Failed to create key' }, 500);
  }
});

// GET /v1/ai/keys/customer - List all keys for customer
router.get('/ai/keys/customer', requireAuth, requireAdminOrManager, async (c) => {
  const db = c.get('db') as Database;
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as any, user.id);

  if (!customer) {
    return c.json({ error: 'No customer found for user' }, 404);
  }

  const customerId = customer.id;

  try {
    const keys = await db.query.aiGatewayKeys.findMany({
      where: eq(schema.aiGatewayKeys.customer_id, customerId),
      with: {
        user: { columns: { id: true, name: true, email: true } },
        team: { columns: { id: true, name: true } },
      },
      orderBy: (keys, { desc }) => [desc(keys.created_at)],
    });

    return c.json({
      keys: keys.map(k => ({
        id: k.id,
        name: k.name,
        key_hash: k.key_hash,
        budget_usd: k.budget_usd,
        spend_usd: k.spend_usd,
        budget_reset: k.budget_reset,
        allowed_models: k.allowed_models,
        disabled: k.disabled,
        user: k.user,
        team: k.team,
        created_at: k.created_at,
      })),
    });
  } catch (error) {
    console.error('Error listing keys:', error);
    return c.json({ error: 'Failed to list keys' }, 500);
  }
});

// GET /v1/ai/keys/user - List keys for the current authenticated user
router.get('/ai/keys/user', requireAuth, async (c) => {
  const db = c.get('db') as Database;
  const currentUser = c.get('user')!;

  try {
    const keys = await db.query.aiGatewayKeys.findMany({
      where: eq(schema.aiGatewayKeys.user_id, currentUser.id),
      with: {
        team: { columns: { id: true, name: true } },
      },
    });

    return c.json({ keys });
  } catch (error) {
    console.error('Error listing current user keys:', error);
    return c.json({ error: 'Failed to list keys' }, 500);
  }
});

// GET /v1/ai/keys/user/:userId - List keys for user
router.get('/ai/keys/user/:userId', requireAuth, async (c) => {
  const db = c.get('db') as Database;
  const userId = c.req.param('userId');
  const currentUser = c.get('user');

  // Users can only see their own keys unless admin/manager
  if (currentUser?.id !== userId && !['admin', 'manager'].includes(currentUser?.role as string)) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  try {
    const keys = await db.query.aiGatewayKeys.findMany({
      where: eq(schema.aiGatewayKeys.user_id, userId),
      with: {
        team: { columns: { id: true, name: true } },
      },
    });

    return c.json({ keys });
  } catch (error) {
    console.error('Error listing user keys:', error);
    return c.json({ error: 'Failed to list keys' }, 500);
  }
});

// GET /v1/ai/keys/team/:teamId - List keys for team
router.get('/ai/keys/team/:teamId', requireAuth, async (c) => {
  const db = c.get('db') as Database;
  const teamId = c.req.param('teamId');
  const currentUser = c.get('user');

  try {
    // Check if user is a member of the team
    const membership = await db.query.teamMembers.findFirst({
      where: and(
        eq(schema.teamMembers.team_id, teamId),
        eq(schema.teamMembers.user_id, currentUser?.id as string)
      ),
    });

    if (!membership && !['admin', 'manager'].includes(currentUser?.role as string)) {
      return c.json({ error: 'Unauthorized - Not a team member' }, 403);
    }

    const keys = await db.query.aiGatewayKeys.findMany({
      where: eq(schema.aiGatewayKeys.team_id, teamId),
      with: {
        user: { columns: { id: true, name: true, email: true } },
      },
      orderBy: (keys, { desc }) => [desc(keys.created_at)],
    });

    return c.json({
      keys: keys.map(k => ({
        id: k.id,
        name: k.name,
        key_hash: k.key_hash,
        budget_usd: k.budget_usd,
        spend_usd: k.spend_usd,
        budget_reset: k.budget_reset,
        allowed_models: k.allowed_models,
        disabled: k.disabled,
        user: k.user,
        created_at: k.created_at,
      })),
    });
  } catch (error) {
    console.error('Error listing team keys:', error);
    return c.json({ error: 'Failed to list keys' }, 500);
  }
});

// GET /v1/ai/keys/:hash/details - Get key details
router.get('/ai/keys/:hash/details', requireAuth, async (c) => {
  const db = c.get('db') as Database;
  const keyHash = c.req.param('hash');

  try {
    const key = await db.query.aiGatewayKeys.findFirst({
      where: eq(schema.aiGatewayKeys.key_hash, keyHash),
      with: {
        user: { columns: { id: true, name: true, email: true } },
        team: { columns: { id: true, name: true } },
      },
    });

    if (!key) {
      return c.json({ error: 'Key not found' }, 404);
    }

    const usageResult = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_requests,
        COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
        COUNT(*) FILTER (WHERE status_code >= 400)::int AS total_errors,
        MAX(created_at) AS last_activity
      FROM "GatewayEvent"
      WHERE key_id = ${key.id}
    `);
    const usageRow = Array.isArray(usageResult) ? usageResult[0] : (usageResult as { rows?: unknown[] })?.rows?.[0];

    return c.json({
      id: key.id,
      key_hash: key.key_hash,
      name: key.name,
      budget_usd: key.budget_usd,
      spend_usd: key.spend_usd,
      budget_remaining: key.budget_usd ? parseFloat(key.budget_usd) - parseFloat(key.spend_usd) : null,
      budget_reset: key.budget_reset,
      spend_reset_at: key.spend_reset_at,
      allowed_models: key.allowed_models,
      disabled: key.disabled,
      user: key.user,
      team: key.team,
      created_at: key.created_at,
      usage: {
        total_requests: Number((usageRow as Record<string, unknown>)?.total_requests ?? 0),
        total_tokens: Number((usageRow as Record<string, unknown>)?.total_tokens ?? 0),
        total_errors: Number((usageRow as Record<string, unknown>)?.total_errors ?? 0),
        last_activity: (usageRow as Record<string, unknown>)?.last_activity ?? null,
      },
    });
  } catch (error) {
    console.error('Error getting key details:', error);
    return c.json({ error: 'Failed to get key details' }, 500);
  }
});

// PATCH /v1/ai/keys/:hash - Update key
router.patch('/ai/keys/:hash', requireAuth, requireAdminOrManager, async (c) => {
  const db = c.get('db') as Database;
  const keyHash = c.req.param('hash');
  const body = await c.req.json();

  try {
    const updates: any = {};
    if (body.name) updates.name = body.name;
    if (body.budget_usd !== undefined) updates.budget_usd = body.budget_usd;
    if (body.budget_reset) updates.budget_reset = body.budget_reset;
    if (body.allowed_models) updates.allowed_models = body.allowed_models;
    if (body.disabled !== undefined) updates.disabled = body.disabled;

    await db.update(schema.aiGatewayKeys)
      .set(updates)
      .where(eq(schema.aiGatewayKeys.key_hash, keyHash));

    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating key:', error);
    return c.json({ error: 'Failed to update key' }, 500);
  }
});

// DELETE /v1/ai/keys/:hash - Delete key
router.delete('/ai/keys/:hash', requireAuth, requireAdminOrManager, async (c) => {
  const db = c.get('db') as Database;
  const keyHash = c.req.param('hash');

  try {
    await db.delete(schema.aiGatewayKeys)
      .where(eq(schema.aiGatewayKeys.key_hash, keyHash));

    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting key:', error);
    return c.json({ error: 'Failed to delete key' }, 500);
  }
});

// Models available through the AI Gateway
const SUPPORTED_MODELS = [
  // OpenAI
  'openai/gpt-5.2',
  'openai/gpt-5-nano',
  'openai/gpt-5"',
  'openai/gpt-5-mini',
  'openai/gpt-4.1',
  // Anthropic
  'anthropic/claude-opus-4-6',
  'anthropic/claude-sonnet-4-5',
];

// GET /v1/ai/models - List available ZDR-compatible models
router.get('/ai/models', requireAuth, async (c) => {
  return c.json({ models: SUPPORTED_MODELS });
});

// GET /v1/ai/gateway - Get gateway info for the customer
router.get('/ai/gateway', requireAuth, requireAdminOrManager, async (c) => {
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as any, user.id);

  if (!customer) {
    return c.json({ error: 'No customer found' }, 404);
  }

  const cfAccountId = (c.env as any)?.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const cfApiToken = (c.env as any)?.CF_AI_GATEWAY_API_TOKEN || process.env.CF_AI_GATEWAY_API_TOKEN;
  const baseUrl = (c.env as any)?.BASE_URL || process.env.BASE_URL || 'https://api.trystereos.com';

  let otel: Array<{ authorization?: string; headers?: Record<string, string>; url: string }> | null = null;
  if (customer.cf_gateway_id && cfAccountId && cfApiToken) {
    try {
      const { getCfGateway } = await import('../lib/cloudflare-ai.js');
      const gw = await getCfGateway(cfAccountId, cfApiToken, customer.cf_gateway_id);
      otel = gw.otel ?? null;
    } catch (err) {
      console.error('Failed to fetch CF gateway details:', err);
    }
  }

  return c.json({
    cf_gateway_id: customer.cf_gateway_id,
    cf_account_id: cfAccountId || null,
    otel,
    proxy_url: customer.cf_gateway_id
      ? `${baseUrl}/v1/chat/completions`
      : null,
    inference_url: customer.cf_gateway_id && cfAccountId
      ? `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${customer.cf_gateway_id}/openai`
      : null,
  });
});

// POST /v1/ai/gateway/provision - Provision a Cloudflare AI Gateway for the customer
router.post('/ai/gateway/provision', requireAuth, requireAdminOrManager, async (c) => {
  const db = c.get('db') as Database;
  const { createCfGateway } = await import('../lib/cloudflare-ai.js');
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as any, user.id);

  if (!customer) {
    return c.json({ error: 'No customer found' }, 404);
  }

  if (customer.cf_gateway_id) {
    return c.json({ error: 'Gateway already provisioned', cf_gateway_id: customer.cf_gateway_id }, 409);
  }

  const cfAccountId = (c.env as any)?.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const cfApiToken = (c.env as any)?.CF_AI_GATEWAY_API_TOKEN || process.env.CF_AI_GATEWAY_API_TOKEN;

  if (!cfAccountId || !cfApiToken) {
    return c.json({ error: 'Cloudflare AI not configured on server' }, 503);
  }

  try {
    const gatewaySlug = `stereos-${customer.customer_id}`;
    const logpushPublicKey = (c.env as any)?.LOGPUSH_PUBLIC_KEY ?? process.env.LOGPUSH_PUBLIC_KEY;
    const gw = await createCfGateway(cfAccountId, cfApiToken, {
      id: gatewaySlug,
      ...(logpushPublicKey ? { logpush: true, logpush_public_key: logpushPublicKey } : {}),
    });

    // Configure default OTEL endpoint
    const { updateCfGateway } = await import('../lib/cloudflare-ai.js');
    const defaultOtelUrl = `${process.env.BASE_URL || 'https://api.trystereos.com'}/v1/traces`;
    try {
      await updateCfGateway(cfAccountId, cfApiToken, gw.id, {
        otel: [{ url: defaultOtelUrl }],
      });
    } catch (err) {
      console.error('CF AI Gateway OTEL config failed (non-fatal):', err);
    }

    await db
      .update(schema.customers)
      .set({ cf_gateway_id: gw.id })
      .where(eq(schema.customers.id, customer.id));

    return c.json({ success: true, cf_gateway_id: gw.id });
  } catch (error) {
    console.error('Gateway provisioning failed:', error);
    return c.json({ error: 'Failed to provision gateway' }, 500);
  }
});

// PATCH /v1/ai/gateway/otel - Update the OTEL endpoint on the customer's gateway
router.patch('/ai/gateway/otel', requireAuth, requireAdminOrManager, async (c) => {
  const { updateCfGateway } = await import('../lib/cloudflare-ai.js');
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as any, user.id);

  if (!customer?.cf_gateway_id) {
    return c.json({ error: 'No gateway provisioned' }, 404);
  }

  const cfAccountId = (c.env as any)?.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const cfApiToken = (c.env as any)?.CF_AI_GATEWAY_API_TOKEN || process.env.CF_AI_GATEWAY_API_TOKEN;

  if (!cfAccountId || !cfApiToken) {
    return c.json({ error: 'Cloudflare AI not configured on server' }, 503);
  }

  const body = await c.req.json();
  let otelEntries: Array<{ url: string; authorization?: string; headers?: Record<string, string> }> | null = null;

  if (Array.isArray(body.otel)) {
    otelEntries = body.otel
      .filter((entry: any) => entry && typeof entry.url === 'string')
      .map((entry: any) => ({
        url: String(entry.url).trim(),
        authorization: entry.authorization,
        headers: entry.headers,
      }))
      .filter((entry: any) => entry.url);
  } else if (Array.isArray(body.otel_urls)) {
    otelEntries = body.otel_urls
      .filter((url: any) => typeof url === 'string')
      .map((url: any) => ({ url: String(url).trim() }))
      .filter((entry: any) => entry.url);
  } else if (typeof body.otel_url === 'string') {
    const single = body.otel_url.trim();
    if (single) otelEntries = [{ url: single }];
  }

  if (otelEntries === null) {
    return c.json({ error: 'otel_url or otel_urls is required' }, 400);
  }

  try {
    await updateCfGateway(cfAccountId, cfApiToken, customer.cf_gateway_id, {
      otel: otelEntries,
    });
    return c.json({ success: true, otel: otelEntries });
  } catch (error) {
    console.error('Gateway OTEL update failed:', error);
    return c.json({ error: 'Failed to update OTEL endpoint' }, 500);
  }
});

export default router;
