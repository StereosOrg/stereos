/**
 * Forward proxy for OpenAI-compatible chat completions with GenAI span tracking.
 * Requires: Authorization: Bearer <platform_token>, X-Provider-Key: <provider_api_key>
 * Optional: X-Provider: <provider_id> (default "openai") — selects which provider config (base URL + auth headers) to use.
 */

import { Hono } from 'hono';
import { toolProfiles, telemetrySpans } from '@stereos/shared/schema';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../lib/api-token.js';
import type { ApiTokenPayload } from '../lib/api-token.js';
import { trackTelemetryEventsUsage, trackToolProfilesUsage } from '../lib/stripe.js';
import type { AppVariables } from '../types/app.js';
import type { Database } from '@stereos/shared/db';

const router = new Hono<{ Variables: AppVariables }>();

const MAX_DIFF_ATTR_SIZE = 100_000; // cap tool.output.diff to avoid huge spans

/** Per-provider config: base URL and how to turn X-Provider-Key into upstream headers. */
export type ProviderConfig = {
  /** Base URL (e.g. https://api.openai.com). Request URL = baseUrl + pathSuffix. */
  baseUrl: string;
  /** Path appended to baseUrl (default /v1/chat/completions). */
  pathSuffix: string;
  /** Returns headers to send to the upstream (e.g. Authorization, api-key). */
  getHeaders: (providerKey: string) => Record<string, string>;
  /** For TelemetrySpan / ToolProfile (e.g. openai, azure-openai). */
  vendorSlug: string;
  /** Display name for tool profile (e.g. "OpenAI", "Azure OpenAI"). */
  displayName: string;
};

/** JSON shape for one provider when using OPENAI_COMPAT_PROVIDERS env. */
export type ProviderConfigJson = {
  id: string;
  baseUrl: string;
  pathSuffix?: string;
  /** Header name for auth (e.g. "Authorization", "api-key"). */
  authHeader: string;
  /** If "Bearer", value is "Bearer <key>"; otherwise raw key. */
  authScheme?: string | null;
  vendorSlug: string;
  displayName: string;
};

const CHAT_PATH_DEFAULT = '/v1/chat/completions';

