/**
 * OpenRouter key provisioning API.
 * User keys: provisioned for individual users (managers create for users).
 * Team keys: provisioned for teams (manager/admin who are team members create).
 * OpenRouter Broadcast sends traces to /v1/traces (configured in OpenRouter Settings > Observability).
 */

import { Hono } from 'hono';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { openrouterKeys, customers, users, teams, teamMembers } from '@stereos/shared/schema';
import { sessionOrTokenAuth } from '../lib/api-token.js';
import type { ApiTokenPayload } from '../lib/api-token.js';
import { getCurrentUser, getCustomerForUser } from '../lib/middleware.js';
import {
  createOpenRouterKey,
  deleteOpenRouterKey,
  getOpenRouterKey,
  listGuardrails,
  createGuardrail,
  bulkAssignKeysToGuardrail,
  bulkUnassignKeysFromGuardrail,
  listGuardrailKeyAssignments,
} from '../lib/openrouter.js';
import { trackManagedKeysUsage } from '../lib/stripe.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

function getManagementKey(c: any): string | undefined {
  const env = (c as { env?: { OPENROUTER_MANAGEMENT_KEY?: string } }).env ?? process.env;
  return env?.OPENROUTER_MANAGEMENT_KEY ?? process.env.OPENROUTER_MANAGEMENT_KEY;
}

async function resolveUserId(c: any): Promise<string | null> {
  const apiToken = c.get('apiToken') as ApiTokenPayload | undefined;
  let userId = apiToken?.user_id ?? apiToken?.customer?.user_id ?? null;
  if (!userId) {
    const user = await getCurrentUser(c);
    userId = user?.id ?? null;
  }
  return userId;
}

async function requireAdminOrManager(c: any, next: any) {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('db');
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, role: true },
  });
  if (!user) return c.json({ error: 'User not found' }, 404);
  if (user.role !== 'admin' && user.role !== 'manager') {
    return c.json({ error: 'Forbidden - Admin or manager required' }, 403);
  }
  c.set('user', user);
  return next();
}

async function isTeamMember(db: any, teamId: string, userId: string): Promise<boolean> {
  const row = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)),
    columns: { team_id: true },
  });
  return !!row;
}

/** Enrich keys with OpenRouter usage (limit, limit_remaining, usage_daily, usage_monthly, disabled) */
async function enrichKeysWithUsage<T extends { openrouter_key_hash: string }>(
  keys: T[],
  managementKey: string
): Promise<(T & { limit?: number | null; limit_remaining?: number | null; usage_daily?: number; usage_monthly?: number; disabled?: boolean })[]> {
  if (keys.length === 0) return [];
  const results = await Promise.allSettled(
    keys.map((k) => getOpenRouterKey(managementKey, k.openrouter_key_hash))
  );
  return keys.map((k, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      const { data } = r.value;
      return {
        ...k,
        limit: data.limit,
        limit_remaining: data.limit_remaining,
        usage_daily: data.usage_daily,
        usage_monthly: data.usage_monthly,
        disabled: data.disabled,
      };
    }
    return k;
  });
}

// ── Customer-wide keys (admin/manager) ─────────────────────────────────────

// GET /v1/keys/customer - List all keys for customer (admin/manager only)
router.get('/keys/customer', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const db = c.get('db');
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const customerId = apiToken.customer?.id;
  if (!customerId) return c.json({ error: 'Customer not found' }, 403);

  const allKeys = await db
    .select({
      id: openrouterKeys.id,
      openrouter_key_hash: openrouterKeys.openrouter_key_hash,
      name: openrouterKeys.name,
      user_id: openrouterKeys.user_id,
      team_id: openrouterKeys.team_id,
      limit_usd: openrouterKeys.limit_usd,
      limit_reset: openrouterKeys.limit_reset,
      created_at: openrouterKeys.created_at,
      user_email: users.email,
      user_name: users.name,
      team_name: teams.name,
    })
    .from(openrouterKeys)
    .leftJoin(users, eq(openrouterKeys.user_id, users.id))
    .leftJoin(teams, eq(openrouterKeys.team_id, teams.id))
    .where(eq(openrouterKeys.customer_id, customerId));

  const managementKey = getManagementKey(c);
  const enrichedKeys =
    managementKey != null && allKeys.length > 0 ? await enrichKeysWithUsage(allKeys, managementKey) : allKeys;

  return c.json({ keys: enrichedKeys });
});

