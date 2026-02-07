# STEREOS - LLM Provenance Platform

An engineering-first platform that records **how code came to exist**, not just usage metrics. The system captures structured cognition events from agents and partner tools (Cursor, Kilo Code, etc.) and links them to Git artifacts.

## Architecture

```
[ Agent / Partner Tool ]
          |
          v
   Hono Ingest API  ──► Event Store (Append‑only)
          |
          v
    Provenance Graph Builder
          |
          v
   Query API  ──► React Client (RCC)
          |
          v
  Auth (Better Auth) + Billing (Stripe Pay-as-you-go)
```

## Core Principles

- **Write-optimized, read-derived**: Agents are the only provenance source
- **Immutable audit trail**: All events are append-only
- **Git-native**: Every event links to commits, branches, and repos
- **Engineering-first**: Answers "why is this here?" from agent data
- **RBAC**: Simple admin/user role system with user activity tracking

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

Event and provenance endpoints use **API tokens** (Bearer), not session cookies. Create a token after signing in:

**1. Get your customer ID** (e.g. from the app Settings, or call when logged in with a session cookie):

```bash
curl -s -H "Cookie: YOUR_SESSION_COOKIE" http://localhost:3000/v1/customers/me | jq -r '.customer.id'
```

**2. Create an API token** (use the `customer_id` from step 1):

```bash
curl -X POST http://localhost:3000/v1/tokens \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"YOUR_CUSTOMER_ID","name":"CLI"}'
```

Copy the `token` value from the response (it starts with `sk_`). Use it as `Authorization: Bearer sk_...`.

**Important:** For curl line continuation, there must be **no space** after the backslash. Or use a one-liner.

### Ingesting Events

One-liner (copy-paste safe; replace `YOUR_API_TOKEN`):

```bash
curl -X POST http://localhost:3000/v1/events -H "Authorization: Bearer YOUR_API_TOKEN" -H "Content-Type: application/json" -d '{"event_type":"agent_action","actor_type":"agent","actor_id":"cursor-v1","tool":"refactor","intent":"refactor auth module","repo":"my-repo","commit":"abc123"}'
```

`timestamp` is optional (defaults to now). Example with timestamp and optional fields:

```bash
curl -X POST http://localhost:3000/v1/events \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"agent_action","actor_type":"agent","actor_id":"cursor-v1","tool":"refactor","intent":"refactor authentication module","model":"gpt-4","files_written":["src/auth.ts"],"timestamp":"2026-02-07T12:00:00Z","repo":"my-project","branch":"main","commit":"abc123"}'
```

### Recording Outcomes

```bash
curl -X POST http://localhost:3000/v1/events \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "outcome",
    "original_event_id": "event-uuid-here",
    "status": "accepted",
    "linked_commit": "def456"
  }'
```

### Querying Provenance

```bash
# By commit
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:3000/v1/provenance/by-commit/abc123

# By file
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  "http://localhost:3000/v1/provenance/by-file?path=src/auth.ts&repo=my-project"

# Search events
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  "http://localhost:3000/v1/events/search?actor_id=cursor-v1&limit=10"
```

### User Management (Admin Only)

```bash
# List all users (admin only)
curl -H "Cookie: session=YOUR_SESSION_COOKIE" \
  http://localhost:3000/v1/users

# Get detailed user profile with usage history (admin only)
curl -H "Cookie: session=YOUR_SESSION_COOKIE" \
  http://localhost:3000/v1/users/USER_ID/profile

# Update user role (admin only)
curl -X PATCH http://localhost:3000/v1/users/USER_ID/role \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}'

# Get current user profile
curl -H "Cookie: session=YOUR_SESSION_COOKIE" \
  http://localhost:3000/v1/me
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

## Database Schema

### Core Tables

- **users** - Better Auth user accounts with role column (admin/user)
- **partners** - Partner/tool integrations
- **customers** - Customer accounts with Stripe linkage
- **apiTokens** - API authentication tokens
- **usageEvents** - Billing/usage tracking
- **provenanceEvents** - Core provenance events (linked to users via user_id)
- **artifactLinks** - Git commit/branch/file links
- **outcomes** - Event acceptance/rejection status

### Views

- **user_activity_summary** - Aggregated user activity statistics

### Materialized Views

- **partner_sourced_revenue** - Monthly revenue by partner (20% revenue share)

## Billing

STEREOS uses Stripe's pay-as-you-go billing:

- **Agent actions**: $0.01 per event
- **Outcomes**: $0.005 per event
- **Storage**: $0.10 per GB

Partners receive a 20% revenue share from their referred customers.

## Development

```bash
# Run linting
npm run lint

# Type checking
npm run typecheck

# Database studio
npm run db:studio

# Generate migrations
npm run db:generate
```

## Security

- No raw prompt text stored by default
- Immutable audit trail via append-only events
- TLS + token auth required
- API tokens with scoped permissions
- Optional event signing for high-trust environments

## Role-Based Access Control (RBAC)

STEREOS implements a simple two-role system:

### Roles

- **Admin**: Full access to all features, including user management and viewing other users' profiles
- **User**: Standard access to their own provenance data and events

### User Management

The first user to sign up is automatically assigned the `admin` role. All subsequent users are assigned the `user` role by default.

Admins can:
- View a list of all users
- View detailed profiles of any user with full usage history
- Change user roles (admin/user)
- View aggregated user activity statistics

### User Profiles

Each user profile displays:
- Basic user information (name, email, role, membership date)
- Total provenance events generated
- Active days and activity patterns
- Monthly usage breakdown with cost tracking
- Recent events with status
- Most frequently modified files
- Partner and billing status

Access user profiles via the `/users` page (admin only) or programmatically via the API.

## License

[Your License Here]

## Contributing

[Contributing Guidelines]

## Support

For support, email [support email] or open an issue on GitHub.
