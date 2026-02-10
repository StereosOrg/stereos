#!/usr/bin/env npx tsx
/**
 * Generates OTLP JSON traces, logs, and metrics in the format
 * the Stereos API supports, with full LLM/gen_ai semantic conventions.
 *
 * Usage:
 *   npx tsx scripts/generate-otelp-sample.ts                     # print ~50 logs JSON to stdout
 *   npx tsx scripts/generate-otelp-sample.ts --count=20          # fewer logs/spans
 *   npx tsx scripts/generate-otelp-sample.ts --traces            # print traces JSON
 *   npx tsx scripts/generate-otelp-sample.ts --metrics           # print metrics JSON
 *   npx tsx scripts/generate-otelp-sample.ts --all               # print all three payloads
 *   npx tsx scripts/generate-otelp-sample.ts > sample-logs.json
 *   API_URL=... API_TOKEN=sk_xxx npx tsx scripts/generate-otelp-sample.ts --send-logs
 *   API_URL=... API_TOKEN=sk_xxx npx tsx scripts/generate-otelp-sample.ts --send-traces
 *   API_URL=... API_TOKEN=sk_xxx npx tsx scripts/generate-otelp-sample.ts --send-metrics
 *   API_URL=... API_TOKEN=sk_xxx npx tsx scripts/generate-otelp-sample.ts --send-all
 */

function attr(key: string, value: string | number | boolean): { key: string; value: { stringValue?: string; intValue?: string | number; boolValue?: boolean; doubleValue?: number } } {
  if (typeof value === 'string') return { key, value: { stringValue: value } };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { key, value: { intValue: value } };
    return { key, value: { doubleValue: value } };
  }
  return { key, value: { boolValue: value } };
}

function nano(ms: number): string {
  return String(BigInt(Math.floor(ms * 1_000_000)));
}

