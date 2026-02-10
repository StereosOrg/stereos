# Telemetry documentation plan for www.trystereos.com

## 1. Site structure and UX

### 1.1 Top-level navigation
- **Tab toggle**: Two main audiences
  - **Providers** – Integrators (SDKs, exporters, agents) sending data to the API
  - **End-users** – People viewing the Stereos dashboard and tool profiles
- **Scroll navigation** (sidebar or in-page): Anchor links to each major section so both tabs can share a single long page or each tab has its own scroll-nav.

### 1.2 Recommended layout
- **Option A**: One page with two top tabs; each tab shows a different column/section with shared scroll TOC (e.g. “For providers” | “For end-users”).
- **Option B**: Two routes (e.g. `/docs/providers`, `/docs/end-users`) with a shared nav component and per-page scroll TOC.
- **Scroll TOC** for Providers: Quick links to Auth, POST /v1/traces, POST /v1/logs, POST /v1/metrics, Schema reference, Instrumentation checklist.
- **Scroll TOC** for End-users: Quick links to Dashboard, Events, Tool profiles, Metrics tab, Logs tab, What each field means.

---

## 2. Providers documentation

### 2.1 Overview (Providers)
- **Base URL**: `https://api.trystereos.com` (or customer’s API host).
- **Authentication**: All three endpoints require `Authorization: Bearer <API_TOKEN>` (workspace API key from Settings → API keys). No session/cookie auth for ingestion.
- **Content-Type**: `application/json` only. Binary protobuf is not supported; OTLP exporters must use JSON encoding.
- **Preflight**: Endpoints respond to `HEAD`/`OPTIONS` with 200 for observability pipelines (e.g. Cloudflare).

### 2.2 POST /v1/traces

**Purpose**: Ingest OTLP trace/span data. Drives tool profiles, event feed, and (for LLM spans) token/latency/error stats.

**Request**
- **Method**: POST  
- **Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`  
- **Body**: OTLP JSON with root key `resourceSpans` (array).

**Schema (minimal)**

```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "my-service" } },
          { "key": "gen_ai.system", "value": { "stringValue": "openai" } }
        ]
      },
      "scopeSpans": [
        {
          "spans": [
            {
              "traceId": "32-char-hex",
              "spanId": "16-char-hex",
              "parentSpanId": "16-char-hex or omit",
              "name": "span name",
              "kind": 1,
              "startTimeUnixNano": "1234567890000000000",
              "endTimeUnixNano": "1234567891000000000",
              "status": { "code": 1, "message": "optional" },
              "attributes": []
            }
          ]
        }
      ]
    }
  ]
}
```

**Fields we use (and where they appear in the UI)**

| Source | Field / convention | UI / behavior |
|--------|--------------------|----------------|
| **Resource attributes** | `service.name` | Vendor fallback; tool profile display name when no vendor matcher. |
| | `gen_ai.system` | LLM vendor detection (e.g. `openai`, `anthropic`, `gemini`). |
| | `gen_ai.request.model` | Model name in events and LLM stats. |
| | `gen_ai.response.model` | Model name fallback. |
| | `process.executable.name`, `sdk.name` | Vendor matchers (e.g. Cursor, Codex). |
| **Span** | `traceId`, `spanId`, `parentSpanId` | Trace structure; required. |
| | `name` | **Events feed**: shown as “intent” / operation name. |
| | `startTimeUnixNano`, `endTimeUnixNano` | **Tool profile**: duration_ms; timeline; latency percentiles. |
| | `status.code` (1=OK, 2=ERROR) | **Tool profile**: error counts; status in spans. |
| | `attributes` | See span attributes below. |
| **Span attributes** | `gen_ai.request.model` | **Events**: “model” pill. **Tool profile**: model breakdown, totals. |
| | `gen_ai.response.model` | Same as above (fallback). |
| | `gen_ai.usage.input_tokens` (int) | **Tool profile**: Total LLM tokens, daily/hourly charts, cost, per-model. |
| | `gen_ai.usage.output_tokens` (int) | Same. |

**Vendor detection (resource + span)**  
Vendor is derived from resource attributes (and span attributes when needed). Recognized via: `service.name`, `gen_ai.system`, `gen_ai.request.model`, `process.executable.name`, `sdk.name`. Unknown services become a slug from `service.name`. LLM tools are detected by `gen_ai.system` or `gen_ai.request.model` / `gen_ai.response.model`.

**Instrumentation checklist (traces)**
- [ ] Send `resourceSpans` with at least one span per request.
- [ ] Set `resource.attributes`: `service.name`; for LLM, add `gen_ai.system` and/or model in attributes.
- [ ] Set span `name` (used as “intent” in events).
- [ ] Set `startTimeUnixNano` and `endTimeUnixNano` (duration is computed).
- [ ] Set `status.code` to 2 for errors (so error counts are correct).
- [ ] For LLM: set span attributes `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` (integers) so token and cost UI are correct.
- [ ] For LLM: set `gen_ai.request.model` or `gen_ai.response.model` so model breakdown and “model” in events work.

---

### 2.3 POST /v1/logs

**Purpose**: Ingest OTLP log records. Stored as logs; non-LLM logs with trace/span context can generate synthesized spans for the event feed and tool profile.

**Request**
- **Method**: POST  
- **Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`  
- **Body**: OTLP JSON with root key `resourceLogs` (or `resource_logs`).

