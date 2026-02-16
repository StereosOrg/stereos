/**
 * Partners & Referrals API.
 * Internal: CRUD partners (IP whitelist + secret header). Public: validate referral code.
 */

import { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { partners, referrals, partnerTierConfig } from '@stereos/shared/schema';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

const PRIVATE_IP_RANGES = [/^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^::1$/, /^localhost$/];

/** Require both a trusted IP and a matching INTERNAL_API_KEY header. */
async function requireInternal(c: any, next: () => Promise<void>) {
  const internalKey = (c.env?.INTERNAL_API_KEY ?? process.env.INTERNAL_API_KEY) as string | undefined;
  if (!internalKey) {
    return c.json({ error: 'INTERNAL_API_KEY not configured' }, 500);
  }

  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? c.req.header('x-real-ip')
    ?? c.req.raw?.socket?.remoteAddress
    ?? '';
  const trusted = PRIVATE_IP_RANGES.some((re) => re.test(clientIp));
  if (!trusted) {
    return c.json({ error: 'Forbidden - untrusted IP' }, 403);
  }

  const provided = c.req.header('x-internal-key');
  if (provided !== internalKey) {
    return c.json({ error: 'Forbidden - invalid internal key' }, 403);
  }

  await next();
}

/** GET /v1/partners/validate-code?code=ACME - Public: validate referral code (no auth) */
router.get('/partners/validate-code', async (c) => {
  const code = c.req.query('code')?.trim().toUpperCase();
  if (!code) {
    return c.json({ valid: false, error: 'Missing code' }, 400);
  }
  const db = c.get('db');
  const partner = await db.query.partners.findFirst({
    where: eq(partners.partner_code, code),
    columns: { id: true, name: true, partner_code: true },
  });
  if (!partner) {
    return c.json({ valid: false });
  }
  return c.json({ valid: true, partner_name: partner.name, partner_code: partner.partner_code });
});

/** GET /v1/partners - Internal:list partners */
router.get('/partners', requireInternal, async (c) => {
  const db = c.get('db');
  const rows = await db
    .select({
      id: partners.id,
      name: partners.name,
      email: partners.email,
      partner_code: partners.partner_code,
      tier: partners.tier,
      created_at: partners.created_at,
      updated_at: partners.updated_at,
    })
    .from(partners)
    .orderBy(desc(partners.created_at));
  return c.json({ partners: rows });
});

/** GET /v1/partners/:id - Internal:get partner with referral stats */
router.get('/partners/:id', requireInternal, async (c) => {
  const id = c.req.param('id');
  const db = c.get('db');
  const partner = await db.query.partners.findFirst({
    where: eq(partners.id, id),
    columns: { id: true, name: true, email: true, partner_code: true, tier: true, created_at: true, updated_at: true },
  });
  if (!partner) {
    return c.json({ error: 'Partner not found' }, 404);
  }
  const refs = await db
    .select({
      id: referrals.id,
      customer_id: referrals.customer_id,
      referred_at: referrals.referred_at,
      status: referrals.status,
      converted_at: referrals.converted_at,
    })
    .from(referrals)
    .where(eq(referrals.partner_id, id))
    .orderBy(desc(referrals.referred_at));
  const convertedCount = refs.filter((r) => r.status === 'converted').length;
  return c.json({
    ...partner,
    referrals: refs,
    converted_count: convertedCount,
  });
});

/** POST /v1/partners - Internal:create partner */
router.post('/partners', requireInternal, async (c) => {
  const body = await c.req.json();
  const name = body.name?.trim();
  const email = body.email?.trim();
  const partnerCode = (body.partner_code ?? body.partnerCode ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!name || !email || !partnerCode) {
    return c.json({ error: 'name, email, and partner_code are required' }, 400);
  }
  const db = c.get('db');
  const existing = await db.query.partners.findFirst({
    where: eq(partners.partner_code, partnerCode),
    columns: { id: true },
  });
  if (existing) {
    return c.json({ error: 'Partner code already exists' }, 409);
  }
  const [partner] = await db
    .insert(partners)
    .values({ name, email, partner_code: partnerCode })
    .returning();
  return c.json(partner, 201);
});

/** PATCH /v1/partners/:id - Internal:update partner */
router.patch('/partners/:id', requireInternal, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.email !== undefined) updates.email = String(body.email).trim();
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }
  const db = c.get('db');
  const [updated] = await db.update(partners).set(updates).where(eq(partners.id, id)).returning();
  if (!updated) {
    return c.json({ error: 'Partner not found' }, 404);
  }
  return c.json(updated);
});

/** DELETE /v1/partners/:id - Internal:delete partner */
router.delete('/partners/:id', requireInternal, async (c) => {
  const id = c.req.param('id');
  const db = c.get('db');
  const [deleted] = await db.delete(partners).where(eq(partners.id, id)).returning({ id: partners.id });
  if (!deleted) {
    return c.json({ error: 'Partner not found' }, 404);
  }
  return c.json({ deleted: true }, 200);
});

/** GET /v1/partners/tiers - Internal:list tier config */
router.get('/partners/tiers', requireInternal, async (c) => {
  const db = c.get('db');
  const rows = await db
    .select()
    .from(partnerTierConfig)
    .orderBy(sql`CASE ${partnerTierConfig.tier} WHEN 'bronze' THEN 1 WHEN 'silver' THEN 2 WHEN 'gold' THEN 3 END`);
  return c.json({ tiers: rows });
});

export default router;
