import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { users, customers, customerMembers, partners } from '@stereos/shared/schema';
import { eq, sql } from 'drizzle-orm';
import { createStripeCustomer, createEmbeddedCheckoutSession, confirmCheckoutSession } from '../lib/stripe.js';
import { requireAuth, getCurrentUser, getCustomerForUser, getMemberForUser, getFrontendBaseUrl } from '../lib/middleware.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

// Onboarding schema
const onboardingSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  title: z.enum(['engineer', 'manager', 'cto', 'founder', 'vp', 'lead', 'architect', 'product_manager']),
  image: z.string().optional(),
  companyName: z.string().min(1, 'Company name is required'),
  billingEmail: z.string().email('Valid email required'),
});

// GET /v1/onboarding/status - Check if user needs onboarding
router.get('/onboarding/status', async (c) => {
  try {
    const user = await getCurrentUser(c as unknown as import('../types/context.js').HonoContext);
    
    if (!user) {
      return c.json({ 
        needsAuth: true,
        needsOnboarding: true,
        needsPayment: true 
      });
    }

    const customer = await getCustomerForUser(c as unknown as import('../types/context.js').HonoContext, user!.id);
    const member = await getMemberForUser(c as unknown as import('../types/context.js').HonoContext, user.id);
    const onboardingDone = member ? member.onboarding_completed : (customer?.onboarding_completed ?? false);

    return c.json({
      needsAuth: false,
      needsOnboarding: !customer || !onboardingDone,
      needsPayment: !customer || !customer.payment_info_provided,
      isAdmin: user.role === 'admin',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        title: user.title,
      },
      customer: customer ? {
        company_name: customer.company_name,
        onboarding_completed: customer.onboarding_completed,
        payment_info_provided: customer.payment_info_provided,
      } : null,
    });
  } catch (error) {
    console.error('Error checking onboarding status:', error);
    return c.json({ error: 'Failed to check status' }, 500);
  }
});

