# Cloudflare AI Gateway Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace OpenRouter with Cloudflare AI Gateway for multi-tenant AI access — one gateway per customer, virtual keys with spend enforcement and model restrictions, proxy-emitted telemetry that feeds the existing dashboard UI.

**Architecture:** Proxy layer in the existing Hono worker forwards AI requests to per-customer CF gateways. Budget and model restrictions live on virtual keys (no separate guardrails). The proxy emits OTel spans to the existing telemetry pipeline, preserving all dashboard/LLM stats UI.

**Tech Stack:** Hono (existing), Drizzle ORM + Postgres (existing), Cloudflare AI Gateway API, Cloudflare Workers (existing deployment target)

**Design Doc:** `docs/cloudflare-ai-gateway-implementation.md`

---

## Task 1: Schema — Add `cf_gateway_id` to Customers + Create `AiGatewayKey` Table

**Files:**
- Modify: `packages/shared/src/schema.ts`
- Create: `drizzle/migrations/031_ai_gateway.sql`
- Create: `scripts/run-migrate-031.ts`

**Step 1: Add `cf_gateway_id` column to `customers` table in schema**

In `packages/shared/src/schema.ts`, add to the `customers` table definition (after `billing_email` line ~84):

```typescript
cf_gateway_id: text('cf_gateway_id').unique(),
```

**Step 2: Add `AiGatewayKey` table and enum to schema**

In `packages/shared/src/schema.ts`, after the `// ── OpenRouter` section (~line 269), add:

```typescript
// ── AI Gateway (Cloudflare) ─────────────────────────────────────────────

export const aiGatewayKeyBudgetResetEnum = pgEnum('ai_gateway_key_budget_reset', ['daily', 'weekly', 'monthly']);

export const aiGatewayKeys = pgTable('AiGatewayKey', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  user_id: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  team_id: text('team_id').references(() => teams.id, { onDelete: 'set null' }),
  key_hash: text('key_hash').notNull().unique(),
  name: text('name').notNull(),
  budget_usd: decimal('budget_usd', { precision: 10, scale: 4 }),
  budget_reset: aiGatewayKeyBudgetResetEnum('budget_reset'),
  spend_usd: decimal('spend_usd', { precision: 10, scale: 4 }).default('0').notNull(),
  spend_reset_at: timestamp('spend_reset_at', { withTimezone: true }),
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

**Step 3: Add relations for `aiGatewayKeys`**

After the `openrouterKeysRelations` block (~line 374), add:

```typescript
export const aiGatewayKeysRelations = relations(aiGatewayKeys, ({ one }) => ({
  customer: one(customers, { fields: [aiGatewayKeys.customer_id], references: [customers.id] }),
  user: one(users, { fields: [aiGatewayKeys.user_id], references: [users.id] }),
  team: one(teams, { fields: [aiGatewayKeys.team_id], references: [teams.id] }),
}));
```

Add `aiGatewayKeys: many(aiGatewayKeys),` to `customersRelations` (~line 350).

Add type export at the bottom:

```typescript
export type AiGatewayKey = typeof aiGatewayKeys.$inferSelect;
```

**Step 4: Remove OpenRouter schema**

Delete from `packages/shared/src/schema.ts`:
- `openrouterKeyLimitResetEnum` (~line 271)
- `openrouterKeys` table (~line 273-288)
- `openrouterKeysRelations` (~line 370-374)
- `openrouterKeys: many(openrouterKeys)` from `customersRelations` (~line 357)
- `OpenRouterKey` type export (~line 404)

**Step 5: Write the SQL migration**

Create `drizzle/migrations/031_ai_gateway.sql`:

```sql
-- Add cf_gateway_id to Customer
ALTER TABLE "Customer" ADD COLUMN "cf_gateway_id" text UNIQUE;

-- Create budget reset enum
DO $$ BEGIN
  CREATE TYPE "ai_gateway_key_budget_reset" AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create AiGatewayKey table
CREATE TABLE IF NOT EXISTS "AiGatewayKey" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" text NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "user_id" text REFERENCES "User"("id") ON DELETE SET NULL,
  "team_id" text REFERENCES "Team"("id") ON DELETE SET NULL,
  "key_hash" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "budget_usd" numeric(10, 4),
  "budget_reset" "ai_gateway_key_budget_reset",
  "spend_usd" numeric(10, 4) NOT NULL DEFAULT '0',
  "spend_reset_at" timestamp with time zone,
  "allowed_models" jsonb,
  "disabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "AiGatewayKey_customer_id_idx" ON "AiGatewayKey" ("customer_id");
