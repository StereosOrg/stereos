import Stripe from 'stripe';
import type { Database } from '@stereos/shared/db';
import { customers, usageEvents } from '@stereos/shared/schema';
import { eq } from 'drizzle-orm';

// Custom checkout (ui_mode: 'custom') requires 2025-03-31.basil; Stripe Node types may still reference acacia.
const STRIPE_API_VERSION = '2025-03-31.basil' as '2025-02-24.acacia';

/** Single usage-based plan: $0.12 per unit per month */
export const USAGE_PRICE_ID = 'price_1Sy4W0FLodImBHZELOgKS6Jc';
const UNIT_PRICE_CENTS = 12; // $0.12 per unit

/** Stripe meter event name for provenance events (must match meter in Stripe Dashboard) */
export const STRIPE_METER_EVENT_NAME = 'provenance_events';

/** Get Stripe client. In Workers pass c.env.STRIPE_SECRET_KEY; in Node uses process.env. */
export function getStripe(apiKey?: string): Stripe | null {
  const key = apiKey ?? (typeof process !== 'undefined' && process.env?.STRIPE_SECRET_KEY);
  return key ? new Stripe(key, { apiVersion: STRIPE_API_VERSION }) : null;
}

// For backward compatibility where env is not passed (Node with process.env)
const stripe = getStripe();
export { stripe };

// Create Stripe customer (optional - returns mock ID if Stripe not configured). Pass stripeApiKey in Workers (c.env.STRIPE_SECRET_KEY).
export async function createStripeCustomer(email: string, name: string, stripeApiKey?: string): Promise<string> {
  const client = getStripe(stripeApiKey);
  if (!client) {
    console.warn('Stripe not configured, using mock customer ID');
    return `mock_cust_${Date.now()}`;
  }
  const customer = await client.customers.create({
    email,
    name,
    metadata: {
      source: 'stereos_platform',
    },
  });
  return customer.id;
}

// Report usage to Stripe via the Billing Meter Events API (provenance_events meter).
export async function createStripeMeterEvent(
  stripeCustomerId: string,
  value: number,
  timestamp: Date,
  idempotencyKey: string,
  stripeApiKey?: string
): Promise<void> {
  const client = getStripe(stripeApiKey);
  if (!client) {
    console.warn('Stripe not configured, skipping meter event');
    return;
  }
  if (stripeCustomerId.startsWith('mock_')) {
    return;
  }
  try {
    await client.billing.meterEvents.create({
      event_name: STRIPE_METER_EVENT_NAME,
      payload: {
        stripe_customer_id: stripeCustomerId,
        value: String(value),
      },
      timestamp: Math.floor(timestamp.getTime() / 1000),
      identifier: idempotencyKey.slice(0, 100),
    });
  } catch (error: unknown) {
    console.error('Failed to create Stripe meter event:', error);
  }
}

