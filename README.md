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

### Ingesting Spans (OTLP JSON)

Send OTLP JSON to `/v1/traces`.

```bash
curl -X POST http://localhost:3000/v1/traces \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"my-app"}}]},"scopeSpans":[{"spans":[{"traceId":"abc","spanId":"def","name":"gen_ai.request","kind":3,"startTimeUnixNano":"1710000000000000000","endTimeUnixNano":"1710000000500000000","attributes":[{"key":"gen_ai.request.model","value":{"stringValue":"gpt-5"}}]}]}]}]}'
```

Stereos will extract:
- `user_id` from the API token
- `team_id` from the team‑scoped token
- `tool.output.diff` (when present) for diff drilldowns

### Chat Completions (Proxy)

The chat proxy writes GenAI spans automatically. Example:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_API_TOKEN' \
  -H 'X-Provider: openrouter' \
  -H 'X-Provider-Key: YOUR_PROVIDER_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-5","messages":[{"role":"user","content":"Hello"}]}'
```

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

