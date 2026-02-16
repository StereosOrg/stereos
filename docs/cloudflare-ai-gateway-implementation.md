# Cloudflare AI Gateway — Multi-Tenant Implementation Plan

## Objective

Replace OpenRouter as the AI provider backend with Cloudflare AI Gateway. One gateway per customer, provisioned at account creation. Per-user/per-team virtual keys with self-managed spend enforcement and zero data retention.

---

## 1. What We Keep (No Changes)

- **BetterAuth** — sessions, magic links, bearer plugin (`lib/auth.ts`)
- **`sessionOrTokenAuth` + `requireAdminOrManager` middleware** — RBAC for key routes
- **`users` / `teams` / `teamMembers` tables** — tenant model unchanged
- **`usageEvents` table** — usage recording for Stripe metered billing
- **Stripe integration** (`lib/stripe.ts`) — metered billing, checkout, webhooks
- **`apiTokens` table** — platform API tokens (telemetry ingest) remain separate from AI keys
- **Telemetry pipeline** — `telemetrySpans`, `telemetryMetrics`, `toolProfiles` tables, all dashboard/LLM stats queries in `routes/telemetry.ts`. The proxy emits OTel spans with the same `gen_ai.*` attributes that OpenRouter Broadcast used, so the entire UI stays intact.
- **Telemetry UI** — dashboard, tool profiles, LLM stats, span drilldowns, latency percentiles, daily/hourly charts — all unchanged. Data source switches from OpenRouter Broadcast to proxy-emitted spans, but the schema and queries are identical.

---

## 2. Schema Changes

### 2.1 Add `cf_gateway_id` to `customers`

Same pattern as `customer_stripe_id`. Provisioned once at account creation.

```typescript
// In customers table definition — add column:
cf_gateway_id: text('cf_gateway_id').unique(),
```

Migration:

```sql
ALTER TABLE "Customer" ADD COLUMN "cf_gateway_id" text UNIQUE;
```

### 2.2 New Table: `AiGatewayKey`

Replaces `OpenRouterKey`. Same tenant scoping (customer_id, user_id, team_id) but spend tracking moves to our side.

```typescript
export const aiGatewayKeyBudgetResetEnum = pgEnum('ai_gateway_key_budget_reset', ['daily', 'weekly', 'monthly']);

export const aiGatewayKeys = pgTable('AiGatewayKey', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  user_id: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  team_id: text('team_id').references(() => teams.id, { onDelete: 'set null' }),

  // Virtual key — opaque token issued by our system, hashed for storage
  key_hash: text('key_hash').notNull().unique(),

  name: text('name').notNull(),

  // Spend management (enforced by our proxy)
  budget_usd: decimal('budget_usd', { precision: 10, scale: 4 }),
  budget_reset: aiGatewayKeyBudgetResetEnum('budget_reset'),
  spend_usd: decimal('spend_usd', { precision: 10, scale: 4 }).default('0').notNull(),
  spend_reset_at: timestamp('spend_reset_at', { withTimezone: true }),

  // Model restrictions (enforced by proxy before forwarding)
  // null = all models allowed. Array of CF model IDs from /ai/models/search.
  allowed_models: jsonb('allowed_models').$type<string[]>(),

  disabled: boolean('disabled').default(false).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  created_by_user_id: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({
  customerIdx: index('AiGatewayKey_customer_id_idx').on(t.customer_id),
  userIdx: index('AiGatewayKey_user_id_idx').on(t.user_id),
  teamIdx: index('AiGatewayKey_team_id_idx').on(t.team_id),
}));
```

**No `gateway_id` on the key** — the proxy resolves it via `key → customer → cf_gateway_id`.

### 2.3 Relations

```typescript
export const aiGatewayKeysRelations = relations(aiGatewayKeys, ({ one }) => ({
  customer: one(customers, { fields: [aiGatewayKeys.customer_id], references: [customers.id] }),
  user: one(users, { fields: [aiGatewayKeys.user_id], references: [users.id] }),
  team: one(teams, { fields: [aiGatewayKeys.team_id], references: [teams.id] }),
}));

// Add to customersRelations:
//   aiGatewayKeys: many(aiGatewayKeys),
```

---

## 3. Gateway Provisioning (At Customer Creation)

### 3.1 New Library: `lib/cloudflare-ai.ts`