function buildProviderConfig(raw: ProviderConfigJson): ProviderConfig {
  const pathSuffix = raw.pathSuffix ?? CHAT_PATH_DEFAULT;
  const scheme = raw.authScheme?.trim() || null;
  return {
    baseUrl: raw.baseUrl.replace(/\/$/, ''),
    pathSuffix: pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`,
    getHeaders: (key) => {
      const value = scheme ? `${scheme} ${key}` : key;
      return { [raw.authHeader]: value };
    },
    vendorSlug: raw.vendorSlug,
    displayName: raw.displayName,
  };
}

/** Load provider map from OPENAI_COMPAT_PROVIDERS (JSON array). If unset, use built-in openai + azure-openai. */
function loadProviderMap(): Record<string, ProviderConfig> {
  const raw = process.env.OPENAI_COMPAT_PROVIDERS;
  if (raw?.trim()) {
    try {
      const arr = JSON.parse(raw) as ProviderConfigJson[];
      if (!Array.isArray(arr)) return getBuiltInProviderMap();
      const map: Record<string, ProviderConfig> = {};
      for (const p of arr) {
        if (p?.id && p?.baseUrl && p?.authHeader && p?.vendorSlug && p?.displayName) {
          map[p.id.trim().toLowerCase()] = buildProviderConfig(p);
        }
      }
      if (Object.keys(map).length > 0) return map;
    } catch {
      // invalid JSON → fallback
    }
  }
  return getBuiltInProviderMap();
}

function getBuiltInProviderMap(): Record<string, ProviderConfig> {
  return {
    openai: {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
      pathSuffix: '/v1/chat/completions',
      getHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
      vendorSlug: 'openai',
      displayName: 'OpenAI',
    },
    'azure-openai': {
      baseUrl: process.env.AZURE_OPENAI_BASE_URL || '',
      pathSuffix: '/chat/completions?api-version=2024-02-15-preview',
      getHeaders: (key) => ({ 'api-key': key }),
      vendorSlug: 'azure-openai',
      displayName: 'Azure OpenAI',
    },
    'lm-studio': {
      baseUrl: process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234',
      pathSuffix: '/v1/chat/completions',
      getHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
      vendorSlug: 'lm-studio',
      displayName: 'LM Studio',
    },
    'vercel-ai-gateway': {
      baseUrl: process.env.VERCEL_AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh/v1',
      pathSuffix: '/chat/completions',
      getHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
      vendorSlug: 'vercel-ai-gateway',
      displayName: 'Vercel AI Gateway',
    },
    openrouter: {
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      pathSuffix: '/chat/completions',
      getHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
      vendorSlug: 'openrouter',
      displayName: 'OpenRouter',
    },
  };
}

/** Map of provider id (X-Provider header) → config. Loaded from OPENAI_COMPAT_PROVIDERS or built-in defaults. */
export const PROVIDER_MAP: Record<string, ProviderConfig> = loadProviderMap();
const DEFAULT_PROVIDER = 'openai';

/** Generate 32-char hex trace_id (OTEL style). */
function newTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generate 16-char hex span_id (OTEL style). */
function newSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Resolve X-Provider to config; return null if missing/invalid. */
function getProviderConfig(c: any): { config: ProviderConfig; providerId: string } | null {
  const id = (c.req.header('X-Provider') ?? DEFAULT_PROVIDER).trim().toLowerCase() || DEFAULT_PROVIDER;
  const config = PROVIDER_MAP[id];
  if (!config) return null;
  return { config, providerId: id };
}

// OpenAI request/response types (minimal for our use)
interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  [key: string]: unknown;
}

interface ChatChoice {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  };
  delta?: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string;
  index?: number;
}

interface ChatResponse {
  id?: string;
  choices?: ChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
}

/** Build span_attributes for GenAI spans (flat string record for DB). */
function spanAttrs(attrs: Record<string, string | number | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

/** Truncate large string for span attribute (e.g. tool.output.diff). */
function truncateForAttr(s: string, max = MAX_DIFF_ATTR_SIZE): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... [truncated ${s.length - max} chars]`;
}

/**
 * Persist GenAI spans for one chat completion to the DB.
 */
async function persistGenAISpans(
  db: Database,
  customerId: string,
  userId: string | null,
  teamId: string | null,
  toolProfileId: string,
  traceId: string,
  requestSpanId: string,
  requestBody: ChatRequest,
  responseBody: ChatResponse | null,
  startTime: Date,
  endTime: Date,
  isError: boolean,
  vendorSlug: string,
  stripeKey?: string
): Promise<void> {
  const model = requestBody.model || responseBody?.model || 'unknown';
  const resourceAttrs = {
    'service.name': 'stereos-chat-proxy',
    'gen_ai.system': vendorSlug,
  };
  const durationMs = endTime.getTime() - startTime.getTime();

  // 1. gen_ai.request
  const lastUserContent = requestBody.messages
    ?.filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
    .join('\n');
  const requestAttrs = spanAttrs({
    'gen_ai.request.model': model,
    'gen_ai.system': vendorSlug,
    ...(teamId && { 'team.id': teamId }),
    ...(userId && { 'user.id': userId }),
    prompt: lastUserContent ? truncateForAttr(lastUserContent, 50_000) : undefined,
    temperature: requestBody.temperature ?? undefined,
  });

  const requestRow = {
    customer_id: customerId,
    user_id: userId,
    team_id: teamId,
    tool_profile_id: toolProfileId,
    trace_id: traceId,
    span_id: requestSpanId,
    parent_span_id: null,
    span_name: 'gen_ai.request',
    span_kind: 'CLIENT',
    start_time: startTime,
    end_time: endTime,
    duration_ms: durationMs,
    status_code: isError ? 'ERROR' : 'OK',
    status_message: isError ? (responseBody as unknown as { error?: { message?: string } })?.error?.message ?? null : null,
    vendor: vendorSlug,
    service_name: 'stereos-chat-proxy',
    resource_attributes: resourceAttrs,
    span_attributes: requestAttrs,
    signal_type: 'trace',
  };

  const baseRow = {
    ...requestRow,
    tool_profile_id: toolProfileId,
  };
  const rows: Array<typeof telemetrySpans.$inferInsert> = [{ ...baseRow }];

  // 2. gen_ai.response
  if (responseBody?.choices?.[0]) {
    const choice = responseBody.choices[0];
    const msg = choice.message ?? choice.delta;
    const content = msg?.content ?? null;
    const usage = responseBody.usage;
    const responseSpanId = newSpanId();
    const responseAttrs = spanAttrs({
      'gen_ai.response.model': responseBody.model || model,
      'gen_ai.system': vendorSlug,
      ...(teamId && { 'team.id': teamId }),
      ...(userId && { 'user.id': userId }),
      ...(content != null && { 'gen_ai.response.content': truncateForAttr(String(content), 50_000) }),
      ...(usage && { 'gen_ai.usage.input_tokens': usage.prompt_tokens }),
      ...(usage && { 'gen_ai.usage.output_tokens': usage.completion_tokens }),
    });
    rows.push({
      ...baseRow,
      span_id: responseSpanId,
      parent_span_id: requestSpanId,
      span_name: 'gen_ai.response',
      span_attributes: responseAttrs,
    });

    // 3. gen_ai.tool_call (from response message tool_calls)
    const toolCalls = msg?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const name = tc.function?.name ?? 'unknown';
        const args = tc.function?.arguments ?? '{}';
        const tcSpanId = newSpanId();
        rows.push({
          ...baseRow,
          span_id: tcSpanId,
          parent_span_id: requestSpanId,
          span_name: 'gen_ai.tool_call',
          span_attributes: spanAttrs({
            'gen_ai.system': vendorSlug,
            ...(teamId && { 'team.id': teamId }),
            ...(userId && { 'user.id': userId }),
            'tool.name': name,
            'tool.arguments': truncateForAttr(args, 20_000),
          }),
        });
      }
    }
  }

  // 4. gen_ai.tool_result (from request messages with role 'tool') — OTEL: tool.output.diff (full diff blob)
  const toolMessages = requestBody.messages?.filter((m) => m.role === 'tool') ?? [];
  for (const tm of toolMessages) {
    const content = typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content ?? '');
    const trSpanId = newSpanId();
    rows.push({
      ...baseRow,
      span_id: trSpanId,
      parent_span_id: requestSpanId,
      span_name: 'gen_ai.tool_result',
      span_attributes: spanAttrs({
        'gen_ai.system': vendorSlug,
        ...(teamId && { 'team.id': teamId }),
        ...(userId && { 'user.id': userId }),
        ...(tm.tool_call_id && { 'tool.call_id': tm.tool_call_id }),
        ...(tm.name && { 'tool.name': tm.name }),
        ...(content.length > 0 && { 'tool.output.diff': truncateForAttr(content) }),
      }),
    });
  }

  await db.insert(telemetrySpans).values(rows);
  await db
    .update(toolProfiles)
    .set({
      total_spans: sql`"ToolProfile"."total_spans" + ${rows.length}`,
      total_traces: sql`"ToolProfile"."total_traces" + 1`,
      last_seen_at: endTime,
      updated_at: endTime,
    })
    .where(eq(toolProfiles.id, toolProfileId));

  if (stripeKey) {
    await trackTelemetryEventsUsage(db, customerId, rows.length, { trace_count: 1 }, stripeKey);
  }
}

