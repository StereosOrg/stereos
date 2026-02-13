import { Hono } from 'hono';
import { users, usageEvents, customers, telemetrySpans, teamMembers, teams } from '@stereos/shared/schema';
import { eq, desc, sql, and, isNull } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getCurrentUser, getCustomerForUser } from '../lib/middleware.js';
import { sendEmailViaResendFetch } from '../lib/resend-fetch.js';
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
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
        image: users.image,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
    const memberships = await db.select({
      user_id: teamMembers.user_id,
      team_id: teamMembers.team_id,
      team_name: teams.name,
      archived_at: teams.archived_at,
    })
      .from(teamMembers)
      .leftJoin(teams, eq(teamMembers.team_id, teams.id));
    const teamByUser = new Map<string, { team_id: string; team_name: string | null }>();
    for (const m of memberships) {
      if (m.archived_at != null) continue;
      if (!teamByUser.has(m.user_id)) {
        teamByUser.set(m.user_id, { team_id: m.team_id, team_name: m.team_name });
      }
    }

    const usersWithTeams = allUsers.map((u) => ({
      ...u,
      team_id: teamByUser.get(u.id)?.team_id ?? null,
      team_name: teamByUser.get(u.id)?.team_name ?? null,
    }));

    return c.json({ users: usersWithTeams });
  } catch (error) {
    console.error('Error fetching users:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

// GET /v1/users/:userId/profile - Get detailed user profile (admin or self)
router.get('/users/:userId/profile', requireAuth, async (c) => {
  const userId = c.req.param('userId');
  const db = c.get('db');
  const currentUser = c.get('user') as { id: string; role?: string } | undefined;
  if (!currentUser) return c.json({ error: 'Unauthorized' }, 401);
  if (currentUser.role !== 'admin' && currentUser.id !== userId) {
    return c.json({ error: 'Forbidden - Admin access required' }, 403);
  }

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
        customer: true,
      },
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const workspaceCustomer = user.customer ?? (await getCustomerForUser(c as unknown as import('../types/context.js').HonoContext, userId));
    const customerId = workspaceCustomer?.id ?? '';
    
    // Get usage statistics from spans
    const usageStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT DATE_TRUNC('day', start_time)) as active_days,
        MIN(start_time) as first_activity,
        MAX(start_time) as last_activity
      FROM "TelemetrySpan"
      WHERE user_id = ${userId}
    `);
    
    // Get recent spans (last 50) for this user
    const recentSpans = await db.query.telemetrySpans.findMany({
      where: eq(telemetrySpans.user_id, userId),
      orderBy: desc(telemetrySpans.start_time),
      limit: 50,
      columns: {
        id: true,
        span_name: true,
        vendor: true,
        start_time: true,
        span_attributes: true,
        status_code: true,
      },
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
    
    const usageRows = sqlRows(usageStats);
    const monthlyRows = sqlRows(monthlyStats);

    // Favorite tool: derive from most-used vendor in recent spans
    let favoriteTool: string | null = null;
    if (recentSpans.length > 0) {
      const vendorCounts = new Map<string, number>();
      for (const s of recentSpans) {
        vendorCounts.set(s.vendor, (vendorCounts.get(s.vendor) ?? 0) + 1);
      }
      const sorted = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1]);
      favoriteTool = sorted[0]?.[0] ?? null;
    }

    const stats = usageRows[0] as Record<string, unknown> | undefined;
    const recentEvents = recentSpans.map((s) => ({
      id: s.id,
      actor_id: s.vendor,
      tool: s.vendor,
      intent: s.span_name,
      model: (s.span_attributes as Record<string, string> | null)?.['gen_ai.request.model'] ?? (s.span_attributes as Record<string, string> | null)?.['gen_ai.response.model'] ?? null,
      timestamp: s.start_time,
      files_written: null as string[] | null,
      artifacts: [] as Array<{ repo: string; branch: string | null; commit: string | null }>,
      outcomes: [] as Array<{ status: string; linked_commit: string | null }>,
    }));

    const recentDiffsResult = await db.execute(sql`
      SELECT
        id,
        vendor,
        start_time,
        span_attributes->>'tool.output.diff' as diff
      FROM "TelemetrySpan"
      WHERE user_id = ${userId}
        AND span_attributes->>'tool.output.diff' IS NOT NULL
      ORDER BY start_time DESC
      LIMIT 10
    `);
    const recentDiffs = sqlRows(recentDiffsResult).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        vendor: String(row.vendor),
        start_time: row.start_time as string,
        diff: String(row.diff ?? ''),
      };
    });

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
        files: [],
        diffs: recentDiffs,
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
  
  if (!role || !['admin', 'manager', 'user'].includes(role)) {
    return c.json({ error: 'Invalid role. Must be "admin", "manager" or "user"' }, 400);
  }
  
  try {
    // Prevent admin from changing their role if they're the only admin
    const currentUser = c.get('user')!;
    if (currentUser.id === userId && role !== 'admin') {
      const adminCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM "User" WHERE role = 'admin'
      `);
      const adminRows = sqlRows(adminCount);
      const count = (adminRows[0] as { count?: string | number } | undefined)?.count;
      if (parseInt(String(count ?? 0)) <= 1) {
        return c.json({ error: 'Cannot demote the only admin' }, 400);
      }
    }
    
    // Enforce: each team must have at least one manager
    const currentRole = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { role: true },
    });
    if (currentRole?.role === 'manager' && role !== 'manager') {
      const teamIds = await db.select({ team_id: teamMembers.team_id }).from(teamMembers).where(eq(teamMembers.user_id, userId));
      for (const t of teamIds) {
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int AS manager_count
          FROM "TeamMember" tm
          JOIN "User" u ON u.id = tm.user_id
          WHERE tm.team_id = ${t.team_id} AND u.role IN ('manager','admin') AND u.id <> ${userId}
        `);
        const row = Array.isArray(countResult) ? countResult[0] : (countResult as { rows?: unknown[] })?.rows?.[0];
        const count = Number((row as Record<string, unknown>)?.manager_count ?? 0);
        if (count === 0) {
          return c.json({ error: 'Each team must have at least one manager' }, 400);
        }
      }
    }

    await db.update(users).set({ role }).where(eq(users.id, userId));

    // Notify user
    const updatedUser = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { email: true } });
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    if (apiKey && updatedUser?.email) {
      await sendEmailViaResendFetch({
        apiKey,
        from,
        to: updatedUser.email,
        subject: 'Your role was updated',
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;"><p>Your role has been updated to <strong>${role}</strong>.</p></body></html>`,
      });
    }

    return c.json({ success: true, message: `User role updated to ${role}` });
  } catch (error) {
    console.error('Error updating user role:', error);
    return c.json({ error: 'Failed to update user role' }, 500);
  }
});