// POST /v1/onboarding/complete - Complete onboarding and create or update customer
router.post('/onboarding/complete', requireAuth as (c: unknown, next: () => Promise<void>) => Promise<void>, zValidator('json', onboardingSchema), async (c) => {
  const data = c.req.valid('json') as { firstName: string; lastName: string; title: 'engineer' | 'manager' | 'cto' | 'founder' | 'vp' | 'lead' | 'architect' | 'product_manager'; image?: string; companyName: string; billingEmail: string };
  const user = c.get('user')!;
  const db = c.get('db');

  try {
    await db
      .update(users)
      .set({
        firstName: data.firstName,
        lastName: data.lastName,
        name: `${data.firstName} ${data.lastName}`,
        title: data.title,
        image: data.image || user.image,
      })
      .where(eq(users.id, user.id));

    const member = await getMemberForUser(c as unknown as import('../types/context.js').HonoContext, user.id);

    // Invited user: joined via CustomerMember; only update user + member onboarding, don't touch shared Customer
    if (member) {
      await db
        .update(customerMembers)
        .set({
          onboarding_completed: true,
          onboarding_completed_at: new Date(),
        })
        .where(eq(customerMembers.id, member.id));

      const customer = await getCustomerForUser(c as unknown as import('../types/context.js').HonoContext, user.id);
      return c.json({
        success: true,
        customer: customer ? { id: customer.id, company_name: customer.company_name, onboarding_completed: true } : null,
        isAdmin: false,
      }, 200);
    }

    // New sign-up: create customer (workspace owner)
    let partner = await db.query.partners.findFirst();
    if (!partner) {
      const [newPartner] = await db
        .insert(partners)
        .values({
          name: 'Default Partner',
          partner_id: 'default',
          secret_key: crypto.randomUUID(),
        })
        .returning();
      partner = newPartner;
    }

    const stripeCustomerId = await createStripeCustomer(data.billingEmail as string, data.companyName as string);
    const customerId = `cust_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;

    const [customer] = await db
      .insert(customers)
      .values({
        user_id: user.id,
        partner_id: partner.id,
        customer_id: customerId,
        customer_stripe_id: stripeCustomerId,
        company_name: data.companyName,
        billing_email: data.billingEmail,
        onboarding_completed: true,
        onboarding_completed_at: new Date(),
        payment_info_provided: false,
        billing_status: 'active',
      })
      .returning();

    await db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));

    return c.json({
      success: true,
      customer: {
        id: customer.id,
        company_name: customer.company_name,
        onboarding_completed: true,
      },
      isAdmin: true,
    }, 201);
  } catch (error) {
    console.error('Onboarding error:', error);
    return c.json({ error: 'Failed to complete onboarding' }, 500);
  }
});

// POST /v1/onboarding/checkout-session - Create embedded checkout session for start-trial (admins only)
router.post('/onboarding/checkout-session', requireAuth as (c: unknown, next: () => Promise<void>) => Promise<void>, async (c) => {
  const user = c.get('user')!;
  const db = c.get('db');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only workspace admins can start a trial' }, 403);
  }
  const customer = await getCustomerForUser(c as unknown as import('../types/context.js').HonoContext, user.id);
  if (!customer) {
    return c.json({ error: 'Customer not found. Complete onboarding first.' }, 404);
  }

  const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
  const cust = customer as { customer_stripe_id?: string | null; billing_email?: string | null; company_name?: string | null };
  let stripeCustomerId = cust.customer_stripe_id ?? '';
  if (!stripeCustomerId || stripeCustomerId.startsWith('mock_')) {
    stripeCustomerId = await createStripeCustomer(cust.billing_email ?? '', cust.company_name ?? '', stripeKey);
    if (stripeCustomerId.startsWith('mock_')) {
      return c.json(
        { error: 'Stripe is not configured on the server. Add STRIPE_SECRET_KEY to enable checkout.' },
        503
      );
    }
    await db
      .update(customers)
      .set({ customer_stripe_id: stripeCustomerId })
      .where(eq(customers.id, customer.id));
  }

  const baseUrl = getFrontendBaseUrl(c as unknown as import('../types/context.js').HonoContext);
  const returnUrl = `${baseUrl}/onboarding/start-trial?session_id={CHECKOUT_SESSION_ID}`;
  const result = await createEmbeddedCheckoutSession(
    customer.id,
    stripeCustomerId,
    returnUrl,
    stripeKey
  );
  if (!result) {
    return c.json({ error: 'Failed to create checkout session' }, 500);
  }
  return c.json(result);
});

// POST /v1/onboarding/confirm-checkout - Confirm embedded checkout after redirect (session_id from URL)
const confirmCheckoutSchema = z.object({ session_id: z.string().min(1) });
router.post('/onboarding/confirm-checkout', requireAuth as (c: unknown, next: () => Promise<void>) => Promise<void>, zValidator('json', confirmCheckoutSchema), async (c) => {
  const { session_id } = c.req.valid('json');
  const user = c.get('user')!;
  const customer = await getCustomerForUser(c as unknown as import('../types/context.js').HonoContext, user.id);
  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404);
  }
  const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;
  const result = await confirmCheckoutSession(c.get('db'), session_id, customer.id, stripeKey);
  if (!result.success) {
    return c.json({ error: result.error ?? 'Confirmation failed' }, 400);
  }
  return c.json({ success: true });
});

// GET /v1/customers/me - Get current user's customer info
router.get('/customers/me', requireAuth as (c: unknown, next: () => Promise<void>) => Promise<void>, async (c) => {
  const user = c.get('user')!;
  const db = c.get('db');

  try {
    const customer = await db.query.customers.findFirst({
      where: eq(customers.user_id, user.id),
      columns: {
        id: true,
        company_name: true,
        billing_email: true,
        logo_url: true,
        payment_info_provided: true,
        onboarding_completed: true,
        billing_status: true,
      },
    });

    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    return c.json({ customer });
  } catch (error) {
    console.error('Error fetching customer:', error);
    return c.json({ error: 'Failed to fetch customer' }, 500);
  }
});

// PATCH /v1/customers/me - Update customer info
router.patch('/customers/me', requireAuth as (c: unknown, next: () => Promise<void>) => Promise<void>, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json();
  const db = c.get('db');

  try {
    const updates: any = {};
    if (body.company_name) updates.company_name = body.company_name;
    if (body.billing_email) updates.billing_email = body.billing_email;
    if (body.logo_url !== undefined) updates.logo_url = body.logo_url;

    await db
      .update(customers)
      .set(updates)
      .where(eq(customers.user_id, user.id));

    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating customer:', error);
    return c.json({ error: 'Failed to update customer' }, 500);
  }
});

export default router;
