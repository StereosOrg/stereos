import { Hono } from 'hono';
import { partners, customers, apiTokens } from '@stereos/shared/schema';
import { eq, sql } from 'drizzle-orm';
import { createStripeCustomer } from '../lib/stripe.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

// Exchange magic link token for session token (no redirect/cookie parsing).
// Frontend hits this after user clicks the link in email (link goes to frontend with ?token=).
router.post('/auth/magic-link/exchange', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const token = body.token?.trim();
  if (!token) return c.json({ error: 'Missing token' }, 400);

  const auth = c.get('auth');
  const baseUrl = new URL(c.req.url).origin;
  const verifyUrl = `${baseUrl}/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(baseUrl + '/')}`;
  const res = await fetch(verifyUrl, { redirect: 'manual' });
  if (res.status < 300 || res.status >= 400) {
    return c.json({ error: 'Invalid or expired link' }, 400);
  }
  const setCookies =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  let sessionToken = res.headers.get('set-auth-token')?.trim() || '';
  if (!sessionToken) {
    for (const cookie of setCookies) {
      const m = cookie.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
      if (m) {
        sessionToken = decodeURIComponent(m[1].trim());
        break;
      }
    }
  }
  if (!sessionToken) return c.json({ error: 'Invalid or expired link' }, 400);
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
    // Generate secret key
    const secretKey = crypto.randomUUID();

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

    // Generate customer ID
    const customerId = `cust_${crypto.randomUUID().replace(/-/g, '').substr(0, 16)}`;

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
    const token = `sk_${crypto.randomUUID().replace(/-/g, '')}`;

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