// ── User keys ─────────────────────────────────────────────────────────────

// GET /v1/keys/user/:userId - List user keys + team keys for a user (self or admin/manager)
router.get('/keys/user/:userId', sessionOrTokenAuth, async (c) => {
  const db = c.get('db');
  const targetUserId = c.req.param('userId');
  const currentUserId = await resolveUserId(c);
  if (!currentUserId) return c.json({ error: 'Unauthorized' }, 401);

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, currentUserId),
    columns: { id: true, role: true },
  });
  if (!currentUser) return c.json({ error: 'User not found' }, 404);

  const canView = currentUserId === targetUserId || currentUser.role === 'admin' || currentUser.role === 'manager';
  if (!canView) return c.json({ error: 'Forbidden' }, 403);

  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const customerId = apiToken.customer?.id;
  if (!customerId) return c.json({ error: 'Customer not found' }, 403);

  const userKeys = await db
    .select({
      id: openrouterKeys.id,
      openrouter_key_hash: openrouterKeys.openrouter_key_hash,
      name: openrouterKeys.name,
      user_id: openrouterKeys.user_id,
      team_id: openrouterKeys.team_id,
      limit_usd: openrouterKeys.limit_usd,
      limit_reset: openrouterKeys.limit_reset,
      created_at: openrouterKeys.created_at,
    })
    .from(openrouterKeys)
    .where(
      and(
        eq(openrouterKeys.customer_id, customerId),
        eq(openrouterKeys.user_id, targetUserId),
        isNull(openrouterKeys.team_id)
      )
    );

  const userTeamIds = await db
    .select({ team_id: teamMembers.team_id })
    .from(teamMembers)
    .where(eq(teamMembers.user_id, targetUserId));
  const teamIds = userTeamIds.map((r) => r.team_id);

  let teamKeys: Array<{ id: string; openrouter_key_hash: string; name: string; user_id: string | null; team_id: string | null; team_name?: string; limit_usd: string | null; limit_reset: string | null; created_at: Date }> = [];
  if (teamIds.length > 0) {
    const rows = await db
      .select({
        id: openrouterKeys.id,
        openrouter_key_hash: openrouterKeys.openrouter_key_hash,
        name: openrouterKeys.name,
        user_id: openrouterKeys.user_id,
        team_id: openrouterKeys.team_id,
        limit_usd: openrouterKeys.limit_usd,
        limit_reset: openrouterKeys.limit_reset,
        created_at: openrouterKeys.created_at,
        team_name: teams.name,
      })
      .from(openrouterKeys)
      .leftJoin(teams, eq(openrouterKeys.team_id, teams.id))
      .where(
        and(
          eq(openrouterKeys.customer_id, customerId),
          inArray(openrouterKeys.team_id, teamIds)
        )
      );
    teamKeys = rows.map((r) => ({
      ...r,
      team_name: r.team_name ?? undefined,
    }));
  }

  const managementKey = getManagementKey(c);
  const allKeys = [...userKeys, ...teamKeys];
  const enriched =
    managementKey != null && allKeys.length > 0
      ? await enrichKeysWithUsage(allKeys, managementKey)
      : allKeys;
  const userKeysEnriched = enriched.slice(0, userKeys.length);
  const teamKeysEnriched = enriched.slice(userKeys.length);

  return c.json({ user_keys: userKeysEnriched, team_keys: teamKeysEnriched });
});