// Track usage event. Single plan: $0.12 per unit per month. Records in DB.
// When reportToStripeMeter is true, also sends to Stripe meter "provenance_events" (call this only when a provenance event is created).
export async function trackUsage(
  db: Database,
  customerId: string,
  partnerId: string,
  eventType: string,
  quantity: number = 1,
  metadata?: Record<string, unknown>,
  stripeApiKey?: string,
  reportToStripeMeter: boolean = false
): Promise<void> {
  const totalPrice = (UNIT_PRICE_CENTS * quantity) / 100; // cents -> dollars
  const idempotencyKey = `${customerId}-${eventType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  await db.insert(usageEvents).values({
    customer_id: customerId,
    partner_id: partnerId,
    event_type: eventType,
    idempotency_key: idempotencyKey,
    quantity,
    unit_price: (UNIT_PRICE_CENTS / 100).toFixed(4),
    total_price: totalPrice.toFixed(4),
    metadata: { ...metadata },
  });

  if (reportToStripeMeter) {
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, customerId),
    });
    if (customer?.customer_stripe_id) {
      const now = new Date();
      await createStripeMeterEvent(customer.customer_stripe_id, quantity, now, idempotencyKey, stripeApiKey);
    }
  }
}

// Create Stripe Checkout Session (custom UI) for start-trial. Pass stripeApiKey in Workers.
export async function createEmbeddedCheckoutSession(
  customerId: string,
  stripeCustomerId: string,
  returnUrl: string,
  stripeApiKey?: string
): Promise<{ clientSecret: string } | null> {
  const client = getStripe(stripeApiKey);
  if (!client) {
    console.warn('Stripe not configured, cannot create embedded checkout session');
    return null;
  }
  try {
    const createParams = {
      mode: 'subscription',
      ui_mode: 'custom',
      return_url: returnUrl,
      customer: stripeCustomerId,
      metadata: { customer_id: customerId },
      line_items: [
        { price: USAGE_PRICE_ID },
        { price: 'price_1SyXeyFLodImBHZEmzi5Z2qr', quantity: 1 },
      ],
      subscription_data: { metadata: { customer_id: customerId } },
    } as unknown as Stripe.Checkout.SessionCreateParams;
    const session = await client.checkout.sessions.create(createParams, {
      apiVersion: '2025-03-31.basil',
    });
    return session.client_secret ? { clientSecret: session.client_secret } : null;
  } catch (error) {
    console.error('Failed to create embedded checkout session:', error);
    return null;
  }
}

// Confirm embedded checkout session. Pass stripeApiKey in Workers.
export async function confirmCheckoutSession(
  db: Database,
  sessionId: string,
  expectedCustomerId?: string,
  stripeApiKey?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getStripe(stripeApiKey);
  if (!client) {
    return { success: false, error: 'Stripe not configured' };
  }
  try {
    const session = await client.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });
    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return { success: false, error: 'Session not paid' };
    }
    const customerId = session.metadata?.customer_id as string | undefined;
    if (!customerId) {
      return { success: false, error: 'No customer in session' };
    }
    if (expectedCustomerId && customerId !== expectedCustomerId) {
      return { success: false, error: 'Session does not belong to this customer' };
    }
    const subscriptionId = typeof session.subscription === 'object' && session.subscription?.id
      ? session.subscription.id
      : typeof session.subscription === 'string'
        ? session.subscription
        : null;
    await db
      .update(customers)
      .set({
        payment_info_provided: true,
        ...(subscriptionId && { stripe_subscription_id: subscriptionId }),
        billing_status: 'active',
      })
      .where(eq(customers.id, customerId));
    return { success: true };
  } catch (error) {
    console.error('Failed to confirm checkout session:', error);
    return { success: false, error: 'Failed to confirm session' };
  }
}

// Handle Stripe webhook events. Pass stripeApiKey in Workers (optional for webhook validation).
export async function handleStripeWebhook(db: Database, event: Stripe.Event, _stripeApiKey?: string): Promise<void> {
  const client = getStripe(_stripeApiKey);
  if (!client) {
    console.warn('Stripe not configured, skipping webhook');
    return;
  }

  switch (event.type) {
    case 'customer.subscription.created': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionCreated(db, subscription);
      break;
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      await handlePaymentSucceeded(db, invoice);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await handlePaymentFailed(db, invoice);
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(db, subscription);
      break;
    }
  }
}

async function handleSubscriptionCreated(db: Database, subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.metadata?.customer_id;
  if (!customerId) {
    console.warn('No customer_id in subscription metadata');
    return;
  }

  await db
    .update(customers)
    .set({
      payment_info_provided: true,
      stripe_subscription_id: subscription.id,
      billing_status: 'active',
    })
    .where(eq(customers.id, customerId));

  console.log(`Payment confirmed for customer: ${customerId}`);
}

async function handlePaymentSucceeded(db: Database, invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.customer) return;

  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer.id;

  await db
    .update(customers)
    .set({ billing_status: 'active' })
    .where(eq(customers.customer_stripe_id, customerId));
}

async function handlePaymentFailed(db: Database, invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.customer) return;

  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer.id;

  await db
    .update(customers)
    .set({ billing_status: 'past_due' })
    .where(eq(customers.customer_stripe_id, customerId));
}

async function handleSubscriptionDeleted(db: Database, subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;

  await db
    .update(customers)
    .set({ billing_status: 'unpaid' })
    .where(eq(customers.customer_stripe_id, customerId));
}
