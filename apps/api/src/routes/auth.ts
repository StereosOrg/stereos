import { Hono } from 'hono';
import { partners, customers, apiTokens, verifications, users, sessions } from '@stereos/shared/schema';
import { newSessionToken, newUuid, newCustomerId, newApiToken } from '@stereos/shared/ids';
import { eq, and, gt } from 'drizzle-orm';
import { createStripeCustomer } from '../lib/stripe.js';
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
  const [user] = await db.query.users.findMany({ where: eq(users.email, email), limit: 1 });
  if (!user) return c.json({ error: 'Invalid or expired link' }, 400);

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

// Partner registration
router.post('/partners/register', async (c) => {
  const body = await c.req.json();
  const { name, partner_id, email } = body;
  const db = c.get('db');

  try {
    const secretKey = newUuid();

    const [partner] = await db
      .insert(partners)
      .values({
        name,
        partner_id,
        secret_key: secretKey,
      })
      .returning();

    return c.json({ 
      success: true, 
      partner: {
        id: partner.id,
        name: partner.name,
        partner_id: partner.partner_id,
      },
      secret_key: secretKey, // Only shown once
    }, 201);
  } catch (error) {
    console.error('Partner registration error:', error);
    return c.json({ error: 'Failed to register partner' }, 500);
  }
});

// Customer registration (after Better Auth signup)
router.post('/customers/register', async (c) => {
  const body = await c.req.json();
  const { user_id, partner_id, email, name } = body;
  const db = c.get('db');

  try {
    // Get partner
    const partner = await db.query.partners.findFirst({
      where: eq(partners.partner_id, partner_id),
    });

    if (!partner) {
      return c.json({ error: 'Invalid partner ID' }, 400);
    }

    const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
    const stripeCustomerId = await createStripeCustomer(email, name, stripeKey);

    const customerId = newCustomerId();

    const [customer] = await db
      .insert(customers)
      .values({
        user_id,
        partner_id: partner.id,
        customer_id: customerId,
        customer_stripe_id: stripeCustomerId,
        billing_status: 'active',
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

// Create API token
router.post('/tokens', async (c) => {
  const body = await c.req.json();
  const { customer_id, name, scopes } = body;
  const db = c.get('db');

  try {
    const token = newApiToken();

    const [apiToken] = await db
      .insert(apiTokens)
      .values({
        customer_id,
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

export default router;
