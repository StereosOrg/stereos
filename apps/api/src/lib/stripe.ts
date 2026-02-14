import Stripe from 'stripe';
import type { Database } from '@stereos/shared/db';
import { customers, usageEvents } from '@stereos/shared/schema';
import { eq } from 'drizzle-orm';

// Custom checkout (ui_mode: 'custom') requires 2025-03-31.basil; Stripe Node types may still reference acacia.
const STRIPE_API_VERSION = '2025-03-31.basil' as '2025-02-24.acacia';

// ── Price IDs (must match Stripe Dashboard) ────────────────────────────────

/** Telemetry Events: metered, $0.0025 per event */
export const PRICE_ID_TELEMETRY_EVENTS = 'price_1SzCuEFRJliLrxglL7b3fpHW';
export const TELEMETRY_EVENTS_UNIT_PRICE = 0.0025;

/** Tool profiles: metered, $75.00 per tool profile */
export const PRICE_ID_TOOL_PROFILES = 'price_1SzCqLFRJliLrxglOMAPx25f';
export const TOOL_PROFILES_UNIT_PRICE = 75;

/** Flat monthly: $450/mo (recurring line item) */
export const PRICE_ID_FLAT_MONTHLY = 'price_1SzCv0FRJliLrxglgIuO5cdX';

/** Managed keys: metered, per OpenRouter key created in portal */
export const PRICE_ID_MANAGED_KEYS = 'price_1T0bTQFRJliLrxgl0Hu8D8GO';

/** Stripe meter event names (must match meters in Stripe Dashboard) */
export const STRIPE_METER_EVENT_TELEMETRY_EVENTS = 'telemetry_events';
export const STRIPE_METER_EVENT_TOOL_PROFILES = 'tool_profiles';
export const STRIPE_METER_EVENT_MANAGED_KEYS = 'managed_keys';

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

/** Report usage to Stripe via the Billing Meter Events API. */
export async function createStripeMeterEvent(
  eventName: string,
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
      event_name: eventName,
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

/** Track telemetry events usage. Records in DB and reports to Stripe Telemetry Events meter ($0.0025/event). */
export async function trackTelemetryEventsUsage(
  db: Database,
  customerId: string,
  quantity: number,
  metadata?: Record<string, unknown>,
  stripeApiKey?: string
): Promise<void> {
  const totalPrice = TELEMETRY_EVENTS_UNIT_PRICE * quantity;
  const idempotencyKey = `${customerId}-telemetry_events-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  await db.insert(usageEvents).values({
    customer_id: customerId,
    event_type: 'telemetry_event',
    idempotency_key: idempotencyKey,
    quantity,
    unit_price: TELEMETRY_EVENTS_UNIT_PRICE.toFixed(4),
    total_price: totalPrice.toFixed(4),
    metadata: metadata ? { ...metadata } : {},
  });

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { customer_stripe_id: true },
  });
  if (customer?.customer_stripe_id) {
    await createStripeMeterEvent(
      STRIPE_METER_EVENT_TELEMETRY_EVENTS,
      customer.customer_stripe_id,
      quantity,
      new Date(),
      idempotencyKey,
      stripeApiKey
    );
  }
}

/** Track tool profiles usage. Records in DB and reports to Stripe Tool Profiles meter ($75/profile). Call when a new tool profile is created. */
export async function trackToolProfilesUsage(
  db: Database,
  customerId: string,
  quantity: number,
  metadata?: Record<string, unknown>,
  stripeApiKey?: string
): Promise<void> {
  const totalPrice = TOOL_PROFILES_UNIT_PRICE * quantity;
  const idempotencyKey = `${customerId}-tool_profiles-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  await db.insert(usageEvents).values({
    customer_id: customerId,
    event_type: 'tool_profile',
    idempotency_key: idempotencyKey,
    quantity,
    unit_price: TOOL_PROFILES_UNIT_PRICE.toFixed(2),
    total_price: totalPrice.toFixed(2),
    metadata: metadata ? { ...metadata } : {},
  });

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { customer_stripe_id: true },
  });
  if (customer?.customer_stripe_id) {
    await createStripeMeterEvent(
      STRIPE_METER_EVENT_TOOL_PROFILES,
      customer.customer_stripe_id,
      quantity,
      new Date(),
      idempotencyKey,
      stripeApiKey
    );
  }
}