/**
 * Upsert tool profile for the given vendor and return profile id. Tracks new profile for billing.
 */
async function ensureProviderProfile(
  db: Database,
  customerId: string,
  vendorSlug: string,
  displayName: string,
  stripeKey?: string
): Promise<string> {
  const existing = await db.query.toolProfiles.findFirst({
    where: and(eq(toolProfiles.customer_id, customerId), eq(toolProfiles.vendor, vendorSlug)),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const now = new Date();
  const [profile] = await db
    .insert(toolProfiles)
    .values({
      customer_id: customerId,
      vendor: vendorSlug,
      display_name: displayName,
      vendor_category: 'llm',
      total_spans: 0,
      total_traces: 0,
      total_errors: 0,
      first_seen_at: now,
      last_seen_at: now,
    })
    .onConflictDoUpdate({
      target: [toolProfiles.customer_id, toolProfiles.vendor],
      set: { last_seen_at: now, updated_at: now },
    })
    .returning({ id: toolProfiles.id });

  if (stripeKey) {
    await trackToolProfilesUsage(db, customerId, 1, { tool_profile_id: profile.id }, stripeKey);
  }
  return profile.id;
}

// POST /v1/chat/completions — proxy to OpenAI and record GenAI spans
router.post('/chat/completions', authMiddleware, async (c) => {
  try {
    return await handleChatCompletions(c);
  } catch (err) {
    console.error('[chat-completions] handler error', err);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: { message: `Internal error: ${message}` } }, 500);
  }
});

