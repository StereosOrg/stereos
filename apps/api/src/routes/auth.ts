import { Hono } from 'hono';
import { partners, customers, apiTokens } from '@stereos/shared/schema';
import { eq, sql } from 'drizzle-orm';
import { createStripeCustomer } from '../lib/stripe.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

// Better Auth handler
router.on(['POST', 'GET'], '/auth/*', (c) => {
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

    // Create Stripe customer
    const stripeCustomerId = await createStripeCustomer(email, name);

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