**Schema (minimal)**

```json
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "my-service" } }
        ]
      },
      "scopeLogs": [
        {
          "logRecords": [
            {
              "timeUnixNano": "1234567890000000000",
              "severityNumber": 9,
              "severityText": "INFO",
              "body": { "stringValue": "message" },
              "attributes": [],
              "traceId": "optional-32-hex",
              "spanId": "optional-16-hex"
            }
          ]
        }
      ]
    }
  ]
}
```

**Fields we use (and where they appear in the UI)**

| Source | Field / convention | UI / behavior |
|--------|--------------------|----------------|
| **Resource attributes** | Same as traces (service.name, gen_ai.system, etc.) | Vendor and tool profile. |
| **Log record** | `timeUnixNano` | **Logs tab**: timestamp. |
| | `severityNumber` (1=TRACE, 5=DEBUG, 9=INFO, 13=WARN, 17=ERROR, 21=FATAL) | **Logs tab**: severity. |
| | `body` (stringValue or string) | **Logs tab**: log body. |
| | `attributes` | **Logs tab**: log attributes; can drive span name for synthesized span. |
| | `traceId`, `spanId` | If both present and not LLM: **synthesized span** → events feed and tool profile. |
| **Log attributes** | `name`, `operation`, `http.method` | Used as synthesized span name. |

**Instrumentation checklist (logs)**
- [ ] Send `resourceLogs` with at least one `logRecords` entry.
- [ ] Set `resource.attributes` (e.g. `service.name`, `gen_ai.system` for LLM).
- [ ] Set `timeUnixNano`, `severityNumber` or `severityText`, and `body`.
- [ ] For correlation with traces: set `traceId` and `spanId` so we can synthesize spans (non-LLM only).
- [ ] Optionally set `attributes` (e.g. `name`, `operation`) for better span names in the UI.

---

### 2.4 POST /v1/metrics

**Purpose**: Ingest OTLP metrics. Used for tool profile LLM stats when present (request count, errors, latency, token counts); supports gauge, sum, histogram, exponential histogram, summary.

