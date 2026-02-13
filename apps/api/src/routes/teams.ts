import { Hono } from 'hono';
import { and, eq, sql, desc, isNull } from 'drizzle-orm';
import { teams, teamMembers, users, telemetrySpans } from '@stereos/shared/schema';
import { getCurrentUser, getCustomerForUser } from '../lib/middleware.js';
import { sessionOrTokenAuth } from '../lib/api-token.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

const requireAdmin = async (c: any, next: any) => {
  const user = await getCurrentUser(c);
  if (!user || (user as { role?: string }).role !== 'admin') {
    return c.json({ error: 'Forbidden - Admin access required' }, 403);
  }
  c.set('user', user);
  await next();
};

const requireAuth = async (c: any, next: any) => {
  await sessionOrTokenAuth(c, async () => {});
  const user = await getCurrentUser(c);
  if (!user) {
    const apiToken = c.get('apiToken') as { user_id?: string | null } | undefined;
    if (apiToken?.user_id) {
      const db = c.get('db');
      const fallbackUser = await db.query.users.findFirst({
        where: eq(users.id, apiToken.user_id),
        columns: { id: true, role: true, email: true, name: true },
      });
      if (fallbackUser) {
        c.set('user', fallbackUser);
        return next();
      }
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('user', user);
  await next();
};

async function isTeamMember(db: any, teamId: string, userId: string) {
  const row = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)),
    columns: { team_id: true },
  });
  return !!row;
}

router.get('/teams', requireAuth, async (c) => {
  const db = c.get('db');
  const user = c.get('user') as { id: string; role?: string };
  const customer = await getCustomerForUser(c as any, user.id);
  if (!customer) return c.json({ error: 'Customer not found' }, 403);
  const includeArchived = c.req.query('include_archived') === '1';

  if (user.role === 'admin') {
    const rows = await db.select().from(teams).where(eq(teams.customer_id, customer.id));
    const filtered = includeArchived ? rows : rows.filter((team) => team.archived_at == null);
    return c.json({ teams: filtered });
  }

  if (user.role === 'manager') {
    const rows = await db.select({
      id: teams.id,
      name: teams.name,
      profile_pic: teams.profile_pic,
      customer_id: teams.customer_id,
      created_at: teams.created_at,
      updated_at: teams.updated_at,
      archived_at: teams.archived_at,
    })
      .from(teamMembers)
      .leftJoin(teams, eq(teamMembers.team_id, teams.id))
      .where(eq(teamMembers.user_id, user.id));
    const filtered = rows.filter((team) => team.archived_at == null);
    return c.json({
      teams: filtered.map(({ archived_at, ...rest }) => rest),
    });
  }

  return c.json({ error: 'Forbidden' }, 403);
});

router.post('/teams', requireAdmin, async (c) => {
  const db = c.get('db');
  const user = c.get('user') as { id: string };
  const customer = await getCustomerForUser(c as any, user.id);
  if (!customer) return c.json({ error: 'Customer not found' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const profile_pic = body.profile_pic ? String(body.profile_pic).trim() : null;
  const manager_user_id = String(body.manager_user_id || '').trim();
  if (!name || !manager_user_id) return c.json({ error: 'Name and manager_user_id are required' }, 400);

  const manager = await db.query.users.findFirst({
    where: eq(users.id, manager_user_id),
    columns: { id: true, role: true, customer_id: true },
  });
  if (!manager || (manager.role !== 'manager' && manager.role !== 'admin')) {
    return c.json({ error: 'Manager or admin user required' }, 400);
  }
  if (manager.customer_id && manager.customer_id !== customer.id) {
    return c.json({ error: 'Manager must belong to this customer' }, 400);
  }

  const [team] = await db
    .insert(teams)
    .values({ customer_id: customer.id, name, profile_pic })
    .returning();

  await db.insert(teamMembers).values({ team_id: team.id, user_id: manager_user_id });

  return c.json({ team }, 201);
});

router.get('/teams/:teamId', requireAuth, async (c) => {
  const db = c.get('db');
  const user = c.get('user') as { id: string; role?: string };
  const teamId = c.req.param('teamId');

  if (user.role !== 'admin') {
    const member = await isTeamMember(db, teamId, user.id);
    if (!member) return c.json({ error: 'Forbidden' }, 403);
  }

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
  });
  if (!team || team.archived_at) return c.json({ error: 'Team not found' }, 404);
  return c.json({ team });
});