/** Track managed OpenRouter keys. Reports to Stripe managed_keys meter when a key is created in the portal. */
export async function trackManagedKeysUsage(
  db: Database,
  customerId: string,
  quantity: number,
  metadata?: Record<string, unknown>,
  stripeApiKey?: string
): Promise<void> {
  const idempotencyKey = `${customerId}-managed_keys-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  await db.insert(usageEvents).values({
    customer_id: customerId,
    event_type: 'managed_key',
    idempotency_key: idempotencyKey,
    quantity,
    unit_price: '0',
    total_price: '0',
    metadata: metadata ? { ...metadata } : {},
  });

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { customer_stripe_id: true },
  });
  if (customer?.customer_stripe_id) {
    await createStripeMeterEvent(
      STRIPE_METER_EVENT_MANAGED_KEYS,
      customer.customer_stripe_id,
      quantity,
      new Date(),
      idempotencyKey,
      stripeApiKey
    );
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
        { price: PRICE_ID_TELEMETRY_EVENTS },
        { price: PRICE_ID_TOOL_PROFILES },
        { price: PRICE_ID_FLAT_MONTHLY, quantity: 1 },
      ],
      subscription_data: {
        trial_period_days: 14,
        metadata: { customer_id: customerId },
      },
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

/** Create Stripe Billing Portal session for managing subscription (update payment, view invoices, cancel). */
export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string,
  stripeApiKey?: string
): Promise<{ url: string } | null> {
  const client = getStripe(stripeApiKey);
  if (!client) {
    console.warn('Stripe not configured, cannot create billing portal session');
    return null;
  }
  if (stripeCustomerId.startsWith('mock_')) {
    return null;
  }
  try {
    const session = await client.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
    return session.url ? { url: session.url } : null;
  } catch (error) {
    console.error('Failed to create billing portal session:', error);
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
    // Accept complete sessions: paid now, or trialing (14-day trial — no charge yet)
    if (session.status !== 'complete') {
      return { success: false, error: 'Session not complete' };
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
  const stripeCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;

  // Only set 'unpaid' if the deleted subscription is the one we have on record,
  // or if no other active/trialing subscription exists for this customer.
  const customerRow = await db.query.customers.findFirst({
    where: eq(customers.customer_stripe_id, stripeCustomerId),
    columns: { stripe_subscription_id: true },
  });

  // If the deleted subscription isn't the one stored, check if the stored one is still valid
  if (customerRow?.stripe_subscription_id && customerRow.stripe_subscription_id !== subscription.id) {
    // A different subscription was deleted — the customer's current subscription is unaffected
    return;
  }

  // The current subscription was deleted — check if another active/trialing subscription exists
  const hasOther = await customerHasActiveOrTrialingSubscription(stripeCustomerId);
  if (hasOther) {
    return;
  }

  await db
    .update(customers)
    .set({ billing_status: 'canceled' })
    .where(eq(customers.customer_stripe_id, stripeCustomerId));
}

/** Returns true if the Stripe customer has any subscription that is active or trialing (e.g. on trial). */
export async function customerHasActiveOrTrialingSubscription(
  stripeCustomerId: string,
  stripeApiKey?: string
): Promise<boolean> {
  const client = getStripe(stripeApiKey);
  if (!client) {
    console.warn('Stripe not configured — cannot verify subscription for', stripeCustomerId);
    return false;
  }
  if (stripeCustomerId.startsWith('mock_')) return false;
  try {
    const subs = await client.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 10,
    });
    const match = subs.data.find((s) => s.status === 'active' || s.status === 'trialing');
    if (!match) {
      console.warn(`No active/trialing subscription for ${stripeCustomerId}. Statuses: ${subs.data.map((s) => s.status).join(', ') || 'none'}`);
    }
    return !!match;
  } catch (err) {
    console.error(`Stripe subscription check failed for ${stripeCustomerId}:`, err);
    return false;
  }
}