```typescript
const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export type CfGatewayCreateParams = {
  id: string;
  collect_logs?: boolean;
  rate_limiting_limit?: number;
  rate_limiting_interval?: number;
  cache_ttl?: number;
};

export type CfGatewayResponse = {
  id: string;
  collect_logs: boolean;
  rate_limiting_limit: number;
  rate_limiting_interval: number;
  created_at: string;
};

export async function createCfGateway(
  accountId: string,
  apiToken: string,
  params: CfGatewayCreateParams
): Promise<CfGatewayResponse> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/ai-gateway/gateways`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        ...params,
        collect_logs: false,        // ZDR always on
        rate_limiting_limit: 0,     // we handle limits
        rate_limiting_interval: 0,
        cache_ttl: 0,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF AI Gateway create failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { result: CfGatewayResponse };
  return json.result;
}

export async function deleteCfGateway(
  accountId: string,
  apiToken: string,
  gatewayId: string
): Promise<void> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/ai-gateway/gateways/${gatewayId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiToken}` },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF AI Gateway delete failed: ${res.status} ${text}`);
  }
}
```

### 3.2 Hook Into Customer Registration

In `routes/auth.ts`, `POST /v1/customers/register` — provision the CF gateway alongside the Stripe customer:

```typescript
// After createStripeCustomer, before db.insert(customers):
const cfAccountId = c.env.CF_ACCOUNT_ID;
const cfApiToken = c.env.CF_AI_GATEWAY_API_TOKEN;
let cfGatewayId: string | null = null;

if (cfAccountId && cfApiToken) {
  const gatewaySlug = `stereos-${customerId}`;  // deterministic, unique per customer
  const gw = await createCfGateway(cfAccountId, cfApiToken, { id: gatewaySlug });
  cfGatewayId = gw.id;
}

// Then in the insert:
await db.insert(customers).values({
  user_id,
  customer_id: customerId,
  customer_stripe_id: stripeCustomerId,
  cf_gateway_id: cfGatewayId,
  billing_status: 'trial',
});
```

Gateway deletion only happens on full account teardown (admin job, not a tenant-facing route).

---

## 4. Proxy Layer: Spend Enforcement, Telemetry + Request Forwarding

The proxy sits in the existing Hono worker and does three things: budget/model enforcement, request forwarding, and telemetry recording. The proxy replaces both OpenRouter (as the AI provider) and OpenRouter Broadcast (as the OTel trace source).

### 4.1 New Route: `routes/ai-proxy.ts`

```
Request flow:
1. Tenant sends: POST /v1/ai/chat/completions with Authorization: Bearer <virtual_key>
2. Proxy looks up aiGatewayKey by key_hash, joins to customer for cf_gateway_id
3. Model allow-list check: if allowed_models set and model not in list → 403
4. Budget check: if spend_usd >= budget_usd → 429 "Budget exceeded"
5. Forward to: https://gateway.ai.cloudflare.com/v1/{cf_account_id}/{cf_gateway_id}/{provider}/chat/completions
6. Return response to tenant
7. Parse token usage from response body (usage.prompt_tokens, usage.completion_tokens)
8. Post-response (non-blocking):
   a. Atomic increment spend_usd on key
   b. Insert usageEvent for Stripe metered billing
   c. Emit OTel span to telemetry pipeline (feeds existing dashboard UI)
```

### 4.2 Budget Check (Pre-Request)

```typescript
async function checkBudget(
  db: Database,
  key: { budget_usd: string | null; spend_usd: string; budget_reset: string | null; spend_reset_at: Date | null; disabled: boolean }
): Promise<{ allowed: boolean; remaining_usd?: number }> {
  if (key.disabled) return { allowed: false };
  if (!key.budget_usd) return { allowed: true }; // no budget = unlimited

  // Reset spend if period elapsed
  if (key.budget_reset && key.spend_reset_at && new Date() > key.spend_reset_at) {
    // Reset inline or via scheduled job
    return { allowed: true, remaining_usd: parseFloat(key.budget_usd) };
  }

  const budget = parseFloat(key.budget_usd);
  const spend = parseFloat(key.spend_usd);
  if (spend >= budget) return { allowed: false, remaining_usd: 0 };
  return { allowed: true, remaining_usd: budget - spend };
}
```

### 4.3 Spend Recording (Post-Request)

```typescript
import { sql } from 'drizzle-orm';