router.patch('/teams/:teamId', requireAdmin, async (c) => {
  const db = c.get('db');
  const teamId = c.req.param('teamId');
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body.name != null) updates.name = String(body.name).trim();
  if (body.profile_pic != null) updates.profile_pic = String(body.profile_pic).trim() || null;

  const [updated] = await db.update(teams).set(updates).where(and(eq(teams.id, teamId), isNull(teams.archived_at))).returning();
  if (!updated) return c.json({ error: 'Team not found' }, 404);
  return c.json({ team: updated });
});

router.delete('/teams/:teamId', requireAdmin, async (c) => {
  const db = c.get('db');
  const user = c.get('user') as { id: string };
  const teamId = c.req.param('teamId');
  const customer = await getCustomerForUser(c as any, user.id);
  if (!customer) return c.json({ error: 'Customer not found' }, 403);

  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  if (!team || team.archived_at) return c.json({ error: 'Team not found' }, 404);
  if (team.customer_id !== customer.id) return c.json({ error: 'Forbidden' }, 403);

  const [archived] = await db
    .update(teams)
    .set({ archived_at: new Date() })
    .where(eq(teams.id, teamId))
    .returning();
  if (!archived) return c.json({ error: 'Team not found' }, 404);
  return c.json({ team: archived });
});

router.patch('/teams/:teamId/unarchive', requireAdmin, async (c) => {
  const db = c.get('db');
  const user = c.get('user') as { id: string };
  const teamId = c.req.param('teamId');
  const customer = await getCustomerForUser(c as any, user.id);
  if (!customer) return c.json({ error: 'Customer not found' }, 403);

  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  if (!team) return c.json({ error: 'Team not found' }, 404);
  if (team.customer_id !== customer.id) return c.json({ error: 'Forbidden' }, 403);

  const [unarchived] = await db
    .update(teams)
    .set({ archived_at: null })
    .where(eq(teams.id, teamId))
    .returning();
  if (!unarchived) return c.json({ error: 'Team not found' }, 404);
  return c.json({ team: unarchived });
});