// GET /v1/keys/user - List keys for current user (user_id = me)
router.get('/keys/user', sessionOrTokenAuth, async (c) => {
  const db = c.get('db');
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const customerId = apiToken.customer?.id;
  if (!customerId) return c.json({ error: 'Customer not found' }, 403);
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const keys = await db
    .select({
      id: openrouterKeys.id,
      openrouter_key_hash: openrouterKeys.openrouter_key_hash,
      name: openrouterKeys.name,
      customer_id: openrouterKeys.customer_id,
      user_id: openrouterKeys.user_id,
      limit_usd: openrouterKeys.limit_usd,
      limit_reset: openrouterKeys.limit_reset,
      created_at: openrouterKeys.created_at,
    })
    .from(openrouterKeys)
    .where(and(eq(openrouterKeys.customer_id, customerId), eq(openrouterKeys.user_id, userId)));

  const managementKey = getManagementKey(c);
  const enrichedKeys =
    managementKey != null ? await enrichKeysWithUsage(keys, managementKey) : keys;

  return c.json({ keys: enrichedKeys });
});

// POST /v1/keys/user - Create key for user (manager/admin; user_id in body = target user)
router.post('/keys/user', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const db = c.get('db');
  const currentUser = c.get('user') as { id: string };
  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);

  let body: { name: string; customer_id: string; user_id?: string; limit?: number; limit_reset?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { name, customer_id, user_id, limit, limit_reset } = body;
  if (!name?.trim() || !customer_id) {
    return c.json({ error: 'name and customer_id required' }, 400);
  }
  const targetUserId = user_id ?? currentUser.id;

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customer_id),
    columns: { id: true, user_id: true },
  });
  if (!customer) return c.json({ error: 'Customer not found' }, 404);

  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
    columns: { id: true, customer_id: true },
  });
  if (!targetUser) return c.json({ error: 'User not found' }, 404);
  if (targetUser.customer_id && targetUser.customer_id !== customer.id) {
    return c.json({ error: 'User must belong to customer' }, 400);
  }

  const reset = limit_reset === 'daily' || limit_reset === 'weekly' || limit_reset === 'monthly' ? limit_reset : null;

  try {
    const result = await createOpenRouterKey(managementKey, {
      name: name.trim(),
      limit: limit ?? null,
      limit_reset: reset,
      include_byok_in_limit: false,
    });
    const hash = result.data.hash;
    const rawKey = result.key;

    const [row] = await db
      .insert(openrouterKeys)
      .values({
        customer_id,
        user_id: targetUserId,
        team_id: null,
        openrouter_key_hash: hash,
        name: name.trim(),
        limit_usd: limit != null ? String(limit) : null,
        limit_reset: reset,
        created_by_user_id: currentUser.id,
      })
      .returning();

    const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
    await trackManagedKeysUsage(db, customer_id, 1, { openrouter_key_id: row.id }, stripeKey);

    return c.json(
      {
        id: row.id,
        openrouter_key_hash: hash,
        name: row.name,
        customer_id,
        user_id: targetUserId,
        limit_usd: limit,
        limit_reset: reset,
        key: rawKey,
      },
      201
    );
  } catch (err) {
    console.error('[openrouter] create user key error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to create OpenRouter key: ${msg}` }, 500);
  }
});

// DELETE /v1/keys/user/:hash - Revoke user key (owner or manager/admin)
router.delete('/keys/user/:hash', sessionOrTokenAuth, async (c) => {
  const db = c.get('db');
  const hash = c.req.param('hash');
  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);

  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const row = await db.query.openrouterKeys.findFirst({
    where: eq(openrouterKeys.openrouter_key_hash, hash),
    columns: { id: true, user_id: true, team_id: true },
  });
  if (!row || row.team_id != null) return c.json({ error: 'Key not found' }, 404);

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, role: true },
  });
  if (!currentUser) return c.json({ error: 'User not found' }, 404);
  const isOwner = row.user_id === userId;
  const isManagerOrAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';
  if (!isOwner && !isManagerOrAdmin) return c.json({ error: 'Forbidden - Not owner or manager/admin' }, 403);

  try {
    await deleteOpenRouterKey(managementKey, hash);
    await db.delete(openrouterKeys).where(eq(openrouterKeys.id, row.id));
    return c.json({ success: true });
  } catch (err) {
    console.error('[openrouter] delete user key error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to revoke key: ${msg}` }, 500);
  }
});

