import { Hono } from 'hono';
import type { Database } from '@stereos/shared/db';
import { aiGatewayKeys, gatewayEvents } from '@stereos/shared/schema';
import { eq, sql } from 'drizzle-orm';
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

// Cost per million tokens (input, output) in USD
const MODEL_PRICING: Record<string, [number, number]> = {
  // OpenAI
  'gpt-5.2': [1.75, 14.00],
  'gpt-5.1': [1.25, 10.00],
  'gpt-5': [1.25, 10.00],
  'gpt-5-mini': [0.25, 2.00],
  'gpt-5-nano': [0.05, 0.40],
  'gpt-5.2-chat-latest': [1.75, 14.00],
  'gpt-5.1-chat-latest': [1.25, 10.00],
  'gpt-5-chat-latest': [1.25, 10.00],
  'gpt-5.2-codex': [1.25, 14.00],
  'gpt-5.1-codex-max': [1.25, 10.00],
  'gpt-5.1-codex': [1.25, 10.00],
  'gpt-5-codex': [1.25, 10.00],
  'gpt-5.2-pro': [21.00, 168.00],
  'gpt-5-pro': [15.00, 120.00],
  'gpt-4.1': [2.00, 8.00],
  'gpt-4.1-mini': [0.40, 1.60],
  'gpt-4.1-nano': [0.10, 0.40],
  'gpt-4o': [2.50, 10.00],
  'gpt-4o-2024-05-13': [5.00, 15.00],
  'gpt-4o-mini': [0.15, 0.60],
  'o1': [15.00, 60.00],
  'o1-pro': [150.00, 600.00],
  'o3-pro': [20.00, 80.00],
  'o3': [2.00, 8.00],
  'o3-deep-research': [10.00, 40.00],
  'o4-mini': [1.10, 4.40],
  'o4-mini-deep-research': [2.00, 8.00],
  'o3-mini': [1.10, 4.40],
  'o1-mini': [1.10, 4.40],
  'gpt-5.1-codex-mini': [0.25, 2.00],
  'codex-mini-latest': [1.50, 6.00],
  'gpt-5-search-api': [1.25, 10.00],
  'gpt-4o-mini-search-preview': [0.15, 0.60],
  'gpt-4o-search-preview': [2.50, 10.00],
  // Anthropic
  'claude-open-4-5': [5.00, 25.00],
  'claude-opus-4-6': [5.00, 25.00],
  'claude-open-4-1': [15.00, 75.00],
  'claude-opus-4': [15.00, 75.00],
  'claude-sonnet-4-6': [3.00, 15.00],
  'claude-sonnet-4-5': [3.00, 15.00],
  'claude-sonnet-4': [3.00, 15.00],
  'claude-haiku-4-5': [1.00, 5.00],
  'claude-haiku-3-5': [0.80, 4.00],
};

function calculateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  // Find pricing by exact match or prefix match
  let pricing: [number, number] | undefined = MODEL_PRICING[model];
  if (!pricing) {
    for (const [key, val] of Object.entries(MODEL_PRICING)) {
      if (model.startsWith(key) || key.startsWith(model)) {
        pricing = val;
        break;
      }
    }
  }
  if (!pricing) {
    // Default fallback: treat as mid-tier model
    pricing = [3.00, 15.00];
  }
  const [inputPricePerM, outputPricePerM] = pricing;
  return (promptTokens * inputPricePerM + completionTokens * outputPricePerM) / 1_000_000;
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

    const provider = requestedModel ? inferProvider(requestedModel) : 'openai';
    const cfUrl = `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${cfGatewayId}/${provider}${endpointPath}`;

    // Modify body: strip provider prefix from model, inject stream usage option for OpenAI
    let modifiedBody: Buffer | undefined;
    if (rawBody && contentType?.includes('application/json')) {
      try {
        const bodyText = new TextDecoder().decode(rawBody);
        const bodyJson = JSON.parse(bodyText) as Record<string, unknown>;
        if (typeof bodyJson.model === 'string' && bodyJson.model.includes('/')) {
          bodyJson.model = bodyJson.model.split('/')[1];
        }
        // Ask OpenAI to include usage in the final stream chunk
        if (provider === 'openai' && bodyJson.stream === true) {
          bodyJson.stream_options = { ...(typeof bodyJson.stream_options === 'object' && bodyJson.stream_options !== null ? bodyJson.stream_options as object : {}), include_usage: true };
        }
        modifiedBody = Buffer.from(JSON.stringify(bodyJson));
      } catch {
        modifiedBody = rawBody ? Buffer.from(rawBody) : undefined;
      }
    } else {
      modifiedBody = rawBody ? Buffer.from(rawBody) : undefined;
    }

    const headers: Record<string, string> = {
      'cf-aig-authorization': `Bearer ${cfApiToken}`,
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

    // Read the full response body before extracting usage (needed for both paths)
    let responseBody: { usage?: Usage } | null = null;
    let binary: ArrayBuffer | null = null;
    if (isJson) {
      try {
        responseBody = await cfResponse.json() as { usage?: Usage };
      } catch {
        responseBody = null;
      }
    } else {
      binary = await cfResponse.arrayBuffer();
    }

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // 8. Extract token usage
    let promptTokens = 0;
    let completionTokens = 0;

    if (responseBody?.usage) {
      // Non-streaming JSON: handle both OpenAI (prompt_tokens) and Anthropic (input_tokens)
      const u = responseBody.usage as Record<string, number>;
      promptTokens = u.prompt_tokens ?? u.input_tokens ?? 0;
      completionTokens = u.completion_tokens ?? u.output_tokens ?? 0;
    } else if (binary) {
      // Streaming SSE: parse events for usage
      const parsed = extractSseUsage(binary, provider);
      promptTokens = parsed.prompt_tokens;
      completionTokens = parsed.completion_tokens;
    } else {
      // Fallback: try response headers
      const usageHeader =
        cfResponse.headers.get('cf-aig-usage') ||
        cfResponse.headers.get('x-usage') ||
        cfResponse.headers.get('openai-usage') ||
        cfResponse.headers.get('x-openai-usage');
      const headerUsage = usageHeader ? parseUsageHeader(usageHeader) : null;
      promptTokens = headerUsage?.prompt_tokens ?? 0;
      completionTokens = headerUsage?.completion_tokens ?? 0;
    }

    const totalTokens = promptTokens + completionTokens;

    // 9. Record gateway usage event and update key spend (best-effort)
    const telemetryUserId = key.user_id ?? key.created_by_user_id ?? key.customer?.user_id ?? null;
    const costUsd = calculateCostUsd(requestedModel || 'unknown', promptTokens, completionTokens);

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

    if (costUsd > 0 && cfResponse.ok) {
      await db.update(aiGatewayKeys)
        .set({ spend_usd: sql`spend_usd + ${costUsd.toFixed(6)}` })
        .where(eq(aiGatewayKeys.id, key.id))
        .catch((error: unknown) => {
          console.warn('AI Proxy: failed to update key spend', error);
        });
    }

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
    const headersOut: Record<string, string> = {};
    if (responseContentType) headersOut['Content-Type'] = responseContentType;
    if (debugEnabled) {
      headersOut['x-stereos-upstream-url'] = cfUrl;
      headersOut['x-stereos-upstream-status'] = String(cfResponse.status);
    }
    return new Response(binary!, { status: cfResponse.status, headers: headersOut });

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

// Parse SSE stream body for token usage (OpenAI and Anthropic)
function extractSseUsage(binary: ArrayBuffer, provider: string): { prompt_tokens: number; completion_tokens: number } {
  const text = new TextDecoder().decode(binary);
  let promptTokens = 0;
  let completionTokens = 0;

  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    try {
      const data = JSON.parse(line.slice(6)) as Record<string, unknown>;

      if (provider === 'anthropic') {
        // message_start: { type: 'message_start', message: { usage: { input_tokens, output_tokens } } }
        const msg = (data as any)?.message;
        if (data.type === 'message_start' && msg?.usage?.input_tokens !== undefined) {
          promptTokens = msg.usage.input_tokens as number;
          completionTokens = msg.usage.output_tokens ?? 0;
        }
        // message_delta: { type: 'message_delta', usage: { output_tokens } }
        if (data.type === 'message_delta' && (data as any).usage?.output_tokens !== undefined) {
          completionTokens = (data as any).usage.output_tokens as number;
        }
      } else {
        // OpenAI: final chunk with stream_options.include_usage has top-level usage object
        const u = (data as any).usage;
        if (u?.prompt_tokens !== undefined) {
          promptTokens = u.prompt_tokens as number;
          completionTokens = u.completion_tokens ?? 0;
        }
      }
    } catch {
      // ignore malformed SSE lines
    }
  }

  return { prompt_tokens: promptTokens, completion_tokens: completionTokens };
}

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
