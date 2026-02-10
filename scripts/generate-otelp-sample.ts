#!/usr/bin/env npx tsx
/**
 * Generates ~50 OTLP JSON log records (and optional metrics) in the format
 * the Stereos API supports, Codex-style (service names, gen_ai.*, trace/span).
 *
 * Usage:
 *   npx tsx scripts/generate-otelp-sample.ts                     # print ~50 logs JSON to stdout
 *   npx tsx scripts/generate-otelp-sample.ts --count=20          # fewer logs
 *   npx tsx scripts/generate-otelp-sample.ts --metrics           # print metrics JSON instead
 *   npx tsx scripts/generate-otelp-sample.ts > sample-logs.json
 *   API_URL=... API_TOKEN=sk_xxx npx tsx scripts/generate-otelp-sample.ts --send-logs
 *   API_URL=... API_TOKEN=sk_xxx npx tsx scripts/generate-otelp-sample.ts --send-metrics
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
const baseTimeNano = nano(now);

// --- Codex-style resource (IDE, non-LLM) — produces synthesized spans
const codexResource = {
  attributes: [
    attr('service.name', 'codex'),
    attr('process.executable.name', 'codex'),
    attr('sdk.name', 'codex-cli'),
  ],
};

// --- Anthropic/LLM resource — no synthesized spans, but logs + error counts
const anthropicResource = {
  attributes: [
    attr('service.name', 'anthropic'),
    attr('gen_ai.system', 'anthropic'),
    attr('sdk.name', 'opentelemetry'),
  ],
};

const severities = [1, 5, 9, 9, 9, 13, 17] as const; // TRACE, DEBUG, INFO..., WARN, ERROR
const severityNames = { 1: 'TRACE', 5: 'DEBUG', 9: 'INFO', 13: 'WARN', 17: 'ERROR', 21: 'FATAL' } as const;

function buildLogRecords(count: number, options: { vendor: 'codex' | 'anthropic'; traceId?: string; spanId?: string }) {
  const { vendor, traceId: rootTraceId, spanId: rootSpanId } = options;
  const resource = vendor === 'codex' ? codexResource : anthropicResource;
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
    if (i % 4 === 0) attributes.push(attr('http.method', 'POST'));

    const body = vendor === 'codex'
      ? `Completed ${op} in 120ms`
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
  const codexChunk = Math.floor(numLogs * 0.6);
  const anthropicChunk = numLogs - codexChunk;

  const codexBlock = buildLogRecords(codexChunk, { vendor: 'codex' });
  const anthropicBlock = buildLogRecords(anthropicChunk, { vendor: 'anthropic' });

  return {
    resourceLogs: [
      {
        resource: codexBlock.resource,
        scopeLogs: codexBlock.scopeLogs,
      },
      {
        resource: anthropicBlock.resource,
        scopeLogs: anthropicBlock.scopeLogs,
      },
    ],
  };
}

function buildMetricsPayload() {
  const nowMs = Date.now();
  const nowNano = nano(nowMs);
  const startNano = nano(nowMs - 5000);

  return {
    resourceMetrics: [
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
                  dataPoints: [
                    {
                      attributes: [],
                      startTimeUnixNano: startNano,
                      timeUnixNano: nowNano,
                      asInt: '142',
                    },
                  ],
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
              {
                name: 'llm.tokens.consumed',
                description: 'Tokens consumed',
                unit: '1',
                sum: {
                  dataPoints: [
                    {
                      attributes: [
                        attr('gen_ai.request.model', 'claude-sonnet-4-20250514'),
                        attr('gen_ai.usage.type', 'input'),
                      ],
                      startTimeUnixNano: startNano,
                      timeUnixNano: nowNano,
                      asInt: '4500',
                    },
                    {
                      attributes: [
                        attr('gen_ai.request.model', 'claude-sonnet-4-20250514'),
                        attr('gen_ai.usage.type', 'output'),
                      ],
                      startTimeUnixNano: startNano,
                      timeUnixNano: nowNano,
                      asInt: '1200',
                    },
                  ],
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const sendLogs = args.includes('--send-logs');
  const sendMetrics = args.includes('--send-metrics');
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50', 10) || 50;

  if (sendLogs) {
    const url = process.env.API_URL || 'http://localhost:8787/v1/logs';
    const token = process.env.API_TOKEN;
    if (!token) {
      console.error('Set API_TOKEN to send logs');
      process.exit(1);
    }
    const payload = buildLogsPayload(count);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    console.error(`POST ${url} -> ${res.status}`);
    const text = await res.text();
    if (text) console.log(text);
    process.exit(res.ok ? 0 : 1);
  }

  if (sendMetrics) {
    const url = process.env.API_URL || 'http://localhost:8787/v1/metrics';
    const token = process.env.API_TOKEN;
    if (!token) {
      console.error('Set API_TOKEN to send metrics');
      process.exit(1);
    }
    const payload = buildMetricsPayload();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    console.error(`POST ${url} -> ${res.status}`);
    const text = await res.text();
    if (text) console.log(text);
    process.exit(res.ok ? 0 : 1);
  }

  // Default: output logs JSON. Use --metrics to output metrics payload instead.
  if (args.includes('--metrics')) {
    console.log(JSON.stringify(buildMetricsPayload(), null, 2));
  } else {
    console.log(JSON.stringify(buildLogsPayload(count), null, 2));
  }
}

main();