// PATCH /v1/users/:userId/team - Assign user to a team (admin only)
router.patch('/users/:userId/team', requireAdmin, async (c) => {
  const userId = c.req.param('userId');
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const teamId = body.team_id ? String(body.team_id) : null;

  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, role: true, email: true } });
  if (!user) return c.json({ error: 'User not found' }, 404);

  const existingTeams = await db.select({ team_id: teamMembers.team_id }).from(teamMembers).where(eq(teamMembers.user_id, userId));

  // If removing from teams, ensure at least one manager remains
  if (user.role === 'manager') {
    for (const t of existingTeams) {
      if (teamId && t.team_id === teamId) continue;
      const countResult = await db.execute(sql`
        SELECT COUNT(*)::int AS manager_count
        FROM "TeamMember" tm
        JOIN "User" u ON u.id = tm.user_id
        WHERE tm.team_id = ${t.team_id} AND u.role IN ('manager','admin') AND u.id <> ${userId}
      `);
      const row = Array.isArray(countResult) ? countResult[0] : (countResult as { rows?: unknown[] })?.rows?.[0];
      const count = Number((row as Record<string, unknown>)?.manager_count ?? 0);
      if (count === 0) {
        return c.json({ error: 'Each team must have at least one manager' }, 400);
      }
    }
  }

  await db.delete(teamMembers).where(eq(teamMembers.user_id, userId));

  if (teamId) {
    const team = await db.query.teams.findFirst({
      where: and(eq(teams.id, teamId), isNull(teams.archived_at)),
      columns: { id: true, name: true },
    });
    if (!team) return c.json({ error: 'Team not found' }, 404);

    if (user.role !== 'manager' && user.role !== 'admin') {
      const countResult = await db.execute(sql`
        SELECT COUNT(*)::int AS manager_count
        FROM "TeamMember" tm
        JOIN "User" u ON u.id = tm.user_id
        WHERE tm.team_id = ${teamId} AND u.role IN ('manager','admin')
      `);
      const row = Array.isArray(countResult) ? countResult[0] : (countResult as { rows?: unknown[] })?.rows?.[0];
      const count = Number((row as Record<string, unknown>)?.manager_count ?? 0);
      if (count === 0) {
        return c.json({ error: 'Team must have at least one manager' }, 400);
      }
    }

    await db.insert(teamMembers).values({ team_id: teamId, user_id: userId });

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    if (apiKey && user.email) {
      await sendEmailViaResendFetch({
        apiKey,
        from,
        to: user.email,
        subject: 'You were assigned to a team',
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;"><p>You were assigned to team <strong>${team.name}</strong>.</p></body></html>`,
      });
    }
  }

  return c.json({ success: true });
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
        customer: true,
      },
    });
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    // Get basic usage stats from spans
    const usageStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT DATE_TRUNC('day', start_time)) as active_days,
        MAX(start_time) as last_activity
      FROM "TelemetrySpan"
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