// ── Team keys ─────────────────────────────────────────────────────────────

// GET /v1/keys/team/:teamId - List team keys (team member only)
router.get('/keys/team/:teamId', sessionOrTokenAuth, async (c) => {
  const db = c.get('db');
  const teamId = c.req.param('teamId');
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const member = await isTeamMember(db, teamId, userId);
  if (!member) return c.json({ error: 'Forbidden - Must be team member' }, 403);

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { id: true, customer_id: true, archived_at: true },
  });
  if (!team || team.archived_at) return c.json({ error: 'Team not found' }, 404);

  const keys = await db
    .select({
      id: openrouterKeys.id,
      openrouter_key_hash: openrouterKeys.openrouter_key_hash,
      name: openrouterKeys.name,
      customer_id: openrouterKeys.customer_id,
      team_id: openrouterKeys.team_id,
      limit_usd: openrouterKeys.limit_usd,
      limit_reset: openrouterKeys.limit_reset,
      created_at: openrouterKeys.created_at,
    })
    .from(openrouterKeys)
    .where(and(eq(openrouterKeys.customer_id, team.customer_id), eq(openrouterKeys.team_id, teamId)));

  const managementKey = getManagementKey(c);
  const enrichedKeys =
    managementKey != null ? await enrichKeysWithUsage(keys, managementKey) : keys;

  return c.json({ keys: enrichedKeys });
});

// POST /v1/keys/team/:teamId - Create team key (manager/admin + team member)
router.post('/keys/team/:teamId', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const db = c.get('db');
  const teamId = c.req.param('teamId');
  const currentUser = c.get('user') as { id: string };
  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);

  const member = await isTeamMember(db, teamId, currentUser.id);
  if (!member) return c.json({ error: 'Forbidden - Must be team member' }, 403);

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { id: true, customer_id: true, archived_at: true },
  });
  if (!team || team.archived_at) return c.json({ error: 'Team not found' }, 404);

  let body: { name: string; limit?: number; limit_reset?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { name, limit, limit_reset } = body;
  if (!name?.trim()) return c.json({ error: 'name required' }, 400);

  const reset = limit_reset === 'daily' || limit_reset === 'weekly' || limit_reset === 'monthly' ? limit_reset : null;

  try {
    const result = await createOpenRouterKey(managementKey, {
      name: name.trim(),
      limit: limit ?? null,
      limit_reset: reset,
      include_byok_in_limit: false,
    });
    const hash = result.data.hash;
    const rawKey = result.key;

    const [row] = await db
      .insert(openrouterKeys)
      .values({
        customer_id: team.customer_id,
        user_id: null,
        team_id: teamId,
        openrouter_key_hash: hash,
        name: name.trim(),
        limit_usd: limit != null ? String(limit) : null,
        limit_reset: reset,
        created_by_user_id: currentUser.id,
      })
      .returning();

    const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
    await trackManagedKeysUsage(db, team.customer_id, 1, { openrouter_key_id: row.id }, stripeKey);

    return c.json(
      {
        id: row.id,
        openrouter_key_hash: hash,
        name: row.name,
        customer_id: team.customer_id,
        team_id: teamId,
        limit_usd: limit,
        limit_reset: reset,
        key: rawKey,
      },
      201
    );
  } catch (err) {
    console.error('[openrouter] create team key error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to create OpenRouter key: ${msg}` }, 500);
  }
});

