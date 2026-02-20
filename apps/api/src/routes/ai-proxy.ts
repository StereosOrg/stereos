import { Hono } from 'hono';
import type { Database } from '@stereos/shared/db';
import * as schema from '@stereos/shared/schema';
import { aiGatewayKeys, gatewayEvents } from '@stereos/shared/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { checkBudget } from './ai-keys.js';
import { ingestOtelSpans } from '../lib/telemetry-ingest.js';
import type { AppVariables } from '../types/app.js';


const router = new Hono<{ Variables: AppVariables }>();

// Extract virtual key from headers.
// Supports:
// - x-stereos-virtual-key (preferred)
// - Authorization: Bearer <key>
// - x-api-key: <key>
function extractApiKey(c: any): string | null {
  const virtualKeyHeader = c.req.header('x-stereos-virtual-key');
  if (virtualKeyHeader && virtualKeyHeader.trim()) return virtualKeyHeader.trim();

  const auth = c.req.header('authorization') || c.req.header('Authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }

  const apiKeyHeader = c.req.header('x-api-key');
  if (apiKeyHeader && apiKeyHeader.trim()) return apiKeyHeader.trim();

  return null;
}

// Hash key for lookup
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

type ParsedRequest = {
  model: string | null;
  contentType: string | null;
  rawBody: ArrayBuffer | null;
};

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

function parseUsageHeader(value: string): Usage | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Try JSON first
  try {
    const json = JSON.parse(trimmed) as Usage;
    if (json && (json.prompt_tokens || json.completion_tokens || json.total_tokens)) {
      return json;
    }
  } catch {
    // fallthrough
  }

  // Try key=value pairs (e.g., "prompt_tokens=12, completion_tokens=34, total_tokens=46")
  const parts = trimmed.split(',');
  const usage: Usage = {};
  for (const part of parts) {
    const [rawKey, rawVal] = part.split('=').map((p) => p.trim());
    if (!rawKey || !rawVal) continue;
    const num = Number(rawVal);
    if (!Number.isFinite(num)) continue;
    if (rawKey === 'prompt_tokens') usage.prompt_tokens = num;
    if (rawKey === 'completion_tokens') usage.completion_tokens = num;
    if (rawKey === 'total_tokens') usage.total_tokens = num;
  }
  return usage.prompt_tokens || usage.completion_tokens || usage.total_tokens ? usage : null;
}

async function parseRequest(c: any): Promise<ParsedRequest> {
  const rawReq = c.req.raw as Request;
  const contentType = c.req.header('Content-Type') || null;
  let rawBody: ArrayBuffer | null = null;
  let model: string | null = null;

  if (rawReq.body) {
    rawBody = await rawReq.arrayBuffer();
  }

  if (contentType && rawBody) {
    if (contentType.includes('application/json')) {
      const text = new TextDecoder().decode(rawBody);
      try {
        const body = JSON.parse(text) as { model?: string };
        if (body && typeof body.model === 'string') model = body.model;
      } catch {
        // ignore parse errors, request may be non-JSON despite header
      }
    } else if (contentType.includes('multipart/form-data')) {
      const parseReq = new Request('http://local/form', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: rawBody,
      });
      const form = await parseReq.formData().catch(() => null);
      const formModel = form?.get('model');
      if (typeof formModel === 'string') model = formModel;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = new TextDecoder().decode(rawBody);
      const params = new URLSearchParams(text);
      const formModel = params.get('model');
      if (formModel) model = formModel;
    }
  }

  return { model, contentType, rawBody };
}

