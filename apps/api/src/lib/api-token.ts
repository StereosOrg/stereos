import { apiTokens, customers } from '@stereos/shared/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser, getCustomerForUser } from './middleware.js';

// Validate API token (plain queries to avoid Drizzle relation setup)
export async function validateApiToken(c: { get: (k: 'db') => ReturnType<typeof import('@stereos/shared/db')['createDb']> }, token: string) {
  const db = c.get('db');
  const apiToken = await db.query.apiTokens.findFirst({
    where: eq(apiTokens.token, token),
  });

  if (!apiToken) {
    return null;
  }

  if (apiToken.expires_at && new Date(apiToken.expires_at) < new Date()) {
    return null;
  }

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, apiToken.customer_id),
    columns: { id: true, user_id: true, billing_status: true },
  });

  if (!customer) {
    return null;
  }

  // Update last_used
  await db
    .update(apiTokens)
    .set({ last_used: new Date() })
    .where(eq(apiTokens.id, apiToken.id));

  const userId = apiToken.user_id ?? customer.user_id;
  return {
    ...apiToken,
    user_id: userId,
    customer: {
      ...customer,
      user: { id: customer.user_id },
    },
  };
}

// Auth middleware — requires Bearer token
export const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  const apiToken = await validateApiToken(c, token);

  if (!apiToken) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // Allow trial and active statuses; block canceled
  if (apiToken.customer.billing_status === 'canceled') {
    return c.json({ error: 'Subscription canceled - please resubscribe to continue' }, 403);
  }

  c.set('apiToken', apiToken);
  await next();
};

// Auth for read routes: accept Bearer token OR session (so web app can use session cookie)
export const sessionOrTokenAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token && token !== 'null' && token !== 'undefined') {
      const apiToken = await validateApiToken(c, token);
      if (apiToken) {
        if (apiToken.customer.billing_status !== 'canceled') {
          c.set('apiToken', apiToken);
          return next();
        }
      }
    }
  }
  const user = await getCurrentUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const customer = await getCustomerForUser(c, user.id);
  if (!customer) return c.json({ error: 'Customer not found' }, 403);
  c.set('apiToken', {
    user_id: user.id,
    customer: {
      id: customer.id,
      user_id: user.id,
      billing_status: customer.billing_status,
    },
  });
  await next();
};

export type ApiTokenPayload = { user_id?: string | null; customer: { id: string; user_id?: string; billing_status: string }; [k: string]: unknown };
