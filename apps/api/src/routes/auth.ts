import { Hono } from 'hono';
import { customers, apiTokens, verifications, users, sessions, accounts, teamMembers } from '@stereos/shared/schema';
import { newSessionToken, newUuid, newCustomerId, newApiToken } from '@stereos/shared/ids';
import { eq, and, gt, desc } from 'drizzle-orm';
import { createStripeCustomer } from '../lib/stripe.js';
import { sessionOrTokenAuth } from '../lib/api-token.js';
import { getCustomerForUser } from '../lib/middleware.js';
import type { ApiTokenPayload } from '../lib/api-token.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

// Exchange magic link token for session token. Verify via DB and create session (no fetch/getSetCookie).
router.post('/auth/magic-link/exchange', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const token = body.token?.trim();
  if (!token) return c.json({ error: 'Missing token' }, 400);

  const db = c.get('db');
  const now = new Date();
  // Better-auth: identifier = magic link token, value = JSON e.g. {"email":"..."}
  const row = await db.query.verifications.findFirst({
    where: and(eq(verifications.identifier, token), gt(verifications.expiresAt, now)),
  });
  if (!row) return c.json({ error: 'Invalid or expired link' }, 400);

  let email: string;
  try {
    const parsed = JSON.parse(row.value) as { email?: string };
    email = parsed?.email ?? row.value;
  } catch {
    email = row.value;
  }
  let user = (await db.query.users.findMany({ where: eq(users.email, email), limit: 1 }))[0];
  if (!user) {
    const userId = newUuid();
    await db.insert(users).values({
      id: userId,
      email: email.toLowerCase(),
      emailVerified: true,
      role: 'user',
    });
    await db.insert(accounts).values({
      id: newUuid(),
      userId,
      accountId: userId,
      provider: 'credential',
      type: 'credential',
    });
    user = (await db.query.users.findFirst({ where: eq(users.id, userId) }))!;
  }

  // Use a distinct prefix so our tokens are distinguishable from better-auth’s (e.g. nanoid-style); both are valid.
  const sessionToken = newSessionToken();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await db.insert(sessions).values({
    sessionToken,
    userId: user.id,
    expires,
  });
  await db.delete(verifications).where(eq(verifications.id, row.id));

  return c.json({ session_token: sessionToken });
});

// Better Auth handler (everything else)
router.on(['POST', 'GET'], '/auth/*', async (c) => {
  return c.get('auth').handler(c.req.raw);
});

// Customer registration (after Better Auth signup)
router.post('/customers/register', async (c) => {
  const body = await c.req.json();
  const { user_id, email, name } = body;
  const db = c.get('db');

  try {
    const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
    const stripeCustomerId = await createStripeCustomer(email, name, stripeKey);

    const customerId = newCustomerId();

    const [customer] = await db
      .insert(customers)
      .values({
        user_id,
        customer_id: customerId,
        customer_stripe_id: stripeCustomerId,
        billing_status: 'trial',
      })
      .returning();

    return c.json({
      success: true,
      customer: {
        id: customer.id,
        customer_id: customer.customer_id,
        billing_status: customer.billing_status,
      },
    }, 201);
  } catch (error) {
    console.error('Customer registration error:', error);
    return c.json({ error: 'Failed to register customer' }, 500);
  }
});

// Create API token (requires session or API token; user_id set from current user/customer owner)
router.post('/tokens', sessionOrTokenAuth, async (c) => {
  const body = await c.req.json();
  const { customer_id, name, scopes, team_id } = body;
  const db = c.get('db');
  const apiTokenPayload = c.get('apiToken') as ApiTokenPayload;
  const userId = apiTokenPayload.user_id ?? apiTokenPayload.customer?.user_id ?? null;
  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, userId ?? ''),
    columns: { id: true, role: true },
  });

  if (!currentUser) return c.json({ error: 'Unauthorized' }, 401);
  const customer = await getCustomerForUser(c as any, currentUser.id);
  if (!customer || customer.id !== customer_id) {
    return c.json({ error: 'Invalid customer for token' }, 403);
  }
  if (currentUser.role === 'manager' || currentUser.role === 'admin') {
    if (!team_id) return c.json({ error: 'Team-scoped key required' }, 400);
    const membership = await db.query.teamMembers.findFirst({
      where: and(eq(teamMembers.team_id, team_id), eq(teamMembers.user_id, currentUser.id)),
      columns: { team_id: true },
    });
    if (!membership) return c.json({ error: 'You can only create keys for your own team' }, 403);
  }
  if (currentUser.role === 'user') {
    return c.json({ error: 'Insufficient permissions to create keys' }, 403);
  }

  try {
    const token = newApiToken();

    const [apiToken] = await db
      .insert(apiTokens)
      .values({
        customer_id,
        user_id: userId,
        team_id: team_id ?? null,
        token,
        name,
        scopes: scopes || ['events:write', 'events:read'],
      })
      .returning();

    return c.json({
      success: true,
      token: {
        id: apiToken.id,
        name: apiToken.name,
        token: apiToken.token, // Only shown once
        scopes: apiToken.scopes,
        created_at: apiToken.created_at,
      },
    }, 201);
  } catch (error) {
    console.error('Token creation error:', error);
    return c.json({ error: 'Failed to create token' }, 500);
  }
});

// List API tokens for current customer (masked)
router.get('/tokens', sessionOrTokenAuth, async (c) => {
  const db = c.get('db');
  const apiTokenPayload = c.get('apiToken') as ApiTokenPayload;
  const customerId = apiTokenPayload.customer?.id;
  if (!customerId) return c.json({ error: 'Customer not found' }, 403);

  const tokens = await db.query.apiTokens.findMany({
    where: eq(apiTokens.customer_id, customerId),
    orderBy: desc(apiTokens.created_at),
    columns: {
      id: true,
      name: true,
      token: true,
      scopes: true,
      created_at: true,
      last_used: true,
      user_id: true,
      team_id: true,
    },
  });

  const masked = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    token: t.token,
    token_preview: t.token ? `${t.token.slice(0, 4)}…${t.token.slice(-4)}` : '—',
    scopes: t.scopes,
    created_at: t.created_at,
    last_used: t.last_used,
    user_id: t.user_id,
    team_id: t.team_id ?? null,
  }));

  return c.json({ tokens: masked });
});

// Delete API token (current customer only)
router.delete('/tokens/:tokenId', sessionOrTokenAuth, async (c) => {
  const db = c.get('db');
  const apiTokenPayload = c.get('apiToken') as ApiTokenPayload;
  const customerId = apiTokenPayload.customer?.id;
  if (!customerId) return c.json({ error: 'Customer not found' }, 403);

  const tokenId = c.req.param('tokenId');
  const [deleted] = await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.customer_id, customerId)))
    .returning({ id: apiTokens.id });

  if (!deleted) return c.json({ error: 'Token not found' }, 404);
  return c.json({ success: true });
});

export default router;