// 32 hex trace id, 16 hex span id
function hexTraceId(): string { return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
function hexSpanId(): string { return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }

const now = Date.now();

// --- Codex-style resource (IDE, non-LLM) — produces synthesized spans
const codexResource = {
  attributes: [
    attr('service.name', 'codex'),
    attr('process.executable.name', 'codex'),
    attr('sdk.name', 'codex-cli'),
  ],
};

// --- Anthropic/LLM resource
const anthropicResource = {
  attributes: [
    attr('service.name', 'anthropic'),
    attr('gen_ai.system', 'anthropic'),
    attr('sdk.name', 'opentelemetry'),
  ],
};

// --- OpenAI/LLM resource
const openaiResource = {
  attributes: [
    attr('service.name', 'openai'),
    attr('gen_ai.system', 'openai'),
    attr('sdk.name', 'opentelemetry'),
  ],
};

// --- Kilo Code / LLM resource (vendor-map: service.name or sdk.name includes 'kilo')
const kiloCodeResource = {
  attributes: [
    attr('service.name', 'kilo-code'),
    attr('gen_ai.system', 'kilo-code'),
    attr('sdk.name', 'kilo-code-otel'),
  ],
};

const severities = [1, 5, 9, 9, 9, 13, 17] as const; // TRACE, DEBUG, INFO..., WARN, ERROR
const severityNames = { 1: 'TRACE', 5: 'DEBUG', 9: 'INFO', 13: 'WARN', 17: 'ERROR', 21: 'FATAL' } as const;

const llmModels = [
  { model: 'claude-sonnet-4-20250514', vendor: 'anthropic' },
  { model: 'claude-opus-4-20250514', vendor: 'anthropic' },
  { model: 'gpt-4o', vendor: 'openai' },
  { model: 'gpt-4o-mini', vendor: 'openai' },
  { model: 'kilo-code-v1', vendor: 'kilo-code' },
  { model: 'kilo-code-agent', vendor: 'kilo-code' },
];

// ─── Traces ────────────────────────────────────────────────────────────────

type VendorKey = 'codex' | 'anthropic' | 'openai' | 'kilo-code';
const VENDOR_RESOURCES: Record<VendorKey, typeof codexResource> = {
  codex: codexResource,
  anthropic: anthropicResource,
  openai: openaiResource,
  'kilo-code': kiloCodeResource,
};

function buildSpans(count: number, options: { vendor: VendorKey }) {
  const { vendor } = options;
  const resource = VENDOR_RESOURCES[vendor];
  const isLLM = vendor !== 'codex';
  const spans: any[] = [];

  const operations = ['chat.completion', 'tool.call', 'agent.step', 'embed', 'run_command', 'read_file', 'edit_file', 'http.request'];
  const spanKinds = [1, 2, 3]; // INTERNAL, SERVER, CLIENT

  for (let i = 0; i < count; i++) {
    const traceId = hexTraceId();
    const rootSpanId = hexSpanId();
    const op = operations[i % operations.length];
    const durationMs = 50 + Math.floor(Math.random() * 2000);
    const startMs = now - (count - i) * 2000;
    const endMs = startMs + durationMs;
    const isError = i % 7 === 6; // ~14% error rate

    const rootAttributes: any[] = [
      attr('code.function', `do_${op}`),
    ];

    if (isLLM) {
      const vendorModels = llmModels.filter(m => m.vendor === vendor);
      const m = vendorModels[i % Math.max(1, vendorModels.length)];
      const inputTokens = 100 + Math.floor(Math.random() * 2000);
      const outputTokens = 50 + Math.floor(Math.random() * 800);
      rootAttributes.push(
        attr('gen_ai.request.model', m.model),
        attr('gen_ai.response.model', m.model),
        attr('gen_ai.usage.input_tokens', inputTokens),
        attr('gen_ai.usage.output_tokens', outputTokens),
      );
    }

    // Root span
    spans.push({
      traceId,
      spanId: rootSpanId,
      name: op,
      kind: spanKinds[i % spanKinds.length],
      startTimeUnixNano: nano(startMs),
      endTimeUnixNano: nano(endMs),
      status: isError ? { code: 2, message: `Error in ${op}` } : { code: 1 },
      attributes: rootAttributes,
    });

    // Child span (e.g. an HTTP call or LLM inner step)
    if (i % 2 === 0) {
      const childSpanId = hexSpanId();
      const childStart = startMs + 10;
      const childEnd = endMs - 10;
      const childAttrs: any[] = [attr('code.function', `${op}_inner`)];
      if (isLLM) {
        const childVendorModels = llmModels.filter(m => m.vendor === vendor);
        const m = childVendorModels[i % Math.max(1, childVendorModels.length)];
        childAttrs.push(
          attr('gen_ai.request.model', m.model),
          attr('gen_ai.response.model', m.model),
        );
      }
      spans.push({
        traceId,
        spanId: childSpanId,
        parentSpanId: rootSpanId,
        name: `${op}.inner`,
        kind: 3, // CLIENT
        startTimeUnixNano: nano(childStart),
        endTimeUnixNano: nano(childEnd),
        status: isError ? { code: 2, message: 'downstream error' } : { code: 1 },
        attributes: childAttrs,
      });
    }
  }

  return { resource, spans };
}

function buildTracesPayload(numSpans: number = 50) {
  const codexCount = Math.floor(numSpans * 0.25);
  const anthropicCount = Math.floor(numSpans * 0.35);
  const openaiCount = Math.floor(numSpans * 0.25);
  const kiloCount = numSpans - codexCount - anthropicCount - openaiCount;

  const codex = buildSpans(codexCount, { vendor: 'codex' });
  const anthropic = buildSpans(anthropicCount, { vendor: 'anthropic' });
  const openai = buildSpans(openaiCount, { vendor: 'openai' });
  const kiloCode = buildSpans(kiloCount, { vendor: 'kilo-code' });

  return {
    resourceSpans: [codex, anthropic, openai, kiloCode].map(b => ({
      resource: b.resource,
      scopeSpans: [{ scope: { name: 'stereos-otel', version: '0.1.0' }, spans: b.spans }],
    })),
  };
}

// ─── Logs ──────────────────────────────────────────────────────────────────

function buildLogRecords(count: number, options: { vendor: 'codex' | 'anthropic' | 'kilo-code'; traceId?: string; spanId?: string }) {
  const { vendor, traceId: rootTraceId, spanId: rootSpanId } = options;
  const resource = vendor === 'codex' ? codexResource : vendor === 'anthropic' ? anthropicResource : kiloCodeResource;
  const logRecords: any[] = [];
  let traceId = rootTraceId ?? hexTraceId();
  let spanId = rootSpanId ?? hexSpanId();

  const operations = ['run_command', 'read_file', 'edit_file', 'complete', 'chat.completion', 'tool.call', 'agent.step', 'http.request'];
  const names = ['run', 'read', 'edit', 'complete', 'invoke', 'call', 'step', 'request'];

  for (let i = 0; i < count; i++) {
    const severityNum = severities[i % severities.length];
    const op = operations[i % operations.length];
    const name = names[i % names.length];
    const timeNano = nano(now - (count - i) * 1000 + i * 50);

    const attributes: any[] = [
      attr('name', name),
      attr('operation', op),
      attr('code.function', `do_${op}`),
    ];
    if (vendor === 'anthropic') {
      attributes.push(
        attr('gen_ai.request.model', 'claude-sonnet-4-20250514'),
        attr('gen_ai.response.model', 'claude-sonnet-4-20250514'),
        attr('gen_ai.usage.input_tokens', 100 + i * 10),
        attr('gen_ai.usage.output_tokens', 50 + i * 5),
      );
    }
    if (vendor === 'kilo-code') {
      attributes.push(
        attr('gen_ai.request.model', 'kilo-code-v1'),
        attr('gen_ai.response.model', 'kilo-code-v1'),
        attr('gen_ai.usage.input_tokens', 80 + i * 8),
        attr('gen_ai.usage.output_tokens', 40 + i * 4),
      );
    }
    if (i % 4 === 0) attributes.push(attr('http.method', 'POST'));

    const body = vendor === 'codex'
      ? `Completed ${op} in 120ms`
      : vendor === 'kilo-code'
        ? `Kilo Code: ${op} (tokens: ${80 + i * 8} in, ${40 + i * 4} out)`
        : `Generated response for ${op} (tokens: ${100 + i * 10} in, ${50 + i * 5} out)`;

    logRecords.push({
      timeUnixNano: timeNano,
      severityNumber: severityNum,
      severityText: severityNames[severityNum],
      body: { stringValue: body },
      attributes,
      traceId: traceId,
      spanId: spanId,
    });
    // Next log in same trace can share or advance span
    if (i % 3 === 2) spanId = hexSpanId();
  }

  return {
    resource,
    scopeLogs: [{ scope: { name: 'codex-otel', version: '0.1.0' }, logRecords }],
    traceId,
    spanId,
  };
}

function buildLogsPayload(numLogs: number = 50) {
  const codexChunk = Math.floor(numLogs * 0.5);
  const anthropicChunk = Math.floor(numLogs * 0.3);
  const kiloChunk = numLogs - codexChunk - anthropicChunk;

  const codexBlock = buildLogRecords(codexChunk, { vendor: 'codex' });
  const anthropicBlock = buildLogRecords(anthropicChunk, { vendor: 'anthropic' });
  const kiloBlock = buildLogRecords(kiloChunk, { vendor: 'kilo-code' });

  return {
    resourceLogs: [
      { resource: codexBlock.resource, scopeLogs: codexBlock.scopeLogs },
      { resource: anthropicBlock.resource, scopeLogs: anthropicBlock.scopeLogs },
      { resource: kiloBlock.resource, scopeLogs: kiloBlock.scopeLogs },
    ],
  };
}

// ─── Metrics ───────────────────────────────────────────────────────────────

function buildMetricsPayload() {
  const nowMs = Date.now();
  const nowNano = nano(nowMs);
  const startNano = nano(nowMs - 60_000);

  const models = llmModels;

  // Build per-model datapoints for request count, error count, and tokens
  const requestCountPoints = models.map(m => ({
    attributes: [attr('gen_ai.request.model', m.model)],
    startTimeUnixNano: startNano,
    timeUnixNano: nowNano,
    asInt: String(50 + Math.floor(Math.random() * 200)),
  }));

  const errorCountPoints = models.map(m => ({
    attributes: [attr('gen_ai.request.model', m.model)],
    startTimeUnixNano: startNano,
    timeUnixNano: nowNano,
    asInt: String(Math.floor(Math.random() * 15)),
  }));

  const inputTokenPoints = models.map(m => ({
    attributes: [
      attr('gen_ai.request.model', m.model),
      attr('gen_ai.token.type', 'input'),
    ],
    startTimeUnixNano: startNano,
    timeUnixNano: nowNano,
    asInt: String(2000 + Math.floor(Math.random() * 8000)),
  }));

  const outputTokenPoints = models.map(m => ({
    attributes: [
      attr('gen_ai.request.model', m.model),
      attr('gen_ai.token.type', 'output'),
    ],
    startTimeUnixNano: startNano,
    timeUnixNano: nowNano,
    asInt: String(500 + Math.floor(Math.random() * 3000)),
  }));

  // Latency histogram per model (with bucketCounts + explicitBounds for p50/p95/p99)
  const latencyBounds = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  const latencyHistogramPoints = models.map(m => {
    const totalCount = 50 + Math.floor(Math.random() * 150);
    // Distribute counts across buckets (heavier in the middle)
    const bucketCounts = [2, 5, 10, 15, 8, 5, 3, 1, 1, 0].map(v => String(Math.round(v * totalCount / 50)));
    return {
      attributes: [attr('gen_ai.request.model', m.model)],
      startTimeUnixNano: startNano,
      timeUnixNano: nowNano,
      count: String(totalCount),
      sum: 120 * totalCount, // avg ~120ms
      bucketCounts,
      explicitBounds: latencyBounds,
      min: 8,
      max: 4800,
    };
  });

  return {
    resourceMetrics: [
      // Codex (non-LLM) resource metrics
      {
        resource: { attributes: codexResource.attributes },
        scopeMetrics: [
          {
            scope: { name: 'codex-metrics', version: '0.1.0' },
            metrics: [
              {
                name: 'codex.operations.total',
                description: 'Total operations executed',
                unit: '1',
                sum: {
                  dataPoints: [{
                    attributes: [],
                    startTimeUnixNano: startNano,
                    timeUnixNano: nowNano,
                    asInt: '142',
                  }],
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'codex.operation.duration_ms',
                description: 'Operation duration',
                unit: 'ms',
                gauge: {
                  dataPoints: [
                    { attributes: [attr('operation', 'run_command')], timeUnixNano: nowNano, asDouble: 120.5 },
                    { attributes: [attr('operation', 'read_file')], timeUnixNano: nowNano, asDouble: 8.2 },
                  ],
                },
              },
            ],
          },
        ],
      },
      // Anthropic LLM resource metrics
      {
        resource: { attributes: anthropicResource.attributes },
        scopeMetrics: [
          {
            scope: { name: 'gen-ai-metrics', version: '0.1.0' },
            metrics: [
              {
                name: 'gen_ai.requests.total',
                description: 'Total LLM requests',
                unit: '1',
                sum: {
                  dataPoints: requestCountPoints.filter((_, i) => models[i].vendor === 'anthropic'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.errors.total',
                description: 'Total LLM errors',
                unit: '1',
                sum: {
                  dataPoints: errorCountPoints.filter((_, i) => models[i].vendor === 'anthropic'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.usage.input_tokens',
                description: 'Input tokens consumed',
                unit: 'tokens',
                sum: {
                  dataPoints: inputTokenPoints.filter((_, i) => models[i].vendor === 'anthropic'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.usage.output_tokens',
                description: 'Output tokens consumed',
                unit: 'tokens',
                sum: {
                  dataPoints: outputTokenPoints.filter((_, i) => models[i].vendor === 'anthropic'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.response.duration',
                description: 'LLM response latency',
                unit: 'ms',
                histogram: {
                  dataPoints: latencyHistogramPoints.filter((_, i) => models[i].vendor === 'anthropic'),
                  aggregationTemporality: 2,
                },
              },
            ],
          },
        ],
      },
      // OpenAI LLM resource metrics
      {
        resource: { attributes: openaiResource.attributes },
        scopeMetrics: [
          {
            scope: { name: 'gen-ai-metrics', version: '0.1.0' },
            metrics: [
              {
                name: 'gen_ai.requests.total',
                description: 'Total LLM requests',
                unit: '1',
                sum: {
                  dataPoints: requestCountPoints.filter((_, i) => models[i].vendor === 'openai'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.errors.total',
                description: 'Total LLM errors',
                unit: '1',
                sum: {
                  dataPoints: errorCountPoints.filter((_, i) => models[i].vendor === 'openai'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.usage.input_tokens',
                description: 'Input tokens consumed',
                unit: 'tokens',
                sum: {
                  dataPoints: inputTokenPoints.filter((_, i) => models[i].vendor === 'openai'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.usage.output_tokens',
                description: 'Output tokens consumed',
                unit: 'tokens',
                sum: {
                  dataPoints: outputTokenPoints.filter((_, i) => models[i].vendor === 'openai'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.response.duration',
                description: 'LLM response latency',
                unit: 'ms',
                histogram: {
                  dataPoints: latencyHistogramPoints.filter((_, i) => models[i].vendor === 'openai'),
                  aggregationTemporality: 2,
                },
              },
            ],
          },
        ],
      },
      // Kilo Code LLM resource metrics
      {
        resource: { attributes: kiloCodeResource.attributes },
        scopeMetrics: [
          {
            scope: { name: 'gen-ai-metrics', version: '0.1.0' },
            metrics: [
              {
                name: 'gen_ai.requests.total',
                description: 'Total LLM requests',
                unit: '1',
                sum: {
                  dataPoints: requestCountPoints.filter((_, i) => models[i].vendor === 'kilo-code'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.errors.total',
                description: 'Total LLM errors',
                unit: '1',
                sum: {
                  dataPoints: errorCountPoints.filter((_, i) => models[i].vendor === 'kilo-code'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.usage.input_tokens',
                description: 'Input tokens consumed',
                unit: 'tokens',
                sum: {
                  dataPoints: inputTokenPoints.filter((_, i) => models[i].vendor === 'kilo-code'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.usage.output_tokens',
                description: 'Output tokens consumed',
                unit: 'tokens',
                sum: {
                  dataPoints: outputTokenPoints.filter((_, i) => models[i].vendor === 'kilo-code'),
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: 'gen_ai.response.duration',
                description: 'LLM response latency',
                unit: 'ms',
                histogram: {
                  dataPoints: latencyHistogramPoints.filter((_, i) => models[i].vendor === 'kilo-code'),
                  aggregationTemporality: 2,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

// ─── Send helpers ──────────────────────────────────────────────────────────

async function sendPayload(endpoint: string, payload: any, label: string) {
  const baseUrl = (process.env.API_URL || 'http://localhost:8787').replace(/\/$/, '');
  const url = `${baseUrl}${endpoint}`;
  const token = process.env.API_TOKEN;
  if (!token) {
    console.error(`Set API_TOKEN to send ${label}`);
    process.exit(1);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  console.error(`POST ${url} -> ${res.status}`);
  const text = await res.text();
  if (text) console.log(text);
  return res.ok;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50', 10) || 50;

  const sendAll = args.includes('--send-all');
  const sendLogs = sendAll || args.includes('--send-logs');
  const sendTraces = sendAll || args.includes('--send-traces');
  const sendMetrics = sendAll || args.includes('--send-metrics');
  const isSending = sendLogs || sendTraces || sendMetrics;

  if (isSending) {
    const results: boolean[] = [];
    if (sendTraces) results.push(await sendPayload('/v1/traces', buildTracesPayload(count), 'traces'));
    if (sendLogs) results.push(await sendPayload('/v1/logs', buildLogsPayload(count), 'logs'));
    if (sendMetrics) results.push(await sendPayload('/v1/metrics', buildMetricsPayload(), 'metrics'));
    process.exit(results.every(Boolean) ? 0 : 1);
  }

  // Print mode
  const printAll = args.includes('--all');
  if (printAll) {
    console.log(JSON.stringify({
      traces: buildTracesPayload(count),
      logs: buildLogsPayload(count),
      metrics: buildMetricsPayload(),
    }, null, 2));
  } else if (args.includes('--traces')) {
    console.log(JSON.stringify(buildTracesPayload(count), null, 2));
  } else if (args.includes('--metrics')) {
    console.log(JSON.stringify(buildMetricsPayload(), null, 2));
  } else {
    console.log(JSON.stringify(buildLogsPayload(count), null, 2));
  }
}

main();