async function handleProxy(c: any, endpointPath: string) {
  const db = c.get('db') as Database;
  const startTime = Date.now();
  const debugEnabled = c.req.header('x-debug') === '1';
  const apiKey = extractApiKey(c);

  if (!apiKey) {
    return c.json({ error: 'API key required', code: 'unauthorized' }, 401);
  }

  const keyHash = hashKey(apiKey);

  try {
    // 1. Look up the virtual key
    const key = await db.query.aiGatewayKeys.findFirst({
      where: eq(aiGatewayKeys.key_hash, keyHash),
      with: {
        customer: {
          columns: {
            id: true,
            cf_gateway_id: true,
            user_id: true,
          },
        },
        user: {
          columns: {
            id: true,
            email: true,
          },
        },
        team: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!key) {
      return c.json({ error: 'Invalid API key', code: 'invalid_key' }, 401);
    }

    // 2. Check if key is disabled
    if (key.disabled) {
      return c.json({ error: 'Key is disabled', code: 'key_disabled' }, 403);
    }

    // 3. Check budget
    const budgetCheck = await checkBudget(key);
    if (!budgetCheck.allowed) {
      return c.json({
        error: 'Budget exceeded',
        code: 'budget_exceeded',
        remaining_usd: budgetCheck.remaining_usd
      }, 429);
    }

    // 4. Parse request body to check model
    const { model: rawRequestedModel, contentType, rawBody } = await parseRequest(c);

    if (!rawRequestedModel && c.req.method !== 'GET') {
      return c.json({ error: 'Model is required', code: 'model_required' }, 400);
    }

    // Strip provider prefix from model (e.g., "openai/gpt-4o" -> "gpt-4o")
    const requestedModel = rawRequestedModel?.includes('/') 
      ? rawRequestedModel.split('/')[1] 
      : rawRequestedModel;

    // 5. Check model allow-list (also strip prefix from allowed_models for comparison)
    if (requestedModel && key.allowed_models && key.allowed_models.length > 0) {
      const normalizedAllowedModels = key.allowed_models.map(m => 
        m.includes('/') ? m.split('/')[1] : m
      );
      if (!normalizedAllowedModels.includes(requestedModel)) {
        return c.json({
          error: `Model "${requestedModel}" not allowed for this key`,
          code: 'model_not_allowed',
          allowed_models: key.allowed_models
        }, 403);
      }
    }

    // 6. Get Cloudflare gateway info
    const cfAccountId = (c.env as any)?.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
    const cfApiToken = (c.env as any)?.CF_AI_GATEWAY_API_TOKEN || process.env.CF_AI_GATEWAY_API_TOKEN;
    const cfGatewayId = key.customer?.cf_gateway_id;

    if (!cfAccountId || !cfApiToken || !cfGatewayId) {
      return c.json({ error: 'AI Gateway not configured', code: 'gateway_not_configured' }, 503);
    }

    // 7. Fetch customer's provider keys
    const customerData = await db.query.customers.findFirst({
      where: eq(schema.customers.id, key.customer_id),
      columns: { provider_keys: true },
    });

    const providerKeys = (customerData?.provider_keys || {}) as Record<string, { key: string; enabled: boolean }>;
    const provider = requestedModel ? inferProvider(requestedModel) : 'openai';
    
    // Check if provider is configured and enabled
    const providerConfig = providerKeys[provider];
    if (!providerConfig || !providerConfig.enabled) {
      return c.json({ 
        error: `Provider "${provider}" not configured. Please ask your admin to configure ${provider} API keys in settings.`, 
        code: 'provider_not_configured' 
      }, 400);
    }

    // Decrypt provider key
    const xorKey = process.env.PROVIDER_KEY_ENCRYPTION_SECRET || 'default-secret-change-me';
    const encryptedKey = providerConfig.key;
    const buffer = Buffer.from(encryptedKey, 'base64');
    let providerApiKey = '';
    for (let i = 0; i < buffer.length; i++) {
      providerApiKey += String.fromCharCode(buffer[i] ^ xorKey.charCodeAt(i % xorKey.length));
    }

    const cfUrl = `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${cfGatewayId}/${provider}${endpointPath}`;

    // Modify body to strip provider prefix from model
    let modifiedBody: Buffer | undefined;
    if (rawBody && contentType?.includes('application/json')) {
      try {
        const bodyText = new TextDecoder().decode(rawBody);
        const bodyJson = JSON.parse(bodyText);
        if (bodyJson.model && bodyJson.model.includes('/')) {
          bodyJson.model = bodyJson.model.split('/')[1];
        }
        modifiedBody = Buffer.from(JSON.stringify(bodyJson));
      } catch {
        modifiedBody = rawBody ? Buffer.from(rawBody) : undefined;
      }
    } else {
      modifiedBody = rawBody ? Buffer.from(rawBody) : undefined;
    }

    // Forward with provider key (BYOK)
    const headers: Record<string, string> = {
      'cf-aig-authorization': `Bearer ${cfApiToken}`,
      'Authorization': `Bearer ${providerApiKey}`,
    };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const cfResponse = await fetch(cfUrl, {
      method: c.req.method,
      headers,
      body: modifiedBody,
    });

    const responseContentType = cfResponse.headers.get('content-type') || '';
    const isJson = responseContentType.includes('application/json');
    let responseBody: { usage?: Usage } | null = null;
    if (isJson) {
      try {
        responseBody = await cfResponse.json() as { usage?: Usage };
      } catch {
        responseBody = null;
      }
    }
    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // 8. Extract token usage
    const usageHeader =
      cfResponse.headers.get('cf-aig-usage') ||
      cfResponse.headers.get('x-usage') ||
      cfResponse.headers.get('openai-usage') ||
      cfResponse.headers.get('x-openai-usage');
    const headerUsage = usageHeader ? parseUsageHeader(usageHeader) : null;
    const usage = responseBody?.usage || headerUsage || {};

    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

    // 9. Record gateway usage event (best-effort)
    const telemetryUserId = key.user_id ?? key.created_by_user_id ?? key.customer?.user_id ?? null;
    await db.insert(gatewayEvents).values({
      customer_id: key.customer_id,
      key_id: key.id,
      key_hash: key.key_hash,
      user_id: telemetryUserId,
      team_id: key.team_id,
      model: requestedModel || 'unknown',
      provider,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      status_code: cfResponse.status,
      duration_ms: durationMs,
    }).catch((error: unknown) => {
      console.warn('AI Proxy: failed to record gateway event', error);
    });

    // 10. Emit telemetry span (non-blocking)
    if (!telemetryUserId) {
      console.warn('AI Proxy: unable to emit telemetry (missing user_id and created_by_user_id on key)');
    } else {
      emitTelemetrySpan({
      db,
      customerId: key.customer_id,
      userId: telemetryUserId,
      teamId: key.team_id,
      model: requestedModel || 'unknown',
      provider,
      promptTokens,
      completionTokens,
      durationMs,
      startTime,
      endTime,
      responseOk: cfResponse.ok,
      }).catch(console.error);
    }

    // 11. Return response to client
    if (isJson) {
      const jsonResponse = c.json(responseBody, cfResponse.status as any);
      if (debugEnabled) {
        jsonResponse.headers.set('x-stereos-upstream-url', cfUrl);
        jsonResponse.headers.set('x-stereos-upstream-status', String(cfResponse.status));
      }
      return jsonResponse;
    }
    const binary = await cfResponse.arrayBuffer();
    const headersOut: Record<string, string> = {};
    if (responseContentType) headersOut['Content-Type'] = responseContentType;
    if (debugEnabled) {
      headersOut['x-stereos-upstream-url'] = cfUrl;
      headersOut['x-stereos-upstream-status'] = String(cfResponse.status);
    }
    return new Response(binary, { status: cfResponse.status, headers: headersOut });

  } catch (error) {
    console.error('AI Proxy error:', error);
    return c.json({
      error: 'Internal server error',
      code: 'internal_error'
    }, 500);
  }
}

// Main proxy endpoint — OpenAI-compatible paths
router.all('/chat/completions', (c) => handleProxy(c, '/chat/completions'));
router.all('/responses', (c) => handleProxy(c, '/responses'));
router.all('/embeddings', (c) => handleProxy(c, '/embeddings'));
router.all('/images/generations', (c) => handleProxy(c, '/images/generations'));
router.all('/audio/transcriptions', (c) => handleProxy(c, '/audio/transcriptions'));
router.all('/audio/speech', (c) => handleProxy(c, '/audio/speech'));
router.all('/moderations', (c) => handleProxy(c, '/moderations'));

// Infer provider from model name
function inferProvider(model: string): string {
  if (model.includes('openai') || model.includes('gpt')) return 'openai';
  if (model.includes('anthropic') || model.includes('claude')) return 'anthropic';
  if (model.includes('meta') || model.includes('llama')) return 'workers-ai';
  if (model.includes('mistral')) return 'workers-ai';
  if (model.includes('@cf/') || model.includes('@hf/')) return 'workers-ai';
  return 'workers-ai';
}

// Emit telemetry span
async function emitTelemetrySpan({
  db,
  customerId,
  userId,
  teamId,
  model,
  provider,
  promptTokens,
  completionTokens,
  durationMs,
  startTime,
  endTime,
  responseOk,
}: {
  db: any;
  customerId: string;
  userId: string | null;
  teamId: string | null;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  startTime: number;
  endTime: number;
  responseOk: boolean;
}): Promise<void> {
  try {
    const traceId = crypto.randomUUID().replace(/-/g, '');
    const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    const spanAttributes = {
      'user.id': userId || 'anonymous',
      'team.id': teamId || '',
      'gen_ai.request.model': model,
      'gen_ai.response.model': model,
      'gen_ai.usage.input_tokens': String(promptTokens),
      'gen_ai.usage.output_tokens': String(completionTokens),
      'llm.provider': provider,
    };

    // Call telemetry ingestion
    await ingestOtelSpans(db, {
      resourceSpans: [{
        resource: {
          attributes: [{
            key: 'service.name',
            value: { stringValue: 'cloudflare-ai-gateway' },
          }, {
            key: 'llm.provider',
            value: { stringValue: provider },
          }, {
            key: 'user.id',
            value: { stringValue: userId || '' },
          }, {
            key: 'team.id',
            value: { stringValue: teamId || '' },
          }],
        },
        scopeSpans: [{
          spans: [{
            traceId,
            spanId,
            name: `${model}`,
            kind: 3, // CLIENT
            startTimeUnixNano: String(startTime * 1_000_000),
            endTimeUnixNano: String(endTime * 1_000_000),
            durationMs,
            status: { code: responseOk ? 1 : 2 },
            attributes: Object.entries(spanAttributes).map(([key, value]) => ({
              key,
              value: { stringValue: String(value) },
            })),
          }],
        }],
      }],
    });
  } catch (error) {
    console.error('Error emitting telemetry:', error);
    // Don't throw - telemetry is non-critical
  }
}

export default router;
