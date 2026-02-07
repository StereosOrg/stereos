import Stripe from 'stripe';
import type { Database } from '@stereos/shared/db';
import { customers, usageEvents } from '@stereos/shared/schema';
import { eq } from 'drizzle-orm';

// Only initialize Stripe if API key is provided
const stripeApiKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeApiKey 
  ? new Stripe(stripeApiKey, {
      apiVersion: '2025-02-24.acacia',
    })
  : null;

export { stripe };

// Pricing configuration
export interface PricingTier {
  event_type: string;
  unit_price: number; // in cents
  unit: string;
}

export const pricingTiers: PricingTier[] = [
  {
    event_type: 'agent_action',
    unit_price: 1, // $0.01 per event
    unit: 'per_event',
  },
  {
    event_type: 'outcome',
    unit_price: 0.5, // $0.005 per outcome
    unit: 'per_event',
  },
  {
    event_type: 'storage',
    unit_price: 10, // $0.10 per GB
    unit: 'per_gb',
  },
];

export function getPricingForEvent(eventType: string): PricingTier {
  const tier = pricingTiers.find((t) => t.event_type === eventType);
  return tier || { event_type: eventType, unit_price: 1, unit: 'per_event' };
}

// Create Stripe customer (optional - returns mock ID if Stripe not configured)
export async function createStripeCustomer(email: string, name: string): Promise<string> {
  if (!stripe) {
    console.warn('Stripe not configured, using mock customer ID');
    return `mock_cust_${Date.now()}`;
  }
  
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      source: 'stereos_platform',
    },
  });
  return customer.id;
}

// Create usage record in Stripe (optional)
export async function createStripeUsageRecord(
  stripeCustomerId: string,
  quantity: number,
  timestamp: Date
): Promise<void> {
  if (!stripe) {
    console.warn('Stripe not configured, skipping usage record');
    return;
  }

  // Skip if using mock customer ID
  if (stripeCustomerId.startsWith('mock_')) {
    return;
  }

  try {
    // Find the subscription for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'active',
    });

    if (subscriptions.data.length === 0) {
      console.warn('No active subscription found for customer:', stripeCustomerId);
      return;
    }

    const subscription = subscriptions.data[0];
    const subscriptionItem = subscription.items.data[0];

    await stripe.subscriptionItems.createUsageRecord(subscriptionItem.id, {
      quantity,
      timestamp: Math.floor(timestamp.getTime() / 1000),
      action: 'increment',
    });
  } catch (error: unknown) {
    // Subscription may use Stripe's new metered billing (meter events), not legacy usage records
    const msg = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '';
    if (msg.includes('not on the legacy metered billing system') || msg.includes('meter_events')) {
      return; // Skip silently; usage is still recorded in our DB
    }
    console.error('Failed to create Stripe usage record:', error);
  }
}

// Track usage event
export async function trackUsage(
  db: Database,
  customerId: string,
  partnerId: string,
  eventType: string,
  quantity: number = 1,
  metadata?: Record<string, unknown>
): Promise<void> {
  const pricing = getPricingForEvent(eventType);
  const totalPrice = (pricing.unit_price * quantity) / 100; // Convert cents to dollars

  // Create usage event record
  await db.insert(usageEvents).values({
    customer_id: customerId,
    partner_id: partnerId,
    event_type: eventType,
    idempotency_key: `${customerId}-${eventType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    quantity,
    unit_price: pricing.unit_price.toString(),
    total_price: totalPrice.toFixed(4),
    metadata: { ...metadata, pricing_tier: pricing.unit },
  });

  // Update Stripe usage record (optional)
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
  });

  if (customer?.customer_stripe_id) {
    await createStripeUsageRecord(customer.customer_stripe_id, quantity, new Date());
  }
}

// Price ID for start-trial embedded checkout (subscription)
const START_TRIAL_PRICE_ID = 'price_1Sy4W0FLodImBHZELOgKS6Jc';

// Create Stripe Embedded Checkout Session for start-trial (returns client_secret for embedding)
export async function createEmbeddedCheckoutSession(
  customerId: string,
  stripeCustomerId: string,
  returnUrl: string
): Promise<{ clientSecret: string } | null> {
  if (!stripe) {
    console.warn('Stripe not configured, cannot create embedded checkout session');
    return null;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      return_url: returnUrl,
      customer: stripeCustomerId,
      metadata: { customer_id: customerId },
      line_items: [
        {
          price: START_TRIAL_PRICE_ID,
          // Omit quantity for metered prices (usage_type = metered)
        },
      ],
      subscription_data: {
        metadata: {
          customer_id: customerId,
        },
      },
    });
    return session.client_secret ? { clientSecret: session.client_secret } : null;
  } catch (error) {
    console.error('Failed to create embedded checkout session:', error);
    return null;
  }
}

// Confirm embedded checkout session and mark customer as paid (idempotent). If expectedCustomerId is set, session must belong to that customer.
export async function confirmCheckoutSession(
  db: Database,
  sessionId: string,
  expectedCustomerId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!stripe) {
    return { success: false, error: 'Stripe not configured' };
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
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

// Handle Stripe webhook events (optional)
export async function handleStripeWebhook(db: Database, event: Stripe.Event): Promise<void> {
  if (!stripe) {
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
  // Extract customer_id from subscription metadata
  const customerId = subscription.metadata?.customer_id;
  if (!customerId) {
    console.warn('No customer_id in subscription metadata');
    return;
  }

  // Update customer with payment info and subscription ID
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
