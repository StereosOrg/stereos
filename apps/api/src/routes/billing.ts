import { Hono } from 'hono';
import { getStripe, handleStripeWebhook } from '../lib/stripe.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

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