**Request**
- **Method**: POST  
- **Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`  
- **Body**: OTLP JSON with root key `resourceMetrics` (array).

**Schema (minimal)**

```json
{
  "resourceMetrics": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "my-service" } },
          { "key": "gen_ai.request.model", "value": { "stringValue": "gpt-4o" } }
        ]
      },
      "scopeMetrics": [
        {
          "metrics": [
            {
              "name": "gen_ai.usage.input_tokens",
              "unit": "tokens",
              "description": "Input token count",
              "gauge": {
                "dataPoints": [
                  {
                    "timeUnixNano": "1234567890000000000",
                    "asInt": "100",
                    "asDouble": 100,
                    "attributes": [
                      { "key": "gen_ai.request.model", "value": { "stringValue": "gpt-4o" } },
                      { "key": "gen_ai.token.type", "value": { "stringValue": "input" } }
                    ]
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
```

**Metric types we read**
- `sum.dataPoints` (value from `asDouble` or `asInt`)
- `gauge.dataPoints`
- `histogram.dataPoints` (count, sum, bucketCounts, explicitBounds for latency percentiles)
- `exponentialHistogram.dataPoints`
- `summary.dataPoints`

**Metric name → UI mapping (by regex)**

| Metric name pattern (regex) | Use in UI |
|-----------------------------|-----------|
| `(gen_ai\.)?(request|requests)\.(count|total)|request_count|requests_total` | Request count (model usage, daily/hourly). |
| `(gen_ai\.)?(error|errors|failure|failed)\.(count|total)|error_count|errors_total` | Error count. |
| `(latency|duration|response\.time)` | Latency (avg, p50/p95/p99 when histogram). |
| `(gen_ai\.)?(usage\.)?input_tokens|token\.input|tokens\.input|input_tokens_total` | Input tokens (or use attribute `gen_ai.token.type` = `input` / `prompt`). |
| `(gen_ai\.)?(usage\.)?output_tokens|token\.output|tokens\.output|output_tokens_total` | Output tokens (or `gen_ai.token.type` = `output` / `completion`). |

**DataPoint attributes we use**
- `gen_ai.request.model` – model dimension (model usage, daily/hourly, latency by model).
- `gen_ai.response.model` – fallback for model.
- `gen_ai.token.type` or `token.type` – `input`/`prompt` → input tokens; `output`/`completion` → output tokens when name is ambiguous.

**Instrumentation checklist (metrics)**
- [ ] Send `resourceMetrics` with at least one metric.
- [ ] Set `resource.attributes` (e.g. `service.name`, `gen_ai.system`).
- [ ] Use metric names that match the patterns above (or set `gen_ai.token.type` for token metrics).
- [ ] For token metrics: set dataPoint `attributes` with `gen_ai.request.model` (and optionally `gen_ai.token.type`).
- [ ] For latency: use histogram with `bucketCounts` and `explicitBounds` for percentiles, or gauge/sum for average.
- [ ] Use numeric values in `asInt` or `asDouble` (we coerce; NaN is ignored).

---

## 3. End-users documentation

### 3.1 Overview (End-users)
- **Dashboard**: High-level stats (total events, commits, active agents) and a recent **events** feed (provenance events + telemetry spans). Each row shows intent, tool/vendor, model (if any), timestamp, and user attribution.
- **Events page**: Search/filter the same event feed; same columns and attribution.
- **Tool profiles**: One card per “tool” (vendor). Opens a detail page with **Metrics** and **Logs** tabs, plus summary cards.

### 3.2 Where each UI field comes from

**Events feed (Dashboard + Events search)**

| UI element | Source | How to get it (instrumentation) |
|------------|--------|----------------------------------|
| Intent / title | Span `name` or provenance event `intent` | Set span `name` (traces) or send provenance event with `intent`. |
| Tool / vendor | Resource (and span) attributes | Set `service.name` (and optionally `gen_ai.system`, etc.) so vendor is recognized. |
| Model | Span attributes `gen_ai.request.model` or `gen_ai.response.model` | Set on LLM spans (and optionally in log/metric attributes). |
| Timestamp | Span `start_time` or event `timestamp` | Set `startTimeUnixNano` (traces) or log `timeUnixNano`. |
| User | API token `user_id` (or customer owner) | Create API tokens with user scope; we attach user to each event. |
| User avatar/name | User record (id, name, image, email) | Set in workspace user profile (image URL). |

**Tool profiles list**

| UI element | Source | How to get it |
|------------|--------|----------------|
| Display name | Vendor display name from `service.name` / vendor registry | Set `service.name` (and optional vendor hints). |
| Total spans | Count of ingested spans for that vendor | Send traces (and/or logs with traceId+spanId for synthesized spans). |
| Total traces | Distinct trace_id count | Same. |
| Total errors | Count of spans/logs with status ERROR or severity ERROR/FATAL | Set span `status.code` = 2 or log severity 17/21. |

**Tool profile detail – summary cards**

| Card | Source | How to get it |
|------|--------|----------------|
| Total LLM tokens consumed | Sum of `gen_ai.usage.input_tokens` + `gen_ai.usage.output_tokens` from spans (and token metrics if present) | Set span attributes on LLM spans; or send token metrics. |
| Most active user | User with most spans in the profile | Send requests with API token that has `user_id` set. |
| Estimated costs | Derived from token totals and internal pricing | Same as total tokens. |

**Tool profile detail – Metrics tab**

| UI element | Source | How to get it |
|------------|--------|----------------|
| Model usage table | Spans: model from `gen_ai.request.model`/`response`, request/error/tokens/latency. Metrics: same from metric names + attributes. | Set span attributes; or send request/error/token/latency metrics with `gen_ai.request.model` in attributes. |
| Daily usage chart | Spans: daily grouping of requests/tokens/errors. Metrics: same by day. | Same. |
| Hourly tokens chart | Spans: hourly token sums. Metrics: same. | Same. |
| Model latency (p50/p95/p99, avg) | Spans: `duration_ms`. Metrics: latency-named metrics (gauge/sum or histogram). | Set span start/end times; or send latency metrics (histogram preferred for percentiles). |
| Top operations | Spans: `span_name` + call count, latency, errors, tokens. | Set span `name` and LLM span attributes. |

**Tool profile detail – Logs tab**

| UI element | Source | How to get it |
|------------|--------|----------------|
| Log rows | Ingested log records | Send POST /v1/logs with `resourceLogs` and `logRecords`. |
| Timestamp, severity, body | Log `timeUnixNano`, `severityNumber`/`severityText`, `body` | Set on each log record. |

**Tool profile detail – Spans / timeline**

| UI element | Source | How to get it |
|------------|--------|----------------|
| Span list / timeline | Ingested spans (and synthesized from logs) | Send traces; or logs with traceId+spanId for synthesis. |
| Span name, duration, status | Span `name`, computed duration, `status.code` | Set span fields and times. |

### 3.3 Gen AI semantic conventions (reference)

These are the attribute names the UI and backend rely on for LLM tool profiles and events:

| Attribute | Type | Meaning |
|-----------|------|---------|
| `gen_ai.system` | string | LLM provider (e.g. openai, anthropic, gemini). |
| `gen_ai.request.model` | string | Request model name. |
| `gen_ai.response.model` | string | Response model name. |
| `gen_ai.usage.input_tokens` | int | Input/prompt token count. |
| `gen_ai.usage.output_tokens` | int | Output/completion token count. |
| `gen_ai.token.type` | string | For metrics: `input`, `prompt`, `output`, `completion`. |

---

## 4. Implementation checklist for the docs site

### 4.1 Pages and routing
- [ ] Add docs route(s) under www.trystereos.com (e.g. `/docs` or `/docs/telemetry`).
- [ ] Tab toggle: “Providers” vs “End-users” (or two routes with shared nav).
- [ ] Scroll navigation component with anchor links for each section.

### 4.2 Providers content
- [ ] **Auth**: Bearer token, where to get it (Settings → API keys), no protobuf.
- [ ] **POST /v1/traces**: Full OTLP JSON shape; table of fields → UI; vendor detection; instrumentation checklist.
- [ ] **POST /v1/logs**: Full OTLP JSON shape; table of fields → UI; synthesized spans; instrumentation checklist.
- [ ] **POST /v1/metrics**: Full OTLP JSON shape; metric name patterns; dataPoint attributes; instrumentation checklist.
- [ ] **Schema reference**: Minimal JSON examples for each endpoint (copy-paste friendly).
- [ ] **Gen AI attributes**: Table of all `gen_ai.*` (and related) attributes used.

### 4.3 End-users content
- [ ] **Dashboard**: What the numbers and event list mean; where data comes from (traces + provenance).
- [ ] **Events**: Same event shape; filters (actor, tool, intent, date); user attribution.
- [ ] **Tool profiles**: What a “tool” is (vendor); list view (spans, traces, errors).
- [ ] **Tool profile detail**: Summary cards (tokens, user, cost); Metrics tab (models, daily/hourly, latency); Logs tab; Spans/timeline.
- [ ] **What each field means**: One table or section mapping “UI label” → “source (endpoint + field)” → “how to get it (for providers).”

### 4.4 Optional
- [ ] Code samples: cURL or small script for each of traces, logs, metrics.
- [ ] Link to `scripts/generate-otelp-sample.ts` for sample payloads.
- [ ] OpenAPI/JSON schema export for the three endpoints (if you add machine-readable specs).

---

## 5. File and copy suggestions

- **Single doc file**: e.g. `docs/telemetry-api.md` or `docs/OTEL_ENDPOINTS.md` as the single source of truth; then render it on the site with tabs and scroll nav.
- **Or** split: `docs/providers/traces.md`, `docs/providers/logs.md`, `docs/providers/metrics.md`, `docs/end-users/dashboard.md`, `docs/end-users/tool-profiles.md`, and a short “Field reference” that lists every UI field and its instrumentation requirement.

This plan captures all current UI fields and ties them to the three endpoints and their expected schema and attributes so both provider and end-user docs stay accurate and complete.
