# Stereos Extension Documentation

> Stereos is an LLM Provenance Platform — an engineering-first system that records **how code came to exist** by capturing structured events from AI agents and tools, linking them to Git artifacts. This document covers the VS Code extension, the API contract, event handling, and span-to-event conversion from the Telemetry (OTLP) API.

---

## Table of Contents

1. [Extension Overview](#extension-overview)
2. [Architecture](#architecture)
3. [Extension Configuration](#extension-configuration)
4. [Authentication & Token Management](#authentication--token-management)
5. [Event Handling](#event-handling)
6. [AI Tool Detection](#ai-tool-detection)
7. [Diff Handling](#diff-handling)
8. [API Contract](#api-contract)
9. [Data Models](#data-models)
10. [Telemetry API: Span-to-Event Conversion](#telemetry-api-span-to-event-conversion)
11. [Billing & Usage Metering](#billing--usage-metering)
12. [Status Bar & UI](#status-bar--ui)

---

## Extension Overview

**Name:** `stereos-provenance`
**Type:** VS Code Extension
**Version:** 1.0.4
**Activation Events:** `onStartupFinished`, `onUri` (deep linking for account connection)

The extension is the primary capture mechanism in the IDE. It watches file changes, detects which AI tool is active, collects Git context (branch, commit, diffs), and sends structured provenance events to the Stereos API.

### Commands

| Command | Description |
|---------|-------------|
| `stereos.trackChange` | Manually track a code change with a user-provided intent |
| `stereos.openDashboard` | Open the Stereos web dashboard |
| `stereos.openEvent` | Open a specific event by ID in the dashboard |
| `stereos.connectAccount` | Deep link to the web app for account connection |
| `stereos.configure` | Manually paste an API token |
| `stereos.toggleAutoTrack` | Enable/disable automatic file change tracking |

### Language Model Tool

The extension registers a Language Model Tool (`stereos_recordProvenance`) that allows Copilot/Cursor agents to call it directly after making edits:

```typescript
// Input Schema
{
  files_changed: string[]   // File paths relative to workspace
  summary: string           // What was changed and why (required)
  model?: string            // Optional model override
}
```

This enables edit-level attribution when AI agents make changes — the agent itself reports what it did.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Extension                                       │
│                                                          │
│  File System Watcher ──► PendingChange Map               │
│                              │                           │
│                        (debounce: 5s)                    │
│                              │                           │
│                         Flush Batch                      │
│                              │                           │
│  ┌───────────────────────────┼──────────────────────┐    │
│  │ Collect Git Info          │ Detect AI Tool       │    │
│  │ (branch, commit, repo)    │ (cursor, copilot...) │    │
│  │ Retrieve Diff             │ Resolve Model        │    │
│  └───────────────────────────┼──────────────────────┘    │
│                              │                           │
│                    Build Event Payload                    │
└──────────────────────────────┼───────────────────────────┘
                               │
                    POST /v1/events (Bearer token)
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│  Stereos API (Hono)                                       │
│                                                          │
│  authMiddleware ──► Validate token, customer, billing     │
│         │                                                │
│         ├─► Store ProvenanceEvent + ArtifactLink          │
│         ├─► Track Usage (billing meter)                   │
│         └─► Return { success: true, event_id }            │
│                                                          │
│  OTLP Endpoints ──► /v1/traces, /v1/logs, /v1/metrics   │
│         │                                                │
│         ├─► Flatten attributes, canonicalize vendor       │
│         ├─► Upsert ToolProfile                           │
│         ├─► Insert TelemetrySpans / Logs / Metrics        │
│         └─► Merge into unified event feed                │
│                                                          │
│  Query Endpoints ──► /v1/dashboard, /v1/events/search    │
│         │                                                │
│         └─► Merge provenance + telemetry into timeline    │
└──────────────────────────────────────────────────────────┘
                               │
                               ▼
                  ┌──────────────────────┐
                  │  PostgreSQL           │
                  │  (append-only store)  │
                  └──────────────────────┘
```

---

## Extension Configuration

Users configure the extension via VS Code settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `stereos.apiToken` | `string` | `""` | API token (prefer deep link over manual entry) |
| `stereos.autoTrack` | `boolean` | `true` | Automatically track file changes |
| `stereos.debounceMs` | `number` | `5000` | Milliseconds to wait before batching and sending events |
| `stereos.actorId` | `string` | `"vscode"` | Actor identifier sent with events |

---

## Authentication & Token Management

### Token Storage

| Priority | Source | Notes |
|----------|--------|-------|
| 1 | `context.secrets` (VS Code SecretStorage) | Encrypted, preferred |
| 2 | `stereos.apiToken` setting | Plaintext in settings.json, fallback |

### Deep Linking Flow

```
1. User clicks "Connect" in extension
2. Browser opens: https://app.trystereos.com/connect
3. Web app generates token, redirects to:
   vscode://stereos.stereos-provenance/connect?token=sk_...&baseUrl=...
4. Extension receives URI via onUri handler
5. Token stored in SecretStorage (encrypted)
6. Watchers installed, status bar updated
```

### Token Format

API tokens follow the pattern `sk_<32-char hex>` (e.g., `sk_a1b2c3d4e5f6...`).

---

## Event Handling

### Auto-Tracking Flow

The extension uses a debounced batch-send model:

```
File Change (create/modify/delete)
       │
       ▼
PendingChange Map (keyed by file URI)
       │
       │  Each change resets the debounce timer
       ▼
Schedule Flush (waits debounceMs)
       │
       ▼
trackChanges()
       │
       ├── Collect Git info (branch, commit, repo URL)
       ├── Detect active AI tool + model
       ├── Retrieve diff from working tree or last commit
       ├── Generate intent summary
       ├── Build event payload
       └── POST /v1/events
```

### PendingChange Structure

```typescript
interface PendingChange {
  uri: vscode.Uri;
  timestamp: number;
  action: 'created' | 'modified' | 'deleted';
  lineCount?: number;
}
```

### Intent Generation

The extension generates human-readable intent summaries from batched changes:

| Scenario | Intent |
|----------|--------|
| Single action type | `"Modified 3 file(s) (.ts, .tsx)"` |
| Creates only | `"Created 1 file(s)"` |
| Mixed | `"Changed 5 file(s) - 2 created, 3 modified"` |

### Event Types

The system has two primary event types:

#### `agent_action`

Represents an AI-assisted code change captured at the IDE level.

```typescript
{
  event_type: 'agent_action',
  actor_type: 'agent',
  actor_id: string,              // "vscode", "cursor-v1", etc.
  intent: string,                // "Modified 3 files (.ts)"
  tool: string,                  // "cursor", "github-copilot", "vscode"
  model?: string,                // "gpt-4", "claude-3-sonnet", etc.
  files_written?: string[],      // ["src/auth.ts", "src/utils.ts"]
  timestamp?: string,            // ISO 8601 (defaults to now)
  repo: string,                  // Repository folder name
  branch?: string,               // Current Git branch
  commit?: string,               // Current HEAD commit SHA
  diff_hash?: string,            // SHA-256(repo + commit + sorted files)
  diff_content?: string,         // Structured JSON diff (see Diff Handling)
  metadata?: {
    repo_url?: string,
    file_count: number,
    created_count: number,
    modified_count: number,
    deleted_count: number,
    total_lines: number,
    session_duration_seconds: number,
    workspace: string,
    vscode_version: string,
    extension_version: string
  }
}
```

#### `outcome`

Links an agent action to its final disposition — was the AI-generated code accepted, rejected, or superseded?

```typescript
{
  event_type: 'outcome',
  original_event_id: string,     // UUID of the agent_action
  status: 'accepted' | 'rejected' | 'superseded',
  linked_commit?: string         // Optional final commit SHA
}
```

---

## AI Tool Detection

The extension auto-detects which AI tool is active in the IDE:

| Tool | Detection Method | Default Model |
|------|-----------------|---------------|
| **Cursor** | App name contains "Cursor" | Read from Cursor settings |
| **GitHub Copilot** | Extension `github.copilot` active | `gpt-4` |
| **Sourcegraph Cody** | Extension `sourcegraph.cody-ai` active | `claude-3-sonnet` |
| **Continue.dev** | Extension `continue.continue` active | `claude-3-sonnet` |
| **Supermaven** | Extension `supermaven.supermaven` active | — |
| **Codeium** | Extension `codeium.codeium` active | — |
| **Fallback** | None of the above | `"vscode"` |

---

## Diff Handling

### Diff Collection Priority

```
1. git diff HEAD [files...]          ← If there are unstaged changes
2. git diff HEAD~1 HEAD [files...]   ← If working tree is clean
```

### Structured Diff Format

Raw unified diffs are parsed into a structured JSON format for storage and visualization:

```typescript
type DiffJson = Array<{
  path: string;
  hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: Array<{
      type: 'add' | 'remove' | 'context';
      content: string;
    }>;
  }>;
}>;
```

**Size limit:** 512KB. Diffs exceeding this are truncated with `"...(truncated)"`.

Stored in the `artifact_links.diff_content` column as a JSON string.

---

## API Contract

**Base URL:** `https://api.trystereos.com` (production) / `http://localhost:3000` (development)

**Authentication:** `Authorization: Bearer sk_<token>`

### Event Ingestion

#### `POST /v1/events`

Ingests provenance events (agent actions and outcomes).

**Auth:** Bearer token (authMiddleware)

**Request Body (agent_action):**
```json
{
  "event_type": "agent_action",
  "actor_type": "agent",
  "actor_id": "cursor-v1",
  "intent": "Modified 3 file(s) (.ts, .tsx)",
  "tool": "cursor",
  "model": "claude-3-sonnet",
  "files_written": ["src/auth.ts", "src/utils.ts"],
  "repo": "my-project",
  "branch": "feature/auth",
  "commit": "abc123def456...",
  "diff_hash": "sha256...",
  "diff_content": "[{\"path\":\"src/auth.ts\",\"hunks\":[...]}]",
  "metadata": {
    "file_count": 2,
    "created_count": 0,
    "modified_count": 2,
    "deleted_count": 0,
    "total_lines": 150,
    "session_duration_seconds": 120
  }
}
```

**Request Body (outcome):**
```json
{
  "event_type": "outcome",
  "original_event_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "accepted",
  "linked_commit": "def789abc..."
}
```

**Response (201):**
```json
{
  "success": true,
  "event_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### OTLP Telemetry Ingestion

#### `POST /v1/traces`

Ingests OpenTelemetry trace data (OTLP JSON format).

**Auth:** Bearer token

**Request Body:** OTLP `ExportTraceServiceRequest` (JSON)
```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "my-service" } },
          { "key": "cloud.provider", "value": { "stringValue": "cloudflare" } }
        ]
      },
      "scopeSpans": [
        {
          "spans": [
            {
              "traceId": "abc123...",
              "spanId": "def456...",
              "parentSpanId": "",
              "name": "HTTP GET /api/users",
              "kind": 2,
              "startTimeUnixNano": "1700000000000000000",
              "endTimeUnixNano": "1700000000500000000",
              "status": { "code": 1, "message": "" },
              "attributes": [
                { "key": "http.method", "value": { "stringValue": "GET" } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "partialSuccess": {
    "acceptedSpans": 10,
    "rejectedSpans": 0
  }
}
```

#### `POST /v1/logs`

Ingests OpenTelemetry log data (OTLP JSON format).

**Auth:** Bearer token

**Request Body:** OTLP `ExportLogsServiceRequest` (JSON)

**Processing:** For logs with trace context (traceId + spanId), a synthetic `TelemetrySpan` is created with `signal_type: 'log'` so the log appears in the span timeline.

#### `POST /v1/metrics`

Ingests OpenTelemetry metric data (OTLP JSON format).

**Auth:** Bearer token

**Request Body:** OTLP `ExportMetricsServiceRequest` (JSON)

**Supported metric types:** sum, gauge, histogram, exponential_histogram, summary

---

### Query Endpoints

#### `GET /v1/dashboard`

Returns stats and recent merged events (provenance + telemetry).

**Auth:** Session or Bearer token

**Response:**
```json
{
  "total_events": 142,
  "total_commits": 38,
  "active_agents": 3,
  "recent_events": [
    {
      "id": "uuid",
      "type": "provenance",
      "intent": "Modified 2 files",
      "actor_id": "cursor-v1",
      "tool": "cursor",
      "model": "claude-3-sonnet",
      "timestamp": "2025-01-15T10:30:00Z",
      "user": { "id": "uuid", "name": "Jane", "email": "jane@co.com", "image": "..." }
    },
    {
      "id": "uuid",
      "type": "span",
      "intent": "HTTP GET /api/users",
      "actor_id": "cloudflare-workers",
      "tool": "cloudflare-workers",
      "model": null,
      "timestamp": "2025-01-15T10:29:00Z",
      "tool_profile_id": "uuid",
      "user": null
    }
  ]
}
```

#### `GET /v1/events/search`

Full-text search across provenance events and telemetry spans.

**Auth:** Session or Bearer token

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `actor_id` | string | Filter by actor ID |
| `tool` | string | Filter by tool name |
| `intent` | string | Substring search (ILIKE) |
| `start_date` | ISO string | Start of date range |
| `end_date` | ISO string | End of date range |
| `limit` | number | Max results (default 50, max 100) |
| `offset` | number | Pagination offset |

#### `GET /v1/events/:eventId`

Returns a single provenance event with artifact links and outcomes.

**Auth:** Session or Bearer token

#### `GET /v1/events/:eventId/file`

Returns the diff for a single file from an event's artifacts.

**Auth:** Session or Bearer token

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | File path (must be in event's `files_written`) |

#### `GET /v1/provenance/by-commit/:sha`

Returns all provenance events linked to a given commit SHA.

#### `GET /v1/provenance/by-file`

Returns events where a file appears in `files_written`.

**Query Parameters:** `path` (required), `repo` (optional)

---

### Telemetry Query Endpoints

#### `GET /v1/tool-profiles`

Returns all tool profiles for the customer, ordered by `last_seen_at` DESC.

#### `GET /v1/tool-profiles/:profileId`

Returns a profile with latency percentiles (p50, p95, p99, avg).

#### `GET /v1/tool-profiles/:profileId/spans`

Paginated telemetry spans for a profile. Params: `limit`, `offset`.

#### `GET /v1/tool-profiles/:profileId/metrics`

Aggregated metrics by name/type with last value and datapoint count.

#### `GET /v1/tool-profiles/:profileId/llm-stats`

Complex aggregation for LLM vendor profiles.

**Response:**
```json
{
  "modelUsage": [
    { "model": "claude-3-sonnet", "request_count": 45, "error_count": 2, "avg_latency_ms": 1200, "tokens": 50000 }
  ],
  "dailyUsage": [
    { "day": "2025-01-15", "request_count": 12, "input_tokens": 8000, "output_tokens": 12000, "error_count": 0 }
  ],
  "hourlyTokens": [],
  "modelLatency": [
    { "model": "claude-3-sonnet", "p50": 900, "p95": 2100, "p99": 3500, "avg_ms": 1200, "min_ms": 200, "max_ms": 5000 }
  ],
  "topOperations": [],
  "totals": {
    "totalInputTokens": 80000,
    "totalOutputTokens": 120000,
    "distinctModels": 2
  }
}
```

#### `GET /v1/tool-profiles/:profileId/timeline`

Returns the last 24 hours of hourly spans with error count and latency.

---

### Token Management

#### `POST /v1/tokens`

Creates a new API token for the authenticated customer.

**Auth:** Session (Better Auth)

**Response:**
```json
{
  "token": "sk_a1b2c3d4e5f6...",
  "id": "uuid",
  "name": "My Token",
  "created_at": "2025-01-15T10:00:00Z"
}
```

---

## Data Models

### Provenance Tables

```
provenanceEvents
├── id: UUID (PK)
├── customer_id: UUID (FK → customers)
├── user_id: UUID (FK → users, nullable)
├── title: enum (engineer, manager, cto, ...)
├── actor_type: 'agent'
├── actor_id: string
├── tool: string
├── model: string (nullable)
├── intent: string
├── files_written: string[]
├── timestamp: timestamp
└── event_hash: string (nullable)

artifactLinks
├── id: UUID (PK)
├── event_id: UUID (FK → provenanceEvents)
├── repo: string
├── branch: string (nullable)
├── commit: string (nullable)
├── diff_hash: string (nullable)
└── diff_content: text (nullable, JSON string)

outcomes
├── id: UUID (PK)
├── event_id: UUID (FK → provenanceEvents)
├── status: 'accepted' | 'rejected' | 'superseded'
├── linked_commit: string (nullable)
└── created_at: timestamp
```

### Telemetry Tables

```
toolProfiles
├── id: UUID (PK)
├── customer_id: UUID (FK)
├── vendor: string (canonical slug)
├── display_name: string
├── logo_url: string (nullable)
├── vendor_category: string
├── total_spans: integer
├── total_traces: integer
├── total_errors: integer
├── first_seen_at: timestamp
└── last_seen_at: timestamp
    UNIQUE(customer_id, vendor)

telemetrySpans
├── id: UUID (PK)
├── customer_id: UUID (FK)
├── user_id: UUID (FK, nullable)
├── tool_profile_id: UUID (FK, nullable)
├── trace_id: string
├── span_id: string
├── parent_span_id: string (nullable)
├── span_name: string
├── span_kind: string
├── start_time: timestamp
├── end_time: timestamp (nullable)
├── duration_ms: integer (nullable)
├── status_code: 'ERROR' | 'OK' | 'UNSET'
├── status_message: string (nullable)
├── vendor: string
├── service_name: string (nullable)
├── resource_attributes: jsonb
├── span_attributes: jsonb
├── signal_type: 'trace' | 'log'
└── ingested_at: timestamp

telemetryLogs
├── id: UUID (PK)
├── customer_id: UUID (FK)
├── vendor: string
├── trace_id, span_id: string (nullable)
├── severity: string
├── body: text
├── resource_attributes: jsonb
├── log_attributes: jsonb
├── timestamp: timestamp
└── ingested_at: timestamp

telemetryMetrics
├── id: UUID (PK)
├── customer_id: UUID (FK)
├── vendor: string
├── metric_name: string
├── metric_type: string
├── unit: string (nullable)
├── value_double, value_int: numeric (nullable)
├── count, sum, min, max: numeric (nullable)
├── bucket_counts, explicit_bounds: jsonb (nullable)
├── quantile_values: jsonb (nullable)
├── data_point: jsonb (nullable)
├── start_time, time: timestamp
└── ingested_at: timestamp
```

---

## Telemetry API: Span-to-Event Conversion

This section details how raw OTLP spans are transformed into stored telemetry events and merged into the unified provenance timeline.

### Step 1: Attribute Flattening

OTEL attributes arrive in a nested format. They are flattened to a plain key-value map:

```
Input:  [{ key: "http.method", value: { stringValue: "GET" } }]
Output: { "http.method": "GET" }
```

Supported value types: `stringValue`, `intValue`, `boolValue`, `doubleValue`. Arrays are dropped.

### Step 2: Vendor Canonicalization

Flattened resource attributes are matched against a **Vendor Registry** to determine the canonical vendor slug. The registry is checked in priority order:

| Slug | Display Name | Category | Matching Rules |
|------|-------------|----------|---------------|
| `cloudflare-workers` | Cloudflare Workers | runtime | `cloud.provider=cloudflare`, service name matches, `faas.trigger` present |
| `arcade` | Arcade Dev | tool-server | service name or SDK includes "arcade" |
| `vscode` | VS Code | ide | executable is `code` |
| `cursor` | Cursor | ide | service name or executable includes "cursor" |
| `codex` | OpenAI Codex | ide | service/SDK/executable matches "codex" |
| `e2b` | E2B Sandbox | sandbox | service name includes "e2b" |
| `anthropic` | Anthropic (Claude) | llm | `gen_ai.system=anthropic\|claude`, model includes "claude" |
| `google-gemini` | Google (Gemini) | llm | `gen_ai.system=gemini\|google`, model includes "gemini" |
| `openai` | OpenAI | llm | `gen_ai.system=openai`, model includes "gpt", "o1", or "o3" |
| `kilo-code` | Kilo Code | llm | service/SDK includes "kilo" |

**Fallback:** If no matcher hits, the `service.name` is slugified (e.g., `"My Custom Service"` → `my-custom-service`).

### Step 3: LLM Detection

A span is classified as an LLM span if any of these are true:
- The vendor's category is `"llm"`
- `gen_ai.system` attribute is present
- `gen_ai.request.model` or `gen_ai.response.model` attribute is present

**LLM spans are NOT stored in the `telemetrySpans` table** — they are filtered out. Their metrics and logs are still tracked.

### Step 4: ToolProfile Upsert

For each unique `(customer_id, vendor)` pair, a `ToolProfile` is upserted:
- Increments `total_spans` by span count
- Increments `total_traces` by unique trace IDs
- Increments `total_errors` by spans with `status.code = 2`
- Updates `last_seen_at`
- Sets `first_seen_at` on first encounter

### Step 5: Span Conversion & Storage

Each OTEL span is converted to a `TelemetrySpan` record:

```
OTEL Span Field              → TelemetrySpan Column
─────────────────────────────────────────────────────
traceId                      → trace_id
spanId                       → span_id
parentSpanId                 → parent_span_id
name                         → span_name
kind (0-5)                   → span_kind (UNSPECIFIED/INTERNAL/SERVER/CLIENT/PRODUCER/CONSUMER)
startTimeUnixNano            → start_time (Date)
endTimeUnixNano              → end_time (Date)
(end - start) / 1e6          → duration_ms
status.code                  → status_code (1→'OK', 2→'ERROR', else→'UNSET')
status.message               → status_message
resource attributes (flat)   → resource_attributes (jsonb)
span attributes (flat)       → span_attributes (jsonb)
(derived)                    → vendor (canonical slug)
resource['service.name']     → service_name
(literal)                    → signal_type: 'trace'
```

### Step 6: Log-to-Span Synthesis

When logs arrive via `POST /v1/logs` with trace context (`traceId` + `spanId`), a synthetic `TelemetrySpan` is created so the log appears in the span timeline:

```typescript
{
  trace_id:    log.traceId,
  span_id:     log.spanId,
  span_name:   log.body || attribute['name'] || 'log',
  start_time:  log.timestamp,
  status_code: severity in ['FATAL','ERROR'] ? 'ERROR' : 'OK',
  signal_type: 'log',
  // ... remaining fields from log context
}
```

This only happens for **non-LLM vendors**.

### Step 7: Unified Event Feed

The dashboard and search endpoints merge provenance events and telemetry spans into a single timeline:

```typescript
// Each merged event has:
{
  id: string,
  type: 'provenance' | 'span',        // Source type
  intent: string,                       // Provenance: intent field; Span: span_name
  actor_id: string,                     // Provenance: actor_id; Span: vendor slug
  tool: string,                         // Provenance: tool field; Span: vendor slug
  model: string | null,                 // Provenance: model; Span: gen_ai attributes
  timestamp: string,                    // ISO 8601
  tool_profile_id?: string,            // Only for spans
  user: UserAttribution | null          // Resolved user profile
}
```

Events from both sources are interleaved by timestamp to produce a single chronological view of all AI-related activity.

---

## Billing & Usage Metering

Usage is tracked per event and metered to Stripe:

| Billable Event | Unit | Notes |
|---------------|------|-------|
| `agent_action` | 1 per event | Each provenance event |
| `outcome` | 1 per event | Each outcome record |
| `telemetry_span` | 1 per span | Non-LLM vendors only |

Usage events are stored with an idempotency key (unique per customer) to prevent double-counting. If a Stripe secret key is configured, usage is also reported to Stripe's metering API for billing.

Customers with `billing_status: 'canceled'` are rejected at the auth middleware level — no events are accepted.

---

## Status Bar & UI

### Status Bar States

| State | Icon | Label | Click Action |
|-------|------|-------|-------------|
| Not connected | `$(link)` | `Stereos: Not connected` | Connect account |
| Connected (idle) | `$(check)` | `Stereos: Connected` | Open dashboard |
| Pending changes | `$(sync~spin)` | `Stereos: N pending` | — (tooltip shows countdown) |
| Send failed | `$(warning)` | `Stereos: Send failed` | Open dashboard |

### Sidebar Tree View

When connected, the Provenance sidebar shows:
- Open Dashboard
- Track Code Change
- Toggle auto-tracking (on/off indicator)
- Open Settings
