# 📝 LLM Telemetry Refactor & Forward Proxy Plan

Focus solely on LLM-invoked telemetry, remove legacy event/log routes, and implement a forward proxy for completions with full OTEL GenAI span tracking.

## 1. Drop Legacy Event/Log Routes and Provenance

- Remove `/v1/events` API route
- Delete ProvenanceEvents table from the database
- Remove VS Code extension support
- Remove references to `events` in the web folder
- Remove `/v1/logs` route and any old logs/event handling
- Ensure no legacy event code remains in middleware or API layer

**Outcome:** All legacy event tracking removed; system now focused on LLM spans only.

## 2. Implement LLM Span Tracking

- Track the following spans for each LLM transaction:
    1. `gen_ai.request`
        - Attributes: `prompt`, `model`, `temperature`, etc.
    2. `gen_ai.tool_call`
        - Attributes: `tool.name`, `tool.arguments`
    3. `gen_ai.tool_result`
        - Attributes: `tool.output.diff` (full diff blob)
        - Optional: tool status, execution time
    4. `gen_ai.response`
        - Attributes: final completion text

- Use trace_id and span_id already present in the data model
- Ensure all diff outputs captured with:

```ts
span.set_attribute("tool.output.diff", <diff_blob>)
```

- No events or logs are needed for LLM-invoked edits — spans capture everything.

## 3. Drop `/v1/logs` if Unused

- Audit current usage of `/v1/logs`
- If no customer-facing or internal process relies on it:
    - Remove the route
    - Delete associated table(s)
    - Remove handling in backend service layer
- Logs may still be used internally for debugging, but not persisted as OTEL events for telemetry.

## 4. ~~Forward Proxy for Completions~~ (Removed)

The chat completions proxy (`POST /v1/chat/completions`) was removed. Clients send spans directly via OTLP (`POST /v1/traces`). LLM instrumentation is handled by the client (IDE, SDK, etc.).

## 5. Quick Actions Replacement

- Add a required configuration card in the UI for the user to configure:
    - OTLP endpoint URL (e.g. `https://api.trystereos.com/v1/traces`)
    - API token for `Authorization: Bearer`

## 6. Update /events Page to Use Spans

- Rename `/events` page conceptually to LLM Spans page
- Render all spans:
    - `gen_ai.request`
    - `gen_ai.tool_call`
    - `gen_ai.tool_result`
    - `gen_ai.response`

- Display titles and types for:
    - Diff outputs (tool.output.diff)
    - Tools called (tool.name)
- Include trace/span correlation IDs

## 7. Update API Contract for Authentication

- OTLP endpoints (`/v1/traces`, `/v1/metrics`) require:

```sh
Authorization: Bearer <your_platform_token>
```

- Validate platform Bearer token internally
- Return 401 if missing or invalid

## Optional Considerations

- Implement size limits for `tool.output.diff` to prevent massive spans
- Add redaction policies if diffs may contain secrets or sensitive code
- Ensure spans maintain timing correlation:
    - `gen_ai.tool_call` → start/end timestamps
    - `gen_ai.tool_result` → end timestamp
    - Link spans via `trace_id`
- Consider sampling very large diffs for OTEL backends that have cardinality limits