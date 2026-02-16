import { Hono } from 'hono';
import { db } from '@stereos/shared/db';
import { aiGatewayKeys } from '@stereos/shared/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { checkBudget } from './ai-keys.js';
import { ingestOtelSpans } from '../lib/telemetry-ingest.js';


const router = new Hono();

// Extract virtual key from Authorization header
function extractApiKey(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

// Hash key for lookup
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// Main proxy endpoint
router.all('/ai/chat/completions', async (c) => {
  const startTime = Date.now();
  const authHeader = c.req.header('Authorization');
  const apiKey = extractApiKey(authHeader);

  if (!apiKey) {
    return c.json({ error: 'Authorization required', code: 'unauthorized' }, 401);
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
    const body = await c.req.json().catch(() => ({}));
    const requestedModel = body.model;

    if (!requestedModel) {
      return c.json({ error: 'Model is required', code: 'model_required' }, 400);
    }

    // 5. Check model allow-list
    if (key.allowed_models && key.allowed_models.length > 0) {
      if (!key.allowed_models.includes(requestedModel)) {
        return c.json({
          error: `Model "${requestedModel}" not allowed for this key`,
          code: 'model_not_allowed',
          allowed_models: key.allowed_models
        }, 403);
      }
    }

    // 6. Get Cloudflare gateway info
    const cfAccountId = process.env.CF_ACCOUNT_ID;
    const cfApiToken = process.env.CF_AI_GATEWAY_API_TOKEN;
    const cfGatewayId = key.customer?.cf_gateway_id;

    if (!cfAccountId || !cfApiToken || !cfGatewayId) {
      return c.json({ error: 'AI Gateway not configured', code: 'gateway_not_configured' }, 503);
    }

    // 7. Forward request to Cloudflare AI Gateway (BYOK)
    const provider = inferProvider(requestedModel);
    const cfUrl = `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${cfGatewayId}/${provider}/chat/completions`;

    const providerKey = c.req.header('X-Provider-Key');
    if (!providerKey) {
      return c.json({ error: 'X-Provider-Key header required (BYOK)', code: 'provider_key_required' }, 400);
    }

    const cfResponse = await fetch(cfUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-authorization': `Bearer ${cfApiToken}`,
        'Authorization': `Bearer ${providerKey}`,
      },
      body: JSON.stringify(body),
    });

    const responseBody = await cfResponse.json() as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // 8. Extract token usage for telemetry
    const promptTokens = responseBody.usage?.prompt_tokens || 0;
    const completionTokens = responseBody.usage?.completion_tokens || 0;

    // 9. Emit telemetry span (non-blocking)
    emitTelemetrySpan({
      db,
      customerId: key.customer_id,
      userId: key.user_id,
      teamId: key.team_id,
      model: requestedModel,
      provider,
      promptTokens,
      completionTokens,
      durationMs,
      startTime,
      endTime,
      responseOk: cfResponse.ok,
    }).catch(console.error);

    // 10. Return response to client
    return c.json(responseBody, cfResponse.status as any);

  } catch (error) {
    console.error('AI Proxy error:', error);
    return c.json({
      error: 'Internal server error',
      code: 'internal_error'
    }, 500);
  }
});

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