async function recordSpend(
  db: Database,
  keyId: string,
  customerId: string,
  costUsd: number,
  tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  stripeApiKey?: string
): Promise<void> {
  // Atomic increment
  await db
    .update(aiGatewayKeys)
    .set({ spend_usd: sql`${aiGatewayKeys.spend_usd}::numeric + ${costUsd}` })
    .where(eq(aiGatewayKeys.id, keyId));

  // Usage event for Stripe
  const idempotencyKey = `${customerId}-ai_req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  await db.insert(usageEvents).values({
    customer_id: customerId,
    event_type: 'ai_request',
    idempotency_key: idempotencyKey,
    quantity: tokenUsage.total_tokens,
    unit_price: '0',
    total_price: costUsd.toFixed(4),
    metadata: { ...tokenUsage, key_id: keyId },
  });

  // Report to Stripe meter (new meter: ai_tokens or ai_requests)
  // await createStripeMeterEvent('ai_tokens', stripeCustomerId, tokenUsage.total_tokens, ...);
}
```

### 4.4 Telemetry: Proxy Emits OTel Spans (Replaces OpenRouter Broadcast)

The CF AI Gateway `otel` exporter is dashboard-only config — not settable via the API at gateway creation. Instead, the **proxy itself emits OTel spans** after each request. Since the proxy and `/v1/traces` live in the same Hono app, the proxy calls the telemetry ingestion logic directly (no HTTP round-trip to itself).

This replaces OpenRouter Broadcast as the trace source. The existing telemetry pipeline, dashboard, tool profiles, and LLM stats UI all keep working because the spans use the same `gen_ai.*` semantic conventions.

**Span attributes the proxy must set** (to match what the telemetry pipeline expects):

```typescript
// After receiving CF AI Gateway response:
const spanAttributes = {
  // User/team attribution (required — telemetry.ts resolves customer from user.id)
  'user.id': userId,
  'team.id': teamId,

  // Model info (used by LLM stats queries, dashboard recent spans)
  'gen_ai.request.model': requestBody.model,
  'gen_ai.response.model': responseBody.model,

  // Token usage (used by LLM stats: model usage, daily usage, hourly tokens)
  'gen_ai.usage.input_tokens': String(responseBody.usage?.prompt_tokens ?? 0),
  'gen_ai.usage.output_tokens': String(responseBody.usage?.completion_tokens ?? 0),

  // Provider (used by vendor canonicalization → tool profiles)
  'llm.provider': provider, // e.g. 'openai', 'anthropic'
};
```

**What this preserves in the existing UI:**

| Telemetry Feature | Data Source | Status |
|---|---|---|
| Dashboard: total spans, traces, active sources | `telemetrySpans` table | Works — proxy inserts spans |
| Dashboard: recent spans with model name | `span_attributes->>'gen_ai.request.model'` | Works — proxy sets attribute |
| Dashboard: most active user | `user_id` on span | Works — proxy sets from key lookup |
| Tool profiles: vendor aggregation | `canonicalizeVendor()` on resource attributes | Works — proxy sets `llm.provider` |
| Tool profiles: span/trace/error counts | `toolProfiles` upsert in ingestion | Works — same ingestion path |
| LLM stats: model usage breakdown | `gen_ai.request.model` + token attributes | Works — proxy sets attributes |
| LLM stats: daily/hourly charts | Time-bucketed queries on `telemetrySpans` | Works — proxy sets `start_time`/`end_time` |
| LLM stats: latency percentiles | `duration_ms` on spans | Works — proxy measures request duration |
| Span drilldown | Full span with attributes | Works — proxy writes complete span |

**Implementation: call ingestion directly, not via HTTP.**

The proxy constructs the OTel `resourceSpans` payload and calls the same ingestion logic that `POST /v1/traces` uses. Extract the ingestion logic from `telemetry.ts` into a shared function (e.g., `lib/telemetry-ingest.ts`) that both the `/v1/traces` route and the proxy can call:

```typescript
// In ai-proxy.ts, after forwarding and getting response:
await ingestOtelSpans(db, {
  resourceSpans: [{
    resource: {
      attributes: toOtelAttributes({
        'service.name': 'cloudflare-ai-gateway',
        'llm.provider': provider,
        'user.id': userId,
        'team.id': teamId,
      }),
    },
    scopeSpans: [{
      spans: [{
        traceId: crypto.randomUUID().replace(/-/g, ''),
        spanId: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
        name: `chat ${requestBody.model}`,
        kind: 3, // CLIENT
        startTimeUnixNano: String(startTime * 1_000_000),
        endTimeUnixNano: String(endTime * 1_000_000),
        status: { code: responseOk ? 1 : 2 },
        attributes: toOtelAttributes(spanAttributes),
      }],
    }],
  }],
}, stripeApiKey);
```

### 4.5 Spend Reset (Scheduled)

For keys with `budget_reset` (daily/weekly/monthly), run a scheduled job or check inline:

```typescript
// Option A: Cloudflare Cron Trigger (recommended)
// In wrangler.toml: [triggers] crons = ["0 0 * * *"]
// Resets spend_usd to 0 and advances spend_reset_at for all keys whose period elapsed.

// Option B: Inline check on each request (simpler, shown in checkBudget above)
```

---

## 5. Key Management Routes

Refactor `routes/openrouter.ts` → `routes/ai-keys.ts`. The route structure and RBAC stay the same — only the backend calls change.

### Create Key (User)

```
POST /v1/ai/keys/user
Body: { name, customer_id, user_id?, budget_usd?, budget_reset?, allowed_models? }

1. requireAdminOrManager (same middleware)
2. Generate virtual key (crypto.randomUUID or similar opaque token)
3. Hash it for storage (SHA-256)
4. Insert into aiGatewayKeys (no CF API call — gateway already exists on customer)
5. Track via trackManagedKeysUsage (Stripe meter)
6. Return { id, name, key: <raw key shown once>, budget_usd, budget_reset, allowed_models }
```

### Create Key (Team)

```
POST /v1/ai/keys/team/:teamId
Body: { name, budget_usd?, budget_reset?, allowed_models? }
Same as user key but sets team_id, requires team membership check (existing logic)
```

### Update Key

```
PATCH /v1/ai/keys/:hash
Body: { name?, budget_usd?, budget_reset?, allowed_models?, disabled? }
1. Auth + ownership check
2. Update aiGatewayKeys row
3. Return updated key
```

### Delete Key

```
DELETE /v1/ai/keys/:hash
1. Auth + ownership check (same as current)
2. Delete from aiGatewayKeys table
3. No CF API call needed (gateway stays, only the virtual key is revoked)
```

### List / Get Key Details

```
GET /v1/ai/keys/customer          — all keys for customer (admin/manager)
GET /v1/ai/keys/user/:userId      — user keys + team keys
GET /v1/ai/keys/:hash/details     — spend, budget, usage from our DB (no upstream API call)
```

**Key simplification:** Since spend data lives in our DB, we no longer need `enrichKeysWithUsage` calls to an external API. Key details are a single DB query.

---

## 6. Model Restrictions + ZDR (On the Key, No Separate Guardrails)

Budget, model restrictions, and ZDR all live directly on the key. No separate guardrail objects, no assignment flow.

| Concern | Where It Lives |
|---|---|
| Zero data retention | Always on — `collect_logs: false` at gateway creation. Not configurable per-key. |
| Allowed models | `allowed_models` jsonb on `aiGatewayKeys`. Proxy checks before forwarding. `null` = all models. |
| Spend limit | `budget_usd` + `budget_reset` on `aiGatewayKeys`. Proxy checks before forwarding. |

### Model List for Frontend Dropdown

Fetch available models from Cloudflare's API:

```
GET https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/models/search
Authorization: Bearer <CF_AI_GATEWAY_API_TOKEN>
```

Backend proxies this for the frontend (avoids exposing CF token):

```
GET /v1/ai/models
→ Returns list of { id, name, description, task } from CF
→ Frontend uses this to populate the allowed_models multi-select on key create/edit
```

### Proxy Enforcement

```typescript
// In ai-proxy.ts, after budget check:
if (key.allowed_models && key.allowed_models.length > 0) {
  const requestedModel = body.model; // from the AI request body
  if (!key.allowed_models.includes(requestedModel)) {
    return c.json({ error: `Model "${requestedModel}" not allowed for this key` }, 403);
  }
}
```

---

## 7. Environment Variables

Add to `worker.ts` `Env` type and wrangler.toml:

```
CF_ACCOUNT_ID=<cloudflare account ID>
CF_AI_GATEWAY_API_TOKEN=<cloudflare API token with AI Gateway permissions>
```

These replace `OPENROUTER_MANAGEMENT_KEY` after migration.

---

## 8. Stripe Billing Impact

Minimal changes to existing billing:

- **`managed_keys` meter** — still fires on key creation, just from `aiGatewayKeys` instead of `openrouterKeys`
- **New meter (optional):** `ai_tokens` or `ai_requests` — track proxy usage. Create in Stripe Dashboard + add price ID env var
- **`usageEvents` table** — new `event_type: 'ai_request'` rows alongside existing `telemetry_event` and `managed_key`

---

## 9. Frontend Changes

### Delete `Guardrails.tsx`

No separate guardrails page. Budget and model restrictions are set per-key in the create/edit flow. Remove the `/guardrails` route from the router.

### `KeyManagement.tsx` — Rework

- **Endpoints**: `/v1/keys/customer` → `/v1/ai/keys/customer`, `/v1/keys/user` → `/v1/ai/keys/user`, `/v1/keys/team/:id` → `/v1/ai/keys/team/:id`
- **`KeyItem` interface**: `openrouter_key_hash` → `key_hash`, drop `limit`/`limit_remaining`/`usage_daily`/`usage_monthly` (OpenRouter enrichment), add `budget_usd`, `spend_usd`, `allowed_models`
- **Key table columns**: "Usage" column shows `spend_usd` from DB (no enrichment call). "Status" uses `disabled` from DB.
- **Create key modals**: Add budget fields (`budget_usd`, `budget_reset`) and an `allowed_models` multi-select dropdown. Dropdown fetches from `GET /v1/ai/models` (CF model list). Reuse the existing `SearchableMultiSelect` component from `Guardrails.tsx` before deleting that page.
- **Delete key**: `/v1/keys/${hash}` → `/v1/ai/keys/${hash}`
- **Link to detail**: `/keys/${k.openrouter_key_hash}` → `/keys/${k.key_hash}`
- **Remove**: Link to `/guardrails` in the description text

### `KeyDetail.tsx` — Rework

- **Endpoint**: `/v1/keys/${hash}/details` → `/v1/ai/keys/${hash}/details`
- **`KeyDetailData` interface**: Entirely reshaped. Drop OpenRouter fields (`usage`, `usage_daily`, `usage_weekly`, `usage_monthly`, `limit`, `limit_remaining`, `label`, `expires_at`). Replace with DB fields: `budget_usd`, `spend_usd`, `budget_reset`, `spend_reset_at`, `allowed_models`, `disabled`.
- **Stat cards**: "Total usage" → `spend_usd`. "Limit remaining" → `budget_usd - spend_usd` (or "Unlimited" if no budget). Drop daily/weekly/monthly breakdown (or compute from `usageEvents` if needed later).
- **Detail rows**: "Limit" → "Budget". "Limit reset" → "Budget reset". Add "Allowed models" row showing model list or "All models".
- **Add**: Edit button that opens a modal to update budget, allowed_models, disabled state via `PATCH /v1/ai/keys/:hash`

---

## 10. Implementation Order

No existing customers — clean build with no migration needed. Delete OpenRouter code, build CF AI Gateway code, deploy.

### Step 1: Schema
- Drizzle migration: add `cf_gateway_id` to `customers`, create `AiGatewayKey` table (with `allowed_models` jsonb), drop `OpenRouterKey` table and `openrouter_key_limit_reset` enum

### Step 2: Backend
- Delete `lib/openrouter.ts` and `routes/openrouter.ts`
- Implement `lib/cloudflare-ai.ts` (gateway create + model list)
- Extract telemetry ingestion logic from `routes/telemetry.ts` into `lib/telemetry-ingest.ts` (shared function callable by both `/v1/traces` route and the proxy)
- Implement `routes/ai-keys.ts` (key CRUD + PATCH for edit + `GET /v1/ai/models` for CF model list, reuses existing RBAC middleware)
- Implement `routes/ai-proxy.ts` (spend enforcement, model allow-list enforcement, request forwarding, OTel span emission via `lib/telemetry-ingest.ts`)
- Update `worker.ts` and `index.ts`: replace `openrouterRouter` with `aiKeysRouter` + `aiProxyRouter`
- Add CF gateway provisioning to `POST /v1/customers/register`
- Rename `openRouterBroadcastAuth` middleware in `telemetry.ts` to something generic (the `/v1/traces` endpoint still works for external OTel sources if needed)

### Step 3: Frontend
- Delete `Guardrails.tsx` and remove `/guardrails` route
- Salvage `SearchableMultiSelect` component from `Guardrails.tsx` into a shared component
- Update `KeyManagement.tsx`: new endpoints, new data shape, add budget + allowed_models fields to create modals
- Update `KeyDetail.tsx`: new data shape from DB, add edit capability via PATCH

### Step 4: Deploy
- Set `CF_ACCOUNT_ID` + `CF_AI_GATEWAY_API_TOKEN` env vars
- Remove `OPENROUTER_MANAGEMENT_KEY` and `OPENROUTER_BROADCAST_SECRET` env vars
- Deploy

---

## 11. Auth Flow (Unchanged)

No changes to BetterAuth config or the `accounts` / `sessions` / `verifications` tables.

- **Dashboard users:** BetterAuth session → `sessionOrTokenAuth` → key management routes
- **AI consumers:** Virtual key (from `aiGatewayKeys.key_hash`) → proxy validates → forwards to CF gateway

The proxy uses a separate auth path (virtual key lookup) that doesn't touch BetterAuth at all.
