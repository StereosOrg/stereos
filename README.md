# Stereos - Collaboration-First LLM Telemetry

Stereos is a collaboration‑first platform that captures **LLM spans** (OTLP/GenAI telemetry) and turns them into team‑level visibility, user profiles, and diff drilldowns. It focuses on what happened, who did it, and how it changed the code.

## Architecture

```
[ Agent / App / Proxy ]
          |
          v
   Hono Ingest API  ──► Spans Store (Postgres)
          |
          v
   Query API  ──► React Client (RCC)
          |
          v
  Auth (Better Auth) + Billing (Stripe Pay‑as‑you‑go)
```

## Core Principles

- **Spans-first**: All data is derived from OTLP spans (trace + metrics)
- **Collaboration-ready**: Users + Teams with admin/manager roles
- **Auditability**: Diff drilldowns via `tool.output.diff`
- **Simple ingestion**: OTLP JSON ingest + chat‑proxy spans
- **RBAC**: admin / manager / user

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Stripe account (for billing)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd stereos

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your values

# Run database migrations
npm run db:migrate

# Start development servers
npm run dev
```

The API will be available at `http://localhost:3000` and the web UI at `http://localhost:5173`.

### Testing

```bash
# Run all tests (requires npm install)
npm run test
```

Tests include:
- **Unit tests**: `vendor-map` (canonicalizeVendor, flattenOtelAttributes, isLLMTool)
- **API tests**: Health, 404, onboarding status, auth-protected routes (401), traces endpoint

### OpenAPI Schema

The API is documented with OpenAPI 3.1 at `openapi.yaml`. Use it with Swagger UI, Redoc, or code generators.

```bash
# Validate schema (with openapi-generator or swagger-cli)
npx @redocly/cli lint openapi.yaml
```

## API Usage

### Authentication

All endpoints use **Bearer tokens** (no cookies). Tokens are **team‑scoped** for admins/managers and always force a `team_id` on spans.

**1. Get your customer ID** (from the app Settings or via API):

```bash
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:3000/v1/customers/me
```

**2. Create an API token** (admin/manager only; must include `team_id`):

```bash
curl -X POST http://localhost:3000/v1/tokens \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"YOUR_CUSTOMER_ID","team_id":"YOUR_TEAM_ID","name":"CLI"}'
```

Copy the `token` value from the response (it starts with `sk_`). Use it as `Authorization: Bearer sk_...`.

**Important:** For curl line continuation, there must be **no space** after the backslash. Or use a one‑liner.

### Trace Ingestion (OpenRouter Broadcast)

Spans are received via **OpenRouter Broadcast**. Clients use Stereos-provisioned OpenRouter keys and pass `user` (Stereos user ID) in the request body. OpenRouter sends traces to Stereos with Privacy Mode (no prompts/completions).

**1. Provision OpenRouter key** (admin/manager only):

```bash
curl -X POST http://localhost:3000/v1/keys \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Team Key","customer_id":"YOUR_CUSTOMER_ID","user_id":"USER_ID","limit":100,"limit_reset":"monthly"}'
```

Copy the `key` from the response. Use it with OpenRouter.

**2. Configure OpenRouter Broadcast**

In [OpenRouter Settings > Observability](https://openrouter.ai/settings/observability), enable Broadcast and add OpenTelemetry Collector:
- **Endpoint:** `https://api.trystereos.com/v1/traces`
- **Headers:** `{ "Authorization": "Bearer <OPENROUTER_BROADCAST_SECRET>" }`
- **Privacy Mode:** enabled (excludes prompt/completion; keeps token usage, cost, timing)

**3. Client usage**

When calling OpenRouter, pass `user: "<stereos_user_id>"` in the request body so Stereos can attribute usage. Optionally pass `team_id` via trace metadata for team-level dashboards:

```json
{
  "model": "openai/gpt-4o",
  "messages": [...],
  "user": "<stereos_user_id>",
  "trace": { "metadata": { "team_id": "<stereos_team_id>" } }
}
```

If `team_id` is omitted, Stereos derives it from the user's team membership when possible.

### User Management (Admin Only)

```bash
# List all users (admin only)
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:3000/v1/users

# Get detailed user profile (admin only)
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:3000/v1/users/USER_ID/profile

# Update user role (admin only)
curl -X PATCH http://localhost:3000/v1/users/USER_ID/role \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"manager"}'

# Assign team (admin only)
curl -X PATCH http://localhost:3000/v1/users/USER_ID/team \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"team_id":"TEAM_ID"}'
```

### Team Management (Admin Only)

```bash
# List teams
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:3000/v1/teams

# Create team (must specify manager/admin user)
curl -X POST http://localhost:3000/v1/teams \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alpha","manager_user_id":"USER_ID"}'

# Team profile metrics
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:3000/v1/teams/TEAM_ID/profile
```

## Project Structure

```
stereos/
├── apps/
│   ├── api/                 # Hono API server
│   │   ├── src/
│   │   │   ├── lib/         # Auth, Stripe config
│   │   │   ├── routes/      # API routes
│   │   │   └── index.ts     # Server entry
│   │   └── package.json
│   └── web/                 # React frontend
│       ├── src/
│       │   ├── components/  # React components
│       │   ├── pages/       # Page components
│       │   └── main.tsx     # App entry
│       └── package.json
├── packages/
│   └── shared/              # Shared types & DB schema
│       ├── src/
│       │   ├── schema.ts    # Drizzle schema
│       │   └── db.ts        # Database client
│       └── package.json
├── drizzle/                 # Database migrations
│   └── migrations/
├── .env.example
├── package.json
└── README.md
```

## Database Schema (High Level)

- **users** - Better Auth users with `role: admin | manager | user`
- **teams** - Team records with `profile_pic`
- **team_members** - Membership (requires at least one manager/admin per team)
- **apiTokens** - Team‑scoped API tokens
- **TelemetrySpan** - OTLP spans
- **TelemetryMetric** - OTLP metrics
- **ToolProfile** - Vendor/service rollups

## UI Highlights

- **Dashboard**: spans‑based totals + most active user (30d)
- **Users**: role/team assignment + individual profiles
- **Teams**: admin‑only creation + team profiles
- **Diff Drilldowns**: view `tool.output.diff` per span