// DELETE /v1/keys/team/:teamId/:hash - Revoke team key (manager/admin + team member)
router.delete('/keys/team/:teamId/:hash', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const db = c.get('db');
  const teamId = c.req.param('teamId');
  const hash = c.req.param('hash');
  const currentUser = c.get('user') as { id: string };
  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);

  const member = await isTeamMember(db, teamId, currentUser.id);
  if (!member) return c.json({ error: 'Forbidden - Must be team member' }, 403);

  const row = await db.query.openrouterKeys.findFirst({
    where: and(eq(openrouterKeys.openrouter_key_hash, hash), eq(openrouterKeys.team_id, teamId)),
    columns: { id: true },
  });
  if (!row) return c.json({ error: 'Key not found' }, 404);

  try {
    await deleteOpenRouterKey(managementKey, hash);
    await db.delete(openrouterKeys).where(eq(openrouterKeys.id, row.id));
    return c.json({ success: true });
  } catch (err) {
    console.error('[openrouter] delete team key error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to revoke key: ${msg}` }, 500);
  }
});

// DELETE /v1/keys/:hash - Delete any key (admin/manager only, key must belong to customer)
router.delete('/keys/:hash', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const db = c.get('db');
  const hash = c.req.param('hash');
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const customerId = apiToken.customer?.id;
  if (!customerId) return c.json({ error: 'Customer not found' }, 403);

  const row = await db.query.openrouterKeys.findFirst({
    where: and(eq(openrouterKeys.openrouter_key_hash, hash), eq(openrouterKeys.customer_id, customerId)),
    columns: { id: true },
  });
  if (!row) return c.json({ error: 'Key not found' }, 404);

  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);

  try {
    await deleteOpenRouterKey(managementKey, hash);
    await db.delete(openrouterKeys).where(eq(openrouterKeys.id, row.id));
    return c.json({ success: true });
  } catch (err) {
    console.error('[openrouter] delete key error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to revoke key: ${msg}` }, 500);
  }
});

// GET /v1/keys/:hash/details - Get OpenRouter key details (usage, limit, etc.)
router.get('/keys/:hash/details', sessionOrTokenAuth, async (c) => {
  const db = c.get('db');
  const hash = c.req.param('hash');
  const currentUserId = await resolveUserId(c);
  if (!currentUserId) return c.json({ error: 'Unauthorized' }, 401);

  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const customerId = apiToken.customer?.id;
  if (!customerId) return c.json({ error: 'Customer not found' }, 403);

  const row = await db.query.openrouterKeys.findFirst({
    where: eq(openrouterKeys.openrouter_key_hash, hash),
    columns: { id: true, user_id: true, team_id: true, customer_id: true, name: true },
  });
  if (!row || row.customer_id !== customerId) return c.json({ error: 'Key not found' }, 404);

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, currentUserId),
    columns: { id: true, role: true },
  });
  if (!currentUser) return c.json({ error: 'User not found' }, 404);

  let hasAccess = currentUser.role === 'admin' || currentUser.role === 'manager';
  if (!hasAccess && row.user_id) hasAccess = row.user_id === currentUserId;
  if (!hasAccess && row.team_id) hasAccess = await isTeamMember(db, row.team_id, currentUserId);
  if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);

  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);

  try {
    const { data } = await getOpenRouterKey(managementKey, hash);
    return c.json({
      key: {
        hash: data.hash,
        name: data.name,
        label: data.label,
        disabled: data.disabled,
        limit: data.limit,
        limit_remaining: data.limit_remaining,
        limit_reset: data.limit_reset,
        usage: data.usage,
        usage_daily: data.usage_daily,
        usage_weekly: data.usage_weekly,
        usage_monthly: data.usage_monthly,
        created_at: data.created_at,
        updated_at: data.updated_at,
        expires_at: data.expires_at,
        user_id: row.user_id,
        team_id: row.team_id,
      },
    });
  } catch (err) {
    console.error('[openrouter] get key details error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to fetch key details: ${msg}` }, 500);
  }
});