router.get('/teams/:teamId/profile', requireAuth, async (c) => {
  const db = c.get('db');
  const user = c.get('user') as { id: string; role?: string };
  const teamId = c.req.param('teamId');

  if (user.role !== 'admin') {
    const member = await isTeamMember(db, teamId, user.id);
    if (!member) return c.json({ error: 'Forbidden' }, 403);
  }

  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  if (!team || team.archived_at) return c.json({ error: 'Team not found' }, 404);

  const totalsResult = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_spans,
      COUNT(DISTINCT trace_id)::int AS total_traces,
      COUNT(*) FILTER (WHERE status_code = 'ERROR')::int AS total_errors,
      MIN(start_time) AS first_activity,
      MAX(start_time) AS last_activity
    FROM "TelemetrySpan"
    WHERE team_id = ${teamId}
  `);
  const totalsRow = Array.isArray(totalsResult) ? totalsResult[0] : (totalsResult as { rows?: unknown[] })?.rows?.[0];

  const recentSpans = await db.query.telemetrySpans.findMany({
    where: eq(telemetrySpans.team_id, teamId),
    orderBy: desc(telemetrySpans.start_time),
    limit: 20,
    columns: {
      id: true,
      span_name: true,
      vendor: true,
      start_time: true,
      span_attributes: true,
    },
  });

  const activeMembersResult = await db.execute(sql`
    SELECT COUNT(DISTINCT user_id)::int AS active_members
    FROM "TelemetrySpan"
    WHERE team_id = ${teamId}
      AND user_id IS NOT NULL
      AND start_time >= NOW() - INTERVAL '30 days'
  `);
  const activeRow = Array.isArray(activeMembersResult) ? activeMembersResult[0] : (activeMembersResult as { rows?: unknown[] })?.rows?.[0];

  const topVendorsResult = await db.execute(sql`
    SELECT vendor, COUNT(*)::int AS span_count
    FROM "TelemetrySpan"
    WHERE team_id = ${teamId}
      AND start_time >= NOW() - INTERVAL '30 days'
    GROUP BY vendor
    ORDER BY span_count DESC
    LIMIT 5
  `);
  const topVendorRows = Array.isArray(topVendorsResult)
    ? topVendorsResult
    : (topVendorsResult as { rows?: unknown[] })?.rows ?? [];
  const topVendors = topVendorRows.map((r: any) => ({
    vendor: String(r.vendor),
    span_count: Number(r.span_count ?? 0),
  }));

  const errorRate = Number((totalsRow as Record<string, unknown>)?.total_spans ?? 0) > 0
    ? Number((totalsRow as Record<string, unknown>)?.total_errors ?? 0) / Number((totalsRow as Record<string, unknown>)?.total_spans ?? 1)
    : 0;

  const recentDiffsResult = await db.execute(sql`
    SELECT id, vendor, start_time, span_attributes->>'tool.output.diff' AS diff
    FROM "TelemetrySpan"
    WHERE team_id = ${teamId}
      AND span_attributes->>'tool.output.diff' IS NOT NULL
    ORDER BY start_time DESC
    LIMIT 5
  `);
  const recentDiffRows = Array.isArray(recentDiffsResult)
    ? recentDiffsResult
    : (recentDiffsResult as { rows?: unknown[] })?.rows ?? [];
  const recentDiffs = recentDiffRows.map((r: any) => ({
    id: String(r.id),
    vendor: String(r.vendor),
    start_time: r.start_time as string,
    diff: String(r.diff ?? ''),
  }));

  const tracesPerMemberResult = await db.execute(sql`
    SELECT
      COUNT(DISTINCT trace_id)::float / NULLIF(COUNT(DISTINCT user_id), 0) AS traces_per_member
    FROM "TelemetrySpan"
    WHERE team_id = ${teamId}
      AND user_id IS NOT NULL
      AND start_time >= NOW() - INTERVAL '30 days'
  `);
  const tracesRow = Array.isArray(tracesPerMemberResult) ? tracesPerMemberResult[0] : (tracesPerMemberResult as { rows?: unknown[] })?.rows?.[0];

  return c.json({
    team,
    stats: {
      total_spans: Number((totalsRow as Record<string, unknown>)?.total_spans ?? 0),
      total_traces: Number((totalsRow as Record<string, unknown>)?.total_traces ?? 0),
      total_errors: Number((totalsRow as Record<string, unknown>)?.total_errors ?? 0),
      active_members: Number((activeRow as Record<string, unknown>)?.active_members ?? 0),
      error_rate: errorRate,
      traces_per_member: Number((tracesRow as Record<string, unknown>)?.traces_per_member ?? 0),
      first_activity: (totalsRow as Record<string, unknown>)?.first_activity ?? null,
      last_activity: (totalsRow as Record<string, unknown>)?.last_activity ?? null,
    },
    top_vendors: topVendors,
    recent_diffs: recentDiffs,
    recent_spans: recentSpans.map((s) => ({
      id: s.id,
      intent: s.span_name,
      vendor: s.vendor,
      model: (s.span_attributes as Record<string, string> | null)?.['gen_ai.request.model'] ?? (s.span_attributes as Record<string, string> | null)?.['gen_ai.response.model'] ?? null,
      timestamp: s.start_time,
    })),
  });
});

export default router;
