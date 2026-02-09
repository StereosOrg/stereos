import { Hono } from 'hono';
import { users, provenanceEvents, usageEvents, customers } from '@stereos/shared/schema';
import { eq, desc, sql, and } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getCurrentUser, getCustomerForUser } from '../lib/middleware.js';
import type { AppVariables } from '../types/app.js';

const updateMeSchema = z.object({
  image: z
    .union([z.string().url('Must be a valid URL'), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v == null || v === '' ? null : v)),
});

const router = new Hono<{ Variables: AppVariables }>();

function sqlRows(result: unknown): unknown[] {
  return Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows ?? [];
}

// Middleware to check if user is admin (uses getCurrentUser so Bearer/magic-link sessions work)
const requireAdmin = async (c: any, next: any) => {
  const user = await getCurrentUser(c);
  if (!user || (user as { role?: string }).role !== 'admin') {
    return c.json({ error: 'Forbidden - Admin access required' }, 403);
  }
  c.set('user', user);
  await next();
};

// Middleware to check authentication (any logged-in user; uses getCurrentUser so Bearer/magic-link sessions work)
const requireAuth = async (c: any, next: any) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('user', user);
  await next();
};

// GET /v1/users - List all users (admin only)
router.get('/users', requireAdmin, async (c) => {
  try {
    const db = c.get('db');
    const allUsers = await db.query.users.findMany({
      columns: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        image: true,
      },
      orderBy: desc(users.createdAt),
    });
    
    return c.json({ users: allUsers });
  } catch (error) {
    console.error('Error fetching users:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

// GET /v1/users/:userId/profile - Get detailed user profile with usage history (admin only)
router.get('/users/:userId/profile', requireAdmin, async (c) => {
  const userId = c.req.param('userId');
  const db = c.get('db');
  
  try {
    // Get user details (customer resolved via users.customer_id or ownership)
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        image: true,
      },
      with: {
        customer: {
          with: {
            partner: true,
          },
        },
      },
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const workspaceCustomer = user.customer?.[0] ?? (await getCustomerForUser(c as unknown as import('../types/context.js').HonoContext, userId));
    const customerId = workspaceCustomer?.id ?? '';
    
    // Get usage statistics
    const usageStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT DATE_TRUNC('day', timestamp)) as active_days,
        MIN(timestamp) as first_activity,
        MAX(timestamp) as last_activity
      FROM "ProvenanceEvent"
      WHERE user_id = ${userId}
    `);
    
    // Get provenance events history (last 50)
    const recentEvents = await db.query.provenanceEvents.findMany({
      where: eq(provenanceEvents.user_id, userId),
      with: {
        artifacts: true,
        outcomes: true,
      },
      orderBy: desc(provenanceEvents.timestamp),
      limit: 50,
    });
    
    // Get usage events/billing history (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

    const billingHistory = await db.query.usageEvents.findMany({
      where: and(
        eq(usageEvents.customer_id, customerId),
        sql`${usageEvents.timestamp} >= ${thirtyDaysAgoStr}::timestamptz`
      ),
      orderBy: desc(usageEvents.timestamp),
      limit: 100,
    });
    
    // Calculate monthly usage stats
    const monthlyStats = await db.execute(sql`
      SELECT 
        DATE_TRUNC('month', timestamp) as month,
        COUNT(*) as event_count,
        SUM(CASE WHEN event_type = 'agent_action' THEN 1 ELSE 0 END) as agent_actions,
        SUM(CASE WHEN event_type = 'outcome' THEN 1 ELSE 0 END) as outcomes,
        SUM(quantity) as total_quantity,
        SUM(total_price) as total_cost
      FROM "UsageEvent"
      WHERE customer_id = ${customerId}
      GROUP BY DATE_TRUNC('month', timestamp)
      ORDER BY month DESC
      LIMIT 12
    `);
    
    // Get file activity (most modified files)
    const fileActivity = await db.execute(sql`
      SELECT 
        unnest(files_written) as file_path,
        COUNT(*) as modification_count,
        MAX(timestamp) as last_modified
      FROM "ProvenanceEvent"
      WHERE user_id = ${userId}
        AND files_written IS NOT NULL
        AND array_length(files_written, 1) > 0
      GROUP BY unnest(files_written)
      ORDER BY modification_count DESC
      LIMIT 10
    `);
    
    const usageRows = sqlRows(usageStats);
    const monthlyRows = sqlRows(monthlyStats);
    const fileRows = sqlRows(fileActivity);

    let favoriteTool: string | null = null;
    try {
      const favoriteToolResult = await db.execute(sql`
        SELECT favorite_tool FROM "UserFavoriteToolMonthly"
        WHERE user_id = ${userId}
          AND month = DATE_TRUNC('month', CURRENT_DATE)
        LIMIT 1
      `);
      const favoriteToolRows = sqlRows(favoriteToolResult);
      favoriteTool = (favoriteToolRows[0] as { favorite_tool?: string } | undefined)?.favorite_tool ?? null;
    } catch (e: unknown) {
      // View may not exist yet if migration 015 has not been run
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '42P01') {
        console.warn('UserFavoriteToolMonthly not found; run db:migrate. favorite_tool will be null.');
      } else {
        console.warn('Failed to read favorite_tool:', e);
      }
    }

    const stats = usageRows[0] as Record<string, unknown> | undefined;
    return c.json({
      profile: {
        user,
        customer: workspaceCustomer ?? (Array.isArray(user.customer) ? user.customer[0] ?? null : user.customer ?? null),
      },
      usage: {
        stats: {
          ...(stats || {
            total_events: 0,
            active_days: 0,
            first_activity: null,
            last_activity: null,
          }),
          favorite_tool: favoriteTool,
        },
        monthly: monthlyRows,
        files: fileRows,
      },
      history: {
        recentEvents,
        billing: billingHistory,
      },
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return c.json({ error: 'Failed to fetch user profile' }, 500);
  }
});

// PATCH /v1/users/:userId/role - Update user role (admin only)
router.patch('/users/:userId/role', requireAdmin, async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json();
  const { role } = body;
  const db = c.get('db');
  
  if (!role || !['admin', 'user'].includes(role)) {
    return c.json({ error: 'Invalid role. Must be "admin" or "user"' }, 400);
  }
  
  try {
    // Prevent admin from demoting themselves if they're the only admin
    if (role === 'user') {
      const currentUser = c.get('user')!;
      if (currentUser.id === userId) {
        const adminCount = await db.execute(sql`
          SELECT COUNT(*) as count FROM "User" WHERE role = 'admin'
        `);
        const adminRows = sqlRows(adminCount);
        const count = (adminRows[0] as { count?: string | number } | undefined)?.count;
        if (parseInt(String(count ?? 0)) <= 1) {
          return c.json({ error: 'Cannot demote the only admin' }, 400);
        }
      }
    }
    
    await db
      .update(users)
      .set({ role })
      .where(eq(users.id, userId));
    
    return c.json({ success: true, message: `User role updated to ${role}` });
  } catch (error) {
    console.error('Error updating user role:', error);
    return c.json({ error: 'Failed to update user role' }, 500);
  }
});

// PATCH /v1/me - Update current user profile (e.g. image URL)
router.patch('/me', requireAuth, zValidator('json', updateMeSchema), async (c) => {
  const currentUser = c.get('user')!;
  const data = c.req.valid('json');
  const db = c.get('db');
  try {
    await db
      .update(users)
      .set({ image: data.image ?? null })
      .where(eq(users.id, currentUser.id));
    const user = await db.query.users.findFirst({
      where: eq(users.id, currentUser.id),
      columns: { id: true, email: true, name: true, role: true, createdAt: true, image: true },
    });
    return c.json({ user });
  } catch (error) {
    console.error('Error updating profile:', error);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
});

// GET /v1/me - Get current user profile (any authenticated user)
router.get('/me', requireAuth, async (c) => {
  const currentUser = c.get('user')!;
  const db = c.get('db');
  
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, currentUser.id),
      columns: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        image: true,
      },
      with: {
        customer: {
          with: {
            partner: true,
          },
        },
      },
    });
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    // Get basic usage stats for the user
    const usageStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT DATE_TRUNC('day', timestamp)) as active_days,
        MAX(timestamp) as last_activity
      FROM "ProvenanceEvent"
        WHERE user_id = ${currentUser.id}
    `);
    
    const meUsageRows = sqlRows(usageStats);
    return c.json({
      user: user ?? null,
      stats: meUsageRows[0] || {
        total_events: 0,
        active_days: 0,
        last_activity: null,
      },
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return c.json({ error: 'Failed to fetch user profile' }, 500);
  }
});

export default router;
export { requireAdmin, requireAuth };
