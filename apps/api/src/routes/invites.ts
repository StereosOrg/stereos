import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { users, accounts, customers, invites } from '@stereos/shared/schema';
import { newUuid, newInviteToken } from '@stereos/shared/ids';
import { eq, and, isNull } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { getCurrentUser } from '../lib/middleware.js';
import { sendEmailViaResendFetch, INVITE_EMAIL_HTML } from '../lib/resend-fetch.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

const inviteCreateSchema = z.object({
  email: z.string().email('Invalid email'),
});

const inviteAcceptSchema = z.object({
  token: z.string().min(1, 'Token required'),
  name: z.string().min(1, 'Name required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

async function requireAdmin(c: any, next: any) {
  const user = await getCurrentUser(c);
  if (!user || (user as { role?: string }).role !== 'admin') return c.json({ error: 'Forbidden - Admin required' }, 403);
  c.set('adminUser', user);
  await next();
}

// POST /v1/invites - Create invite (admin only)
router.post('/invites', requireAdmin, zValidator('json', inviteCreateSchema), async (c) => {
  const adminUser = c.get('adminUser')!;
  const { email } = c.req.valid('json');
  const db = c.get('db');

  const customer = await db.query.customers.findFirst({
    where: eq(customers.user_id, adminUser.id),
    columns: { id: true, user_id: true, company_name: true },
  });
  if (!customer) return c.json({ error: 'Customer not found' }, 404);

  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
    columns: { id: true, customer_id: true },
  });
  if (existingUser?.customer_id === customer.id) {
    return c.json({ error: 'User is already in this workspace' }, 400);
  }
  if (existingUser && customer.user_id === existingUser.id) {
    return c.json({ error: 'User is already in this workspace' }, 400);
  }

  const token = newInviteToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const [invite] = await db
    .insert(invites)
    .values({
      customer_id: customer.id,
      email: email.toLowerCase(),
      token,
      expires_at: expiresAt,
      invited_by_user_id: adminUser.id,
    })
    .returning();

  // Invite link must point to the frontend (web app), not the API
  const env = (c.env as any) || {};
  const frontendUrl = env.FRONTEND_URL || env.TRUSTED_ORIGINS?.split(',')?.[0]?.trim() || 'http://localhost:5173';
  const inviteUrl = `${frontendUrl.replace(/\/$/, '')}/auth/accept-invite?token=${encodeURIComponent(token)}`;
  const inviterName = (await db.query.users.findFirst({ where: eq(users.id, adminUser!.id), columns: { name: true } }))?.name || 'A teammate';

  const apiKey = (c.env as any)?.RESEND_API_KEY as string | undefined;
  const fromEmail = (c.env as any)?.RESEND_FROM_EMAIL || 'hello@ops.trystereos.com';
  if (!apiKey) {
    console.warn('[Invites] RESEND_API_KEY not set; skipping invite email to', email);
  } else {
    try {
      const result = await sendEmailViaResendFetch({
        apiKey,
        from: fromEmail,
        to: email,
        subject: `You're invited to ${customer.company_name || 'the workspace'} on STEREOS`,
        html: INVITE_EMAIL_HTML(inviteUrl, inviterName, customer.company_name || 'the workspace'),
      });
      if (result.error) {
        throw new Error(result.error);
      }
    } catch (err) {
      console.error('[Invites] Email send failed, cleaning up invite record', err);
      await db.delete(invites).where(eq(invites.id, invite.id));
      return c.json({ error: 'Failed to send invite email' }, 500);
    }
  }

  return c.json({ invite: { id: invite.id, email: invite.email, expires_at: invite.expires_at } }, 201);
});

// GET /v1/invites/validate?token=xxx - Validate invite token (public)
router.get('/invites/validate', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ valid: false, error: 'Token required' }, 400);
  const db = c.get('db');

  const invite = await db.query.invites.findFirst({
    where: and(eq(invites.token, token), isNull(invites.used_at)),
    with: { customer: { columns: { company_name: true } } },
  });

  if (!invite) return c.json({ valid: false, error: 'Invalid or expired invite' }, 404);
  if (new Date() > invite.expires_at) return c.json({ valid: false, error: 'Invite expired' }, 400);

  return c.json({
    valid: true,
    email: invite.email,
    workspaceName: invite.customer?.company_name || 'the workspace',
  });
});

// POST /v1/invites/accept - Accept invite (create user + customer link)
router.post('/invites/accept', zValidator('json', inviteAcceptSchema), async (c) => {
  const { token, name, password } = c.req.valid('json');
  const db = c.get('db');

  const invite = await db.query.invites.findFirst({
    where: and(eq(invites.token, token), isNull(invites.used_at)),
    with: { customer: true },
  });

  if (!invite) return c.json({ error: 'Invalid or expired invite' }, 400);
  if (new Date() > invite.expires_at) return c.json({ error: 'Invite expired' }, 400);

  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, invite.email.toLowerCase()),
    columns: { id: true },
  });
  if (existingUser) return c.json({ error: 'An account with this email already exists. Sign in instead.' }, 400);

  const hashedPassword = await hashPassword(password);
  const userId = newUuid();

  await db.insert(users).values({
    id: userId,
    email: invite.email.toLowerCase(),
    name,
    emailVerified: true,
    role: 'user',
  });

  await db.insert(accounts).values({
    id: newUuid(),
    userId,
    accountId: userId,
    provider: 'credential',
    type: 'credential',
    password: hashedPassword,
  });

  const inviterCustomer = invite.customer;
  if (!inviterCustomer || typeof inviterCustomer !== 'object' || !('id' in inviterCustomer)) {
    return c.json({ error: 'Invite customer not found' }, 500);
  }
  const workspaceCustomerId = (inviterCustomer as { id: string }).id;

  // Join the same workspace (Customer); do NOT create a new Customer or Stripe customer
  await db.update(users).set({
    customer_id: workspaceCustomerId,
  }).where(eq(users.id, userId));

  await db.update(invites).set({ used_at: new Date() }).where(eq(invites.id, invite.id));

  return c.json({ success: true, message: 'Account created. Sign in to complete setup.' });
});

export default router;
