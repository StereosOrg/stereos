import { Hono } from 'hono';
import { partners, usageEvents } from '@stereos/shared/schema';
import { eq, sql } from 'drizzle-orm';
import { handleStripeWebhook, stripe } from '../lib/stripe.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

// GET /v1/partners/:partnerId/revenue
router.get('/partners/:partnerId/revenue', async (c) => {
  const partnerId = c.req.param('partnerId');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const db = c.get('db');

  // Verify partner secret
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const secretKey = authHeader.substring(7);
  const partner = await db.query.partners.findFirst({
    where: eq(partners.id, partnerId),
  });

  if (!partner || partner.secret_key !== secretKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Query revenue data from materialized view or calculate directly
  const revenue = await db.execute(sql`
    SELECT 
      DATE_TRUNC('month', ${usageEvents.timestamp}) AS billing_month,
      COUNT(DISTINCT ${usageEvents.customer_id}) AS total_customers,
      COUNT(${usageEvents.id}) AS total_events,
      SUM(${usageEvents.quantity}) AS total_units,
      SUM(${usageEvents.total_price}) AS total_revenue,
      SUM(${usageEvents.total_price}) * 0.20 AS partner_share
    FROM ${usageEvents}
    WHERE ${usageEvents.partner_id} = ${partnerId}
    ${startDate ? sql`AND ${usageEvents.timestamp} >= ${new Date(startDate)}` : sql``}
    ${endDate ? sql`AND ${usageEvents.timestamp} <= ${new Date(endDate)}` : sql``}
    GROUP BY DATE_TRUNC('month', ${usageEvents.timestamp})
    ORDER BY billing_month DESC
  `);

  return c.json({ revenue: revenue.rows });
});

// Stripe webhook handler
router.post('/webhooks/stripe', async (c) => {
  if (!stripe) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  const payload = await c.req.text();
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400);
  }

  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );

    await handleStripeWebhook(c.get('db'), event);

    return c.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return c.json({ error: 'Invalid signature' }, 400);
  }
});

export default router;