CREATE INDEX IF NOT EXISTS "AiGatewayKey_user_id_idx" ON "AiGatewayKey" ("user_id");
CREATE INDEX IF NOT EXISTS "AiGatewayKey_team_id_idx" ON "AiGatewayKey" ("team_id");

-- Drop OpenRouter tables
DROP TABLE IF EXISTS "OpenRouterKey" CASCADE;
DROP TYPE IF EXISTS "openrouter_key_limit_reset";
```

**Step 6: Write the migration runner script**

Create `scripts/run-migrate-031.ts` following the pattern from `scripts/run-migrate-029-030.ts`:

```typescript
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import postgres from 'postgres';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const root = resolve(__dirname, '..');
const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/stereos';

const migrations = ['031_ai_gateway.sql'];

async function main() {
  const sql = postgres(connectionString);
  for (const file of migrations) {
    const path = resolve(root, 'drizzle/migrations', file);
    const body = readFileSync(path, 'utf-8');
    console.log(`Applying ${file}...`);
    await sql.unsafe(body);
    console.log(`  ✓ ${file} applied.`);
  }
  await sql.end();
  console.log('All migrations applied successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 7: Verify typecheck passes**

Run: `npm run typecheck`
Expected: May have errors in files that import from `openrouterKeys` — that's expected and will be fixed in Task 2.

**Step 8: Commit**

```bash
git add packages/shared/src/schema.ts drizzle/migrations/031_ai_gateway.sql scripts/run-migrate-031.ts
git commit -m "feat: add AiGatewayKey schema, cf_gateway_id on Customer, drop OpenRouterKey"
```

---

## Task 2: Delete OpenRouter Backend Code

**Files:**
- Delete: `apps/api/src/lib/openrouter.ts`
- Delete: `apps/api/src/routes/openrouter.ts`
- Modify: `apps/api/src/index.ts` (lines 12, 56)
- Modify: `apps/api/src/worker.ts` (lines 12, 177)

**Step 1: Delete OpenRouter files**

```bash
rm apps/api/src/lib/openrouter.ts apps/api/src/routes/openrouter.ts
```

**Step 2: Remove OpenRouter router from `apps/api/src/index.ts`**

Delete the import (line 12):
```typescript
import openrouterRouter from './routes/openrouter.js';
```

Delete the route registration (line 56):
```typescript
app.route('/v1', openrouterRouter);
```

**Step 3: Remove OpenRouter router from `apps/api/src/worker.ts`**

Delete the import (line 12):
```typescript
import openrouterRouter from './routes/openrouter.js';
```

Delete the route registration (line 177):
```typescript
app.route('/v1', openrouterRouter);
```

**Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS (OpenRouter imports removed, schema references removed in Task 1)

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete OpenRouter lib and routes"
```

---

## Task 3: Implement `lib/cloudflare-ai.ts`

**Files:**
- Create: `apps/api/src/lib/cloudflare-ai.ts`

**Step 1: Create the Cloudflare AI Gateway client**

Create `apps/api/src/lib/cloudflare-ai.ts`:

```typescript
/**
 * Cloudflare AI Gateway API client.
 * Used to provision per-customer gateways and list available models.
 */

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

export type CfModel = {
  id: string;
  name: string;
  description: string;
  task: { id: string; name: string; description: string };
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
        collect_logs: false,
        rate_limiting_limit: 0,
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

export async function listCfModels(
  accountId: string,
  apiToken: string
): Promise<CfModel[]> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/ai/models/search`,
    {
      headers: { Authorization: `Bearer ${apiToken}` },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF AI models list failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { result: CfModel[] };
  return json.result;
}
```

**Step 2: Commit**

```bash
git add apps/api/src/lib/cloudflare-ai.ts
git commit -m "feat: add Cloudflare AI Gateway client library"
```

---

## Task 4: Add ID Generator for AI Gateway Keys

**Files:**
- Modify: `packages/shared/src/ids.ts`

**Step 1: Add `newAiGatewayKey` function**

In `packages/shared/src/ids.ts`, add after `newApiToken` (~line 22):

```typescript
/** AI Gateway virtual key: "aig_" + no-dash UUID */
export function newAiGatewayKey(): string {
  return `aig_${crypto.randomUUID().replace(/-/g, '')}`;
}
```

**Step 2: Commit**

```bash
git add packages/shared/src/ids.ts
git commit -m "feat: add AI gateway key ID generator"
```

---

## Task 5: Add CF Environment Variables to Worker

**Files:**
- Modify: `apps/api/src/worker.ts` (Env type, ~line 26-49)
- Modify: `wrangler.toml`

**Step 1: Add CF env vars to Env type in `apps/api/src/worker.ts`**

Add to the `Env` type (after `OPENROUTER_BROADCAST_SECRET`, ~line 42):

```typescript
CF_ACCOUNT_ID?: string;
CF_AI_GATEWAY_API_TOKEN?: string;
```

Remove the OpenRouter-specific entries from the `Env` type:
```typescript
OPENROUTER_MANAGEMENT_KEY?: string;
```

**Step 2: Update wrangler.toml secrets comments**

In `wrangler.toml`, update the secrets comment block (~line 13-20). Replace the `OPENROUTER_BROADCAST_SECRET` and `OPENROUTER_MANAGEMENT_KEY` lines with:

```toml
# - CF_ACCOUNT_ID (Cloudflare account ID for AI Gateway)
# - CF_AI_GATEWAY_API_TOKEN (Cloudflare API token with AI Gateway permissions)
```

**Step 3: Commit**

```bash
git add apps/api/src/worker.ts wrangler.toml
git commit -m "feat: add CF AI Gateway env vars, remove OpenRouter env vars"
```

---

## Task 6: Hook CF Gateway Provisioning Into Customer Registration

**Files:**
- Modify: `apps/api/src/routes/auth.ts` (lines 79-112)

**Step 1: Add import**

At the top of `apps/api/src/routes/auth.ts`, add:

```typescript
import { createCfGateway } from '../lib/cloudflare-ai.js';
```

**Step 2: Add gateway provisioning to `POST /v1/customers/register`**

In `apps/api/src/routes/auth.ts`, in the `POST /v1/customers/register` handler (~line 84), after `const stripeCustomerId = await createStripeCustomer(email, name, stripeKey);` and before the `db.insert(customers)` call:

```typescript
    const cfAccountId = (c as { env?: { CF_ACCOUNT_ID?: string } }).env?.CF_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
    const cfApiToken = (c as { env?: { CF_AI_GATEWAY_API_TOKEN?: string } }).env?.CF_AI_GATEWAY_API_TOKEN ?? process.env.CF_AI_GATEWAY_API_TOKEN;
    let cfGatewayId: string | null = null;

    if (cfAccountId && cfApiToken) {
      try {
        const gatewaySlug = `stereos-${customerId}`;
        const gw = await createCfGateway(cfAccountId, cfApiToken, { id: gatewaySlug });
        cfGatewayId = gw.id;
      } catch (err) {
        console.error('CF AI Gateway provisioning failed:', err);
        // Non-fatal: customer can still be created, gateway can be provisioned later
      }
    }
```

Then add `cf_gateway_id: cfGatewayId,` to the `db.insert(customers).values({...})` call.

**Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/auth.ts
git commit -m "feat: provision CF AI Gateway on customer registration"
```

---

## Task 7: Extract Telemetry Ingestion Into Shared Library

**Files:**
- Create: `apps/api/src/lib/telemetry-ingest.ts`
- Modify: `apps/api/src/routes/telemetry.ts`

**Step 1: Create `lib/telemetry-ingest.ts`**

Extract the core ingestion logic from `POST /v1/traces` in `routes/telemetry.ts` (lines 88-268) into a reusable function. This function handles:
- User/team attribution resolution
- Vendor canonicalization
- ToolProfile upsert
- TelemetrySpan insertion
- Stripe usage tracking

The function signature:

```typescript
import type { Database } from '@stereos/shared/db';

export interface IngestOtelSpansResult {
  acceptedSpans: number;
  rejectedSpans: number;
}

export async function ingestOtelSpans(
  db: Database,
  body: { resourceSpans: any[] },
  stripeApiKey?: string
): Promise<IngestOtelSpansResult>
```

Move the body of the `POST /v1/traces` handler (everything between parsing the body and the return statement) into this function. Keep the auth middleware and body parsing in the route handler.

Also export a helper `toOtelAttributes` that converts a flat `Record<string, string>` into the OTel attribute array format:

```typescript
export function toOtelAttributes(attrs: Record<string, string>): Array<{ key: string; value: { stringValue: string } }> {
  return Object.entries(attrs).map(([key, val]) => ({
    key,
    value: { stringValue: String(val) },
  }));
}
```

**Step 2: Refactor `routes/telemetry.ts` to use shared function**

Replace the inline ingestion logic in the `POST /v1/traces` handler with a call to `ingestOtelSpans`. The route handler should only:
1. Run `openRouterBroadcastAuth` middleware (rename to `traceIngestAuth`)
2. Parse JSON body
3. Call `ingestOtelSpans(db, body, stripeKey)`
4. Return the result

Rename `openRouterBroadcastAuth` to `traceIngestAuth` and update the env var it reads from `OPENROUTER_BROADCAST_SECRET` to `TRACE_INGEST_SECRET` (keep backward compat by checking both):

```typescript
async function traceIngestAuth(c: any, next: any) {
  const env = c.env ?? process.env;
  const secret = env?.TRACE_INGEST_SECRET ?? env?.OPENROUTER_BROADCAST_SECRET;
  if (!secret) {
    return c.json({ error: 'Trace ingest not configured' }, 503);
  }
  // ... rest same as before
}
```

**Step 3: Run tests**

Run: `npm test`
Expected: Existing tests pass (the telemetry tests depend on the vendor-map, not the ingestion directly)

**Step 4: Commit**

```bash
git add apps/api/src/lib/telemetry-ingest.ts apps/api/src/routes/telemetry.ts
git commit -m "refactor: extract telemetry ingestion into shared lib"
```

---

## Task 8: Implement `routes/ai-keys.ts` — Key Management

**Files:**
- Create: `apps/api/src/routes/ai-keys.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/worker.ts`

**Step 1: Create `routes/ai-keys.ts`**

This is a refactored version of the old `routes/openrouter.ts`. Same RBAC middleware (`sessionOrTokenAuth`, `requireAdminOrManager`, `isTeamMember`), same route structure, but:
- Uses `aiGatewayKeys` instead of `openrouterKeys`
- No external API calls for key creation (keys are local)
- `key_hash` stored as SHA-256 of the raw key
- Spend/budget data comes from DB (no `enrichKeysWithUsage`)
- Includes `PATCH /v1/ai/keys/:hash` for editing
- Includes `GET /v1/ai/models` proxying the CF models list

Routes to implement:
- `GET /v1/ai/keys/customer` — list all keys (admin/manager)
- `GET /v1/ai/keys/user/:userId` — user keys + team keys
- `GET /v1/ai/keys/user` — current user's keys
- `POST /v1/ai/keys/user` — create user key
- `POST /v1/ai/keys/team/:teamId` — create team key
- `DELETE /v1/ai/keys/user/:hash` — delete user key
- `DELETE /v1/ai/keys/team/:teamId/:hash` — delete team key
- `DELETE /v1/ai/keys/:hash` — delete any key (admin/manager)
- `GET /v1/ai/keys/:hash/details` — key details with spend/budget
- `PATCH /v1/ai/keys/:hash` — update key (budget, allowed_models, disabled, name)
- `GET /v1/ai/models` — list available CF models

For key creation, generate the raw key using `newAiGatewayKey()` from `@stereos/shared/ids`, then hash with SHA-256 for storage:

```typescript
import { newAiGatewayKey } from '@stereos/shared/ids';

// In create handler:
const rawKey = newAiGatewayKey();
const keyHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
const keyHash = Array.from(new Uint8Array(keyHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
```

For the proxy auth in Task 9, also export a helper to look up keys by hash.

**Step 2: Register routes in `index.ts` and `worker.ts`**

In both `apps/api/src/index.ts` and `apps/api/src/worker.ts`:

Add import:
```typescript
import aiKeysRouter from './routes/ai-keys.js';
```

Add route (where `openrouterRouter` was):
```typescript
app.route('/v1', aiKeysRouter);
```

**Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/ai-keys.ts apps/api/src/index.ts apps/api/src/worker.ts
git commit -m "feat: implement AI gateway key management routes"
```

---

## Task 9: Implement `routes/ai-proxy.ts` — Request Forwarding + Telemetry

**Files:**
- Create: `apps/api/src/routes/ai-proxy.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/worker.ts`

**Step 1: Create `routes/ai-proxy.ts`**

This is the core proxy route. Handles:
1. Virtual key auth (look up `aiGatewayKeys` by SHA-256 hash of Bearer token)
2. Model allow-list enforcement
3. Budget check
4. Forward to CF AI Gateway: `https://gateway.ai.cloudflare.com/v1/{cf_account_id}/{cf_gateway_id}/{provider}/chat/completions`
5. Return response to client
6. Post-response: record spend, emit OTel span via `ingestOtelSpans`, record Stripe usage event

Key route:
```
POST /v1/ai/chat/completions
Authorization: Bearer <virtual_key>
Body: OpenAI-compatible chat completion request (must include "model" and "provider" fields, or infer provider from model)
```

The `provider` field tells the proxy which upstream provider path to use in the CF gateway URL. If not provided, infer from model name conventions.

For the post-response telemetry, call `ingestOtelSpans` from `lib/telemetry-ingest.ts` with a constructed OTel payload using `toOtelAttributes`.

**Step 2: Register route**

In both `apps/api/src/index.ts` and `apps/api/src/worker.ts`:

```typescript
import aiProxyRouter from './routes/ai-proxy.js';
app.route('/v1', aiProxyRouter);
```

**Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/ai-proxy.ts apps/api/src/index.ts apps/api/src/worker.ts
git commit -m "feat: implement AI gateway proxy with spend enforcement and telemetry"
```

---

## Task 10: Frontend — Extract `SearchableMultiSelect` Component

**Files:**
- Create: `apps/web/src/components/SearchableMultiSelect.tsx`
- Modify: `apps/web/src/pages/Guardrails.tsx` (temporary — will be deleted in Task 13)

**Step 1: Extract the component**

Copy the `SearchableMultiSelect` component and the `DropdownOption` interface from `apps/web/src/pages/Guardrails.tsx` (lines 326-521) into a new file `apps/web/src/components/SearchableMultiSelect.tsx`. Export both.

**Step 2: Commit**

```bash
git add apps/web/src/components/SearchableMultiSelect.tsx
git commit -m "refactor: extract SearchableMultiSelect into shared component"
```

---

## Task 11: Frontend — Rework `KeyManagement.tsx`

**Files:**
- Modify: `apps/web/src/pages/KeyManagement.tsx`

**Step 1: Update `KeyItem` interface**

Replace the `KeyItem` interface (lines 8-25) with:

```typescript
interface KeyItem {
  id: string;
  key_hash: string;
  name: string;
  user_id: string | null;
  team_id: string | null;
  user_email: string | null;
  user_name: string | null;
  team_name: string | null;
  budget_usd: string | null;
  budget_reset: string | null;
  spend_usd: string;
  allowed_models: string[] | null;
  disabled: boolean;
  created_at: string;
}
```

**Step 2: Update all API endpoints**

- `GET /v1/keys/customer` → `GET /v1/ai/keys/customer` (line 94)
- `POST /v1/keys/user` → `POST /v1/ai/keys/user` (line 176)
- `DELETE /v1/keys/${hash}` → `DELETE /v1/ai/keys/${hash}` (line 210)
- `POST /v1/keys/team/${teamId}` → `POST /v1/ai/keys/team/${teamId}` (line 229)

**Step 3: Update data field references**

Replace all `openrouter_key_hash` references with `key_hash`:
- Link to detail page (line 455): `to={/keys/${k.key_hash}}`
- Hash display (line 461): `k.key_hash.slice(0, 16)`
- Delete handler (line 499): `deleteKey(k.key_hash)`

Replace usage display (line 478): show `spend_usd` instead of `usage_monthly`:
```typescript
{k.spend_usd ? `$${parseFloat(k.spend_usd).toFixed(2)}` : '—'}
```

Update summary `totalMonthlyUsage` (line 143) to sum `spend_usd` instead of `usage_monthly`.

**Step 4: Add budget + allowed_models fields to create modals**

In both `ProvisionUserModal` and `ProvisionTeamModal`, add:
- Budget USD input field
- Budget reset select (daily/weekly/monthly/none)
- Allowed models multi-select using `SearchableMultiSelect` (import from `../components/SearchableMultiSelect`)
- Fetch models from `GET /v1/ai/models` for the dropdown

Include `budget_usd`, `budget_reset`, and `allowed_models` in the POST body.

**Step 5: Remove guardrails link**

Remove the `<Link to="/guardrails"...>` from the description text (line 262).

**Step 6: Verify frontend builds**

Run: `npm run build:web`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/web/src/pages/KeyManagement.tsx
git commit -m "feat: rework KeyManagement for CF AI Gateway keys"
```

---

## Task 12: Frontend — Rework `KeyDetail.tsx`

**Files:**
- Modify: `apps/web/src/pages/KeyDetail.tsx`

**Step 1: Update `KeyDetailData` interface**

Replace (lines 7-25) with:

```typescript
interface KeyDetailData {
  key: {
    id: string;
    key_hash: string;
    name: string;
    disabled: boolean;
    budget_usd: string | null;
    spend_usd: string;
    budget_reset: string | null;
    spend_reset_at: string | null;
    allowed_models: string[] | null;
    user_id: string | null;
    team_id: string | null;
    created_at: string;
  };
}
```

**Step 2: Update API endpoint**

Change fetch URL (line 33) from `/v1/keys/${hash}/details` to `/v1/ai/keys/${hash}/details`.

**Step 3: Update stat cards**

Replace the three stat cards (lines 147-168):
- "Total usage" → show `spend_usd`: `fmtUsd(parseFloat(k.spend_usd))`
- "Limit remaining" → show remaining budget: `k.budget_usd ? fmtUsd(parseFloat(k.budget_usd) - parseFloat(k.spend_usd)) : 'Unlimited'`
- "Expires" → replace with "Budget reset": `k.budget_reset ?? 'None'`

Remove the daily/weekly/monthly breakdown cards (lines 164-168).

**Step 4: Update detail rows**

Replace detail rows (lines 172-179):
- "Hash" → "Key hash" with `k.key_hash`
- "Limit" → "Budget" with `k.budget_usd ? $${parseFloat(k.budget_usd).toFixed(2)} : 'Unlimited'`
- "Limit reset" → "Budget reset" with `k.budget_reset ?? 'None'`
- Add "Allowed models" row: `k.allowed_models?.join(', ') || 'All models'`
- "Scope" stays
- "Created" stays
- Remove "Updated" and "Expires" rows

**Step 5: Add edit button and modal**

Add an edit button next to the key name that opens a modal for updating:
- `name`
- `budget_usd` / `budget_reset`
- `allowed_models` (using `SearchableMultiSelect`)
- `disabled` toggle

Modal submits `PATCH /v1/ai/keys/${hash}` and invalidates the query.

**Step 6: Verify frontend builds**

Run: `npm run build:web`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/web/src/pages/KeyDetail.tsx
git commit -m "feat: rework KeyDetail for CF AI Gateway keys with edit support"
```

---

## Task 13: Frontend — Delete Guardrails Page + Update Router

**Files:**
- Delete: `apps/web/src/pages/Guardrails.tsx`
- Modify: `apps/web/src/App.tsx` (lines 21, 58)

**Step 1: Delete Guardrails.tsx**

```bash
rm apps/web/src/pages/Guardrails.tsx
```

**Step 2: Remove from router**

In `apps/web/src/App.tsx`:
- Delete import (line 21): `import { Guardrails } from './pages/Guardrails';`
- Delete route (line 58): `<Route path="guardrails" element={<Guardrails />} />`

**Step 3: Verify frontend builds**

Run: `npm run build:web`
Expected: PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete Guardrails page, remove route"
```

---

## Task 14: Full Build Verification

**Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 2: Run tests**

Run: `npm test`
Expected: PASS

**Step 3: Build API**

Run: `npm run build:api`
Expected: PASS

**Step 4: Build Web**

Run: `npm run build:web`
Expected: PASS

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve build issues from CF AI Gateway migration"
```

---

## Summary

| Task | What | Files |
|---|---|---|
| 1 | Schema: `AiGatewayKey` table, `cf_gateway_id` on Customer, drop OpenRouter | `schema.ts`, migration SQL |
| 2 | Delete OpenRouter backend code | `lib/openrouter.ts`, `routes/openrouter.ts`, `index.ts`, `worker.ts` |
| 3 | CF AI Gateway client library | `lib/cloudflare-ai.ts` |
| 4 | AI gateway key ID generator | `packages/shared/src/ids.ts` |
| 5 | CF env vars in worker | `worker.ts`, `wrangler.toml` |
| 6 | Gateway provisioning at customer creation | `routes/auth.ts` |
| 7 | Extract telemetry ingestion into shared lib | `lib/telemetry-ingest.ts`, `routes/telemetry.ts` |
| 8 | Key management routes | `routes/ai-keys.ts`, `index.ts`, `worker.ts` |
| 9 | AI proxy with spend enforcement + telemetry | `routes/ai-proxy.ts`, `index.ts`, `worker.ts` |
| 10 | Extract SearchableMultiSelect component | `components/SearchableMultiSelect.tsx` |
| 11 | Rework KeyManagement.tsx | `KeyManagement.tsx` |
| 12 | Rework KeyDetail.tsx | `KeyDetail.tsx` |
| 13 | Delete Guardrails page + update router | `Guardrails.tsx`, `App.tsx` |
| 14 | Full build verification | All |
