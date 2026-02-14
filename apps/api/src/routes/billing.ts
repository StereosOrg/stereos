import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { customers } from '@stereos/shared/schema';
import { getStripe, handleStripeWebhook, createBillingPortalSession } from '../lib/stripe.js';
import { requireAuth, getCustomerForUser, getFrontendBaseUrl } from '../lib/middleware.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

// POST /v1/billing/portal - Create Stripe Billing Portal session (redirect to manage subscription)
router.post('/billing/portal', requireAuth as (c: unknown, next: () => Promise<void>) => Promise<void>, async (c) => {
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as unknown as import('../types/context.js').HonoContext, user.id);
  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404);
  }
  const db = c.get('db');
  const row = await db.query.customers.findFirst({
    where: eq(customers.id, customer.id),
    columns: { customer_stripe_id: true },
  });
  const stripeCustomerId = row?.customer_stripe_id ?? null;
  if (!stripeCustomerId || stripeCustomerId.startsWith('mock_')) {
    return c.json({ error: 'No Stripe customer. Add payment method first.' }, 400);
  }
  const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
  const baseUrl = getFrontendBaseUrl(c as unknown as import('../types/context.js').HonoContext);
  const returnUrl = `${baseUrl}/billing`;
  const result = await createBillingPortalSession(stripeCustomerId, returnUrl, stripeKey);
  if (!result) {
    return c.json({ error: 'Failed to create billing portal session' }, 500);
  }
  return c.json(result);
});

// Stripe webhook handler (uses c.env in Workers; process.env in Node)
router.post('/webhooks/stripe', async (c) => {
  const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string } }).env?.STRIPE_SECRET_KEY;
  const webhookSecret =
    (c as { env?: { STRIPE_WEBHOOK_SECRET?: string } }).env?.STRIPE_WEBHOOK_SECRET
    ?? (typeof process !== 'undefined' ? process.env?.STRIPE_WEBHOOK_SECRET : undefined)
    ?? '';
  const stripeClient = getStripe(stripeKey);
  if (!stripeClient) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  const payload = await c.req.text();
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400);
  }

  try {
    const event = await stripeClient.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret
    );

    await handleStripeWebhook(c.get('db'), event, stripeKey);

    return c.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return c.json({ error: 'Invalid signature' }, 400);
  }
});

export default router;
