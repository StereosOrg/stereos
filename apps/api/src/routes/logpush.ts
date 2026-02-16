import { Hono } from 'hono';
import type { Database } from '@stereos/shared/db';
import * as schema from '@stereos/shared/schema';
import { eq } from 'drizzle-orm';
import { parseLogpushNdjson, decryptLogpushPayload } from '../lib/logpush-decrypt.js';
import type { LogpushAiGatewayEntry } from '../lib/logpush-decrypt.js';
import type { AppVariables } from '../types/app.js';

const MAX_EXCERPT_LENGTH = 2000;

function truncate(s: string | undefined | null, max = MAX_EXCERPT_LENGTH): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

const router = new Hono<{ Variables: AppVariables }>();

/**
 * Verify the logpush ingest bearer token.
 * In dev (no secret configured), all requests are allowed.
 */
function verifyIngestAuth(c: any): boolean {
  const secret = process.env.LOGPUSH_INGEST_SECRET ?? (c.env as any)?.LOGPUSH_INGEST_SECRET;
  if (!secret) return true; // Dev mode: no auth required
  const authHeader = c.req.header('Authorization') ?? '';
  return authHeader === `Bearer ${secret}`;
}

// HEAD /v1/logpush/ai-gateway — CF validation probe
router.on('HEAD', '/logpush/ai-gateway', (c) => {
  if (!verifyIngestAuth(c)) return c.text('Unauthorized', 401);
  return c.text('', 200);
});

// OPTIONS /v1/logpush/ai-gateway — CF validation probe
router.on('OPTIONS', '/logpush/ai-gateway', (c) => {
  return c.text('', 200);
});

// POST /v1/logpush/ai-gateway — receive logpush NDJSON
router.post('/logpush/ai-gateway', async (c) => {
  if (!verifyIngestAuth(c)) return c.json({ error: 'Unauthorized' }, 401);

  const rawBody = await c.req.text();
  const privateKey = process.env.LOGPUSH_PRIVATE_KEY ?? (c.env as any)?.LOGPUSH_PRIVATE_KEY;
  const decryptedBody = decryptLogpushPayload(rawBody, privateKey);

  let entries: LogpushAiGatewayEntry[];
  // Support both NDJSON and single JSON object
  try {
    const parsed = JSON.parse(decryptedBody);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    entries = parseLogpushNdjson(decryptedBody);
  }

  if (entries.length === 0) {
    return c.json({ ingested: 0 });
  }

  // Filter to entries that have DLP results
  const dlpEntries = entries.filter(
    (e) => e.DlpResults && Array.isArray(e.DlpResults) && e.DlpResults.length > 0
  );

  if (dlpEntries.length === 0) {
    return c.json({ ingested: 0 });
  }

  // Resolve gateway_id -> customer_id in bulk
  const gatewayIds = [...new Set(dlpEntries.map((e) => e.GatewayId).filter(Boolean))] as string[];
  const dbInstance = c.get('db') as Database;

  const customerMap = new Map<string, string>();
  for (const gid of gatewayIds) {
    const customer = await dbInstance.query.customers.findFirst({
      where: eq(schema.customers.cf_gateway_id, gid),
      columns: { id: true },
    });
    if (customer) customerMap.set(gid, customer.id);
  }

  // Build insert rows
  const rows = dlpEntries
    .filter((e) => e.GatewayId && customerMap.has(e.GatewayId))
    .map((e) => {
      const dlpResults = e.DlpResults ?? [];
      // Determine severity from DLP actions
      const hasBlock = dlpResults.some((d) => d.Action?.toUpperCase() === 'BLOCK');

      return {
        customer_id: customerMap.get(e.GatewayId!)!,
        gateway_id: e.GatewayId!,
        request_id: e.RequestId ?? crypto.randomUUID(),
        timestamp: e.Timestamp ? new Date(e.Timestamp) : new Date(),
        model: e.Model ?? null,
        provider: e.Provider ?? null,
        prompt_excerpt: truncate(e.Prompt),
        response_excerpt: truncate(e.Response),
        topic: e.Topic ?? null,
        summary: e.Summary ?? null,
        dlp_profile_matches: dlpResults.map((d) => ({
          profile_id: d.ProfileId ?? '',
          profile_name: d.ProfileName ?? '',
          matched_entries: d.MatchedEntries ?? [],
        })),
        severity: hasBlock ? ('block' as const) : ('flag' as const),
        raw_payload: e as Record<string, unknown>,
      };
    });

  if (rows.length === 0) {
    return c.json({ ingested: 0 });
  }

  try {
    await dbInstance.insert(schema.dlpEvents).values(rows);
  } catch (err) {
    console.error('[Logpush] Failed to insert DLP events:', err);
    return c.json({ error: 'Failed to ingest events' }, 500);
  }

  return c.json({ ingested: rows.length });
});

export default router;