// ── Guardrails (admin/manager only) ────────────────────────────────────────

// GET /v1/guardrails - List guardrails
router.get('/guardrails', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);
  try {
    const offset = c.req.query('offset');
    const limit = c.req.query('limit');
    const result = await listGuardrails(managementKey, {
      offset: offset != null ? parseInt(offset, 10) : undefined,
      limit: limit != null ? parseInt(limit, 10) : undefined,
    });
    return c.json(result);
  } catch (err) {
    console.error('[openrouter] list guardrails error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// POST /v1/guardrails - Create guardrail
router.post('/guardrails', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);
  let body: {
    name: string;
    description?: string | null;
    limit_usd?: number | null;
    reset_interval?: 'daily' | 'weekly' | 'monthly' | null;
    allowed_providers?: string[] | null;
    allowed_models?: string[] | null;
    enforce_zdr?: boolean | null;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { name, description, limit_usd, reset_interval, allowed_providers, allowed_models, enforce_zdr } = body;
  if (!name?.trim()) return c.json({ error: 'name required' }, 400);
  try {
    const result = await createGuardrail(managementKey, {
      name: name.trim(),
      description: description ?? null,
      limit_usd: limit_usd ?? null,
      reset_interval: reset_interval ?? null,
      allowed_providers: allowed_providers ?? null,
      allowed_models: allowed_models ?? null,
      enforce_zdr: enforce_zdr ?? null,
    });
    return c.json(result, 201);
  } catch (err) {
    console.error('[openrouter] create guardrail error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// GET /v1/guardrails/:id/assignments/keys - List key assignments for a guardrail
router.get('/guardrails/:id/assignments/keys', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);
  const guardrailId = c.req.param('id');
  try {
    const offset = c.req.query('offset');
    const limit = c.req.query('limit');
    const result = await listGuardrailKeyAssignments(managementKey, guardrailId, {
      offset: offset != null ? parseInt(offset, 10) : undefined,
      limit: limit != null ? parseInt(limit, 10) : undefined,
    });
    return c.json(result);
  } catch (err) {
    console.error('[openrouter] list guardrail key assignments error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// POST /v1/guardrails/:id/assignments/keys - Bulk assign keys to guardrail
router.post('/guardrails/:id/assignments/keys', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);
  const guardrailId = c.req.param('id');
  let body: { key_hashes: string[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { key_hashes } = body;
  if (!Array.isArray(key_hashes) || key_hashes.length === 0) {
    return c.json({ error: 'key_hashes array required' }, 400);
  }
  try {
    const result = await bulkAssignKeysToGuardrail(managementKey, guardrailId, key_hashes);
    return c.json(result);
  } catch (err) {
    console.error('[openrouter] assign keys to guardrail error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// POST /v1/guardrails/:id/assignments/keys/remove - Bulk unassign keys from guardrail
router.post('/guardrails/:id/assignments/keys/remove', sessionOrTokenAuth, requireAdminOrManager, async (c) => {
  const managementKey = getManagementKey(c);
  if (!managementKey) return c.json({ error: 'OpenRouter management key not configured' }, 503);
  const guardrailId = c.req.param('id');
  let body: { key_hashes: string[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { key_hashes } = body;
  if (!Array.isArray(key_hashes) || key_hashes.length === 0) {
    return c.json({ error: 'key_hashes array required' }, 400);
  }
  try {
    const result = await bulkUnassignKeysFromGuardrail(managementKey, guardrailId, key_hashes);
    return c.json(result);
  } catch (err) {
    console.error('[openrouter] unassign keys from guardrail error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// Redirect legacy /keys to user keys for backward compat
router.get('/keys', sessionOrTokenAuth, async (c) => {
  return c.redirect('/v1/keys/user');
});

export default router;
