<p align="center">
  <a href="https://trystereos.com">
    <img src="./apps/web/public/logo.svg" alt="Stereos" height="60" />
  </a>

  <h3 align="center">Stereos</h3>

  <p align="center">
    Private organizational AI gateway for engineering teams.
    <br />
    <a href="https://trystereos.com"><strong>Learn more »</strong></a>
    <br />
    <br />
    <a href="https://join.slack.com/t/trystereos/shared_invite/zt-384mjl0hs-X2WTb8sc1xFrrDKULcgboQ">Slack</a>
    ·
    <a href="https://trystereos.com">Website</a>
    ·
    <a href="https://github.com/your-org/stereos/issues">Issues</a>
    ·
    <a href="mailto:james@trystereos.com">Contact</a>
  </p>
</p>

<p align="center">
  <a href="https://join.slack.com/t/trystereos/shared_invite/zt-384mjl0hs-X2WTb8sc1xFrrDKULcgboQ"><img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/trystereos/stereos/main/apps/web/public/slack-badge.json&style=flat-square" alt="Slack" /></a>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/OpenTelemetry-000000?style=flat-square&logo=opentelemetry&logoColor=white" alt="OpenTelemetry" />
  <img src="https://img.shields.io/badge/Cloudflare%20AI%20Gateway-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white" alt="Cloudflare AI Gateway" />
  <img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/trystereos/stereos/main/apps/web/public/zero-data-retention-badge.json&style=flat-square" alt="Zero Data Retention" />
  <a href="mailto:james@trystereos.com"><img src="https://img.shields.io/badge/james%40trystereos.com-6D4AFF?style=flat-square&logo=protonmail&logoColor=white" alt="Contact" /></a>
</p>

## About

<img width="100%" src="./apps/web/public/gh-image.png" alt="Stereos — Private Organizational AI Gateway" />

# Route all AI traffic through your own infrastructure.

Stereos is a **private organizational AI gateway** built for engineering teams. Route all AI traffic through your own gateway with virtual key management, per-key budget controls, model allowlists, and full OpenTelemetry observability — without your prompts or completions ever leaving your infrastructure.

You don't need archaic AI usage policies to protect your data. Give your team the freedom to use the tools they love, while maintaining full control and visibility over your organization's AI usage.

## Features

### AI Gateway

- OpenAI-compatible proxy endpoint (`/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`, and more)
- Backed by [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) — per-customer provisioned gateways with caching, rate limiting, and logpush
- Automatic provider routing (OpenAI, Anthropic, Workers AI) inferred from model name

### Virtual Key Management

- Issue scoped virtual keys to users and teams — no direct provider key exposure
- Per-key budget limits with daily / weekly / monthly reset cycles
- Per-key model allowlists
- Real-time spend tracking with automatic budget enforcement

### Zero Data Retention

- Telemetry is span-based (token counts, latency, model, status) — no prompt or completion content stored
- Privacy Mode enforced: usage metrics only

### OpenTelemetry Observability

- OTLP span ingestion at `/v1/traces`
- Dashboard with spend, active users (30d), and span logs
- Per-user and per-team activity profiles
- Diff drilldowns via `tool.output.diff`
- Vendor/service rollups (ToolProfile)

### Team Collaboration & RBAC

- `admin / manager / user` roles
- Team-scoped API tokens
- User and team management with profiles

### Billing

- Stripe Pay-as-you-go with metered usage (AI proxy cost, managed keys, telemetry events)
- 14-day free trial, subscription lifecycle webhooks

### Data Loss Prevention

- Scans AI requests for sensitive patterns (credit cards, SSNs, government IDs)
- Configurable action: block or flag

## Architecture

```
[ Agent / App / Claude Code / IDE ]
              │
              ▼
   Virtual Key Auth + Budget Check
              │
              ▼
  Cloudflare AI Gateway (per-customer)
              │
         ┌────┴────┐
         ▼         ▼
      OpenAI    Anthropic  (Workers AI, ...)
              │
              ▼
  Token Usage Extraction (SSE + JSON)
              │
         ┌────┴────────────┐
         ▼                 ▼
   GatewayEvent       Stripe Meter
   (Postgres)         (gateway_events)
              │
              ▼
   OTel Span → /v1/traces → Dashboard
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Stripe account
- Cloudflare account (for AI Gateway provisioning)

### Setup

1. Clone the repo

   ```sh
   git clone https://github.com/your-org/stereos
   cd stereos
   ```

2. Install dependencies

   ```sh
   npm install
   ```

3. Set up your `.env` file

   ```sh
   cp .env.example .env
   # Fill in DATABASE_URL, STRIPE_SECRET_KEY, CF_ACCOUNT_ID, CF_AI_GATEWAY_API_TOKEN
   ```

4. Run migrations and start

   ```sh
   npm run db:migrate
   npm run dev
   ```

API runs at `http://localhost:3000` · Web UI at `http://localhost:5173`

## Usage

Point any OpenAI-compatible client at Stereos and use a virtual key:

```bash
curl https://api.trystereos.com/v1/chat/completions \
  -H "Authorization: Bearer stereos_<your_virtual_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4-6",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'
```

Provider prefix is optional — `anthropic/claude-sonnet-4-6` and `claude-sonnet-4-6` both work.

### Supported Models

| Provider | Models |
|----------|--------|
| OpenAI | `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `o3`, `o4-mini`, and more |
| Anthropic | `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`, and more |
| Cloudflare Workers AI | `@cf/` and `@hf/` models |

### Provision a Gateway & Create Keys

```bash
# Provision a Cloudflare AI Gateway for your customer
curl -X POST https://api.trystereos.com/v1/ai/gateway/provision \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create a user key with a $50 monthly budget
curl -X POST https://api.trystereos.com/v1/ai/keys/user \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "alice-key",
    "customer_id": "CUSTOMER_UUID",
    "user_id": "USER_UUID",
    "budget_usd": "50.00",
    "budget_reset": "monthly",
    "allowed_models": ["anthropic/claude-sonnet-4-6", "openai/gpt-4o"]
  }'
```

### OTel Ingestion

Send OTLP/JSON spans directly to Stereos:

```bash
curl -X POST https://api.trystereos.com/v1/traces \
  -H "Authorization: Bearer YOUR_BROADCAST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{ "resourceSpans": [...] }'
```

Or configure your OpenRouter Broadcast endpoint to push spans automatically:

- **Endpoint:** `https://api.trystereos.com/v1/traces`
- **Privacy Mode:** enabled (token usage, cost, timing — no prompts/completions)

## Project Structure

```
stereos/
├── apps/
│   ├── api/                 # Hono API server (TypeScript)
│   │   └── src/
│   │       ├── lib/         # Stripe, auth, telemetry
│   │       └── routes/      # ai-proxy, ai-keys, traces, users, teams...
│   └── web/                 # React 19 + Vite frontend
│       └── src/
│           ├── components/
│           └── pages/
├── packages/
│   └── shared/              # Drizzle schema + DB client
├── drizzle/                 # Migrations
└── openapi.yaml             # OpenAPI 3.1 spec
```

## Built With

- [Hono](https://hono.dev) — API server
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) — per-customer AI proxy
- [React 19](https://react.dev) + [React Router 7](https://reactrouter.com) — frontend
- [Drizzle ORM](https://orm.drizzle.team) + PostgreSQL — database
- [Better Auth](https://www.better-auth.com) — authentication
- [Stripe](https://stripe.com) — metered billing
- [OpenTelemetry](https://opentelemetry.io) — observability
- [Resend](https://resend.com) — email

## License

See [LICENSE.md](./LICENSE.md).