async function handleChatCompletions(c: any) {
  const apiToken = c.get('apiToken') as ApiTokenPayload;
  const db = c.get('db');
  const customerId = apiToken.customer.id;
  const userId = apiToken.user_id ?? apiToken.customer?.user_id ?? null;
  const teamId = apiToken.team_id ?? null;
  const stripeKey = (c as { env?: { STRIPE_SECRET_KEY?: string } }).env?.STRIPE_SECRET_KEY;

  const resolved = getProviderConfig(c);
  if (!resolved) {
    const supported = Object.keys(PROVIDER_MAP).join(', ');
    return c.json(
      { error: { message: `Unknown or missing X-Provider. Supported: ${supported}. Use X-Provider header.` } },
      400
    );
  }
  const { config, providerId } = resolved;
  const providerKey = c.req.header('X-Provider-Key')?.trim();
  if (!providerKey) {
    return c.json({ error: 'Missing X-Provider-Key header (provider API key)' }, 401);
  }
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const pathSuffix = config.pathSuffix.startsWith('/') ? config.pathSuffix : `/${config.pathSuffix}`;
  const url = `${baseUrl}${pathSuffix}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.getHeaders(providerKey),
  };
  let body: ChatRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const stream = body.stream === true;
  const startTime = new Date();
  const traceId = newTraceId();
  const requestSpanId = newSpanId();

  try {
    const upstreamRes = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const contentType = upstreamRes.headers.get('Content-Type') ?? '';

    if (!upstreamRes.ok) {
      const errBody = await upstreamRes.text();
      let errJson: ChatResponse | null = null;
      try {
        errJson = JSON.parse(errBody) as ChatResponse;
      } catch {
        // ignore
      }
      console.warn('[chat-completions] upstream error', upstreamRes.status, errBody.slice(0, 500));
      const endTime = new Date();
      const profileId = await ensureProviderProfile(db, customerId, config.vendorSlug, config.displayName, stripeKey);
      await persistGenAISpans(
        db,
        customerId,
        userId,
        teamId,
        profileId,
        traceId,
        requestSpanId,
        body,
        errJson,
        startTime,
        endTime,
        true,
        config.vendorSlug,
        stripeKey
      );
      return c.json(
        errJson ?? { error: { message: errBody || upstreamRes.statusText } },
        upstreamRes.status as 400
      );
    }

    if (stream && contentType.includes('text/event-stream')) {
      // Stream: forward to client and collect final state for telemetry (best-effort)
      const profileId = await ensureProviderProfile(db, customerId, config.vendorSlug, config.displayName, stripeKey);
      let accumulatedContent = '';
      const toolCallsAcc: ChatChoice['message'] = { role: 'assistant', content: '', tool_calls: [] };
      let usage: ChatResponse['usage'];
      const decoder = new TextDecoder();
      let buffer = '';

      const streamBody = new ReadableStream({
        async start(controller) {
          const reader = upstreamRes.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data) as { choices?: ChatChoice[]; usage?: ChatResponse['usage'] };
                  if (parsed.usage) usage = parsed.usage;
                  const choice = parsed.choices?.[0];
                  if (choice?.delta) {
                    if (choice.delta.content) accumulatedContent += choice.delta.content;
                    if (choice.delta.tool_calls?.length) {
                      for (const tc of choice.delta.tool_calls) {
                        const i = tc.index ?? toolCallsAcc.tool_calls!.length;
                        if (!toolCallsAcc.tool_calls![i]) {
                          toolCallsAcc.tool_calls![i] = { id: tc.id ?? '', type: tc.type ?? 'function', function: { name: '', arguments: '' } };
                        }
                        if (tc.function?.name) toolCallsAcc.tool_calls![i].function.name += tc.function.name;
                        if (tc.function?.arguments) toolCallsAcc.tool_calls![i].function.arguments += tc.function.arguments;
                      }
                    }
                  }
                } catch {
                  // ignore parse errors for SSE
                }
              }
            }
            controller.close();

            const endTime = new Date();
            const syntheticResponse: ChatResponse = {
              choices: [{ message: { ...toolCallsAcc, content: accumulatedContent || null } }],
              usage: usage ?? undefined,
              model: body.model,
            };
            await persistGenAISpans(
              db,
              customerId,
              userId,
              teamId,
              profileId,
              traceId,
              requestSpanId,
              body,
              syntheticResponse,
              startTime,
              endTime,
              false,
              config.vendorSlug,
              stripeKey
            );
          } catch (err) {
            console.error('[chat-completions] stream error', err);
            const endTime = new Date();
            await persistGenAISpans(db, customerId, userId, teamId, profileId, traceId, requestSpanId, body, null, startTime, endTime, true, config.vendorSlug, stripeKey);
          }
        },
      });

      return new Response(streamBody, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Non-streaming
    const responseJson = (await upstreamRes.json()) as ChatResponse;
    const endTime = new Date();
    const profileId = await ensureProviderProfile(db, customerId, config.vendorSlug, config.displayName, stripeKey);
    await persistGenAISpans(
      db,
      customerId,
      userId,
      teamId,
      profileId,
      traceId,
      requestSpanId,
      body,
      responseJson,
      startTime,
      endTime,
      false,
      config.vendorSlug,
      stripeKey
    );
    return c.json(responseJson, 200);
  } catch (err) {
    const endTime = new Date();
    const message = err instanceof Error ? err.message : String(err);
    try {
      const profileId = await ensureProviderProfile(db, customerId, config.vendorSlug, config.displayName, stripeKey);
      await persistGenAISpans(db, customerId, userId, teamId, profileId, traceId, requestSpanId, body, null, startTime, endTime, true, config.vendorSlug, stripeKey);
    } catch (persistErr) {
      console.error('[chat-completions] persist error on upstream failure', persistErr);
    }
    return c.json({ error: { message: `Upstream request failed: ${message}` } }, 502);
  }
}

export default router;
