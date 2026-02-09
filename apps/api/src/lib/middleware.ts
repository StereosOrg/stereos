import { Hono } from 'hono';
import { users, customers, sessions } from '@stereos/shared/schema';
import { eq, and, gt } from 'drizzle-orm';
import { HonoMiddlewareContext, RequireAuthContext, RequireOnboardingContext, RequirePaymentContext } from '../types/context.js';

type EnvLike = { TRUSTED_ORIGINS?: string; BASE_URL?: string; FRONTEND_URL?: string } | undefined;

/** Frontend base URL for redirects (Worker: use TRUSTED_ORIGINS; Node: process.env). */
export function getFrontendBaseUrl(c: HonoMiddlewareContext): string {
  const env = (c as { env?: EnvLike }).env;
  const fromEnv = env?.TRUSTED_ORIGINS?.split(',')[0]?.trim() || env?.FRONTEND_URL?.trim();
  if (fromEnv) return fromEnv;
  return process.env.FRONTEND_URL || process.env.TRUSTED_ORIGINS?.split(',')[0]?.trim() || process.env.BASE_URL || 'http://localhost:5173';
}

// Get current user from Better Auth session (or from Bearer token → Session table for magic-link exchange tokens)
export async function getCurrentUser(c: HonoMiddlewareContext) {
  try {
    const auth = c.get('auth');
    let session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    // Fallback: magic-link exchange creates sessions we insert directly; better-auth getSession may not find them
    if (!session?.user?.id) {
      const bearer = c.req.header('Authorization');
      const token = bearer?.startsWith('Bearer ') ? bearer.slice(7).trim() : null;
      if (token) {
        const db = c.get('db');
        const now = new Date();
        const row = await db.query.sessions.findFirst({
          where: and(eq(sessions.sessionToken, token), gt(sessions.expires, now)),
          columns: { userId: true },
        });
        if (row) {
          const user = await db.query.users.findFirst({
            where: eq(users.id, row.userId),
            columns: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              name: true,
              image: true,
              title: true,
              role: true,
            },
          });
          return user ?? null;
        }
      }
      return null;
    }

    const db = c.get('db');
    const user = await db.query.users.findFirst({
      where: eq(users.id, session!.user.id),
      columns: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        name: true,
        image: true,
        title: true,
        role: true,
      },
    });

    return user;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

const customerColumns = {
  id: true,
  partner_id: true,
  company_name: true,
  billing_email: true,
  logo_url: true,
  payment_info_provided: true,
  onboarding_completed: true,
  billing_status: true,
} as const;

// Resolve the customer for a user: check users.customer_id first, fall back to customers.user_id (owner).
export async function getCustomerForUser(c: HonoMiddlewareContext, userId: string) {
  const db = c.get('db');

  // Check user's customer_id column (set for both owners and invited members)
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { customer_id: true },
  });
  if (user?.customer_id) {
    return db.query.customers.findFirst({
      where: eq(customers.id, user.customer_id),
      columns: customerColumns,
    });
  }

  // Backwards compat: owner may not have customer_id set yet (pre-migration)
  return db.query.customers.findFirst({
    where: eq(customers.user_id, userId),
    columns: customerColumns,
  });
}

// Middleware: Require authentication (redirect to login if not authenticated)
export async function requireAuth(c: HonoMiddlewareContext, next: () => Promise<void>) {
  const user = await getCurrentUser(c);
  
  if (!user) {
    // For API requests that expect JSON, return 401
    // For browser requests, redirect to login
    const acceptHeader = c.req.header('accept') || '';
    const isBrowserRequest = acceptHeader.includes('text/html');
    
    if (isBrowserRequest) {
      const baseUrl = getFrontendBaseUrl(c);
      const currentPath = encodeURIComponent(c.req.path);
      return c.redirect(`${baseUrl}/auth/sign-in?redirect=${currentPath}`, 302);
    } else {
      // Return 401 for API requests
      return c.json({ 
        error: 'Unauthorized',
        needsAuth: true,
        redirect: '/auth/sign-in'
      }, 401);
    }
  }

  c.set('user', user);
  await next();
}

// Middleware: Require onboarding completion
export async function requireOnboarding(c: RequireOnboardingContext, next: () => Promise<void>) {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'Unauthorized', needsAuth: true }, 401);
  }

  const customer = await getCustomerForUser(c, user.id);

  // Check onboarding_completed from users table
  const db = c.get('db');
  const fullUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
    columns: { onboarding_completed: true },
  });
  const onboardingDone = fullUser?.onboarding_completed ?? false;

  // If no customer record or onboarding not completed
  if (!customer || !onboardingDone) {
    const baseUrl = getFrontendBaseUrl(c);
    const acceptHeader = c.req.header('accept') || '';
    const isBrowserRequest = acceptHeader.includes('text/html');
    
    if (isBrowserRequest) {
      return c.redirect(`${baseUrl}/onboarding`, 302);
    } else {
      return c.json({ 
        error: 'Onboarding required',
        needsOnboarding: true,
        redirect: '/onboarding'
      }, 403);
    }
  }

  c.set('customer', customer);
  await next();
}

// Middleware: Require payment info
export async function requirePayment(c: RequirePaymentContext, next: () => Promise<void>) {
  const customer = c.get('customer');
  const user = c.get('user');

  if (!customer) {
    return c.json({ error: 'Customer not found', needsOnboarding: true }, 403);
  }

  // Block if payment not provided
  if (!customer.payment_info_provided) {
    const baseUrl = getFrontendBaseUrl(c);
    const acceptHeader = c.req.header('accept') || '';
    const isBrowserRequest = acceptHeader.includes('text/html');
    const isAdmin = user && (user as { role?: string }).role === 'admin';
    const redirectPath = isAdmin ? '/onboarding/start-trial' : '/onboarding/pending';

    if (isBrowserRequest) {
      return c.redirect(`${baseUrl}${redirectPath}`, 302);
    } else {
      return c.json({
        error: 'Payment required',
        needsPayment: true,
        redirect: redirectPath,
      }, 403);
    }
  }

  await next();
}

// Combined middleware for protected routes
export async function requireAuthAndOnboarding(c: HonoMiddlewareContext, next: () => Promise<void>) {
  await requireAuth(c, async () => {
    await requireOnboarding(c as RequireOnboardingContext, async () => {
      await next();
    });
  });
}

// Combined middleware for full protection (auth + onboarding + payment)
export async function requireFullAccess(c: HonoMiddlewareContext, next: () => Promise<void>) {
  await requireAuth(c, async () => {
    await requireOnboarding(c as RequireOnboardingContext, async () => {
      await requirePayment(c as RequirePaymentContext, async () => {
        await next();
      });
    });
  });
}

// Middleware: Set user in context from session (optional, for routes that don't require auth)
export async function optionalAuth(c: HonoMiddlewareContext, next: () => Promise<void>) {
  const user = await getCurrentUser(c);
  if (user) {
    c.set('user', user);
  }
  await next();
}
