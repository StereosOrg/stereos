# Deploying STEREOS API and Frontend

## Prerequisites

- **PostgreSQL** database (e.g. [Neon](https://neon.tech), [Supabase](https://supabase.com), or self‑hosted).
- **Stripe** account and keys (for billing).
- **Better Auth** secret and optional OAuth apps (GitHub/Google).
- **Resend** (or similar) for transactional email if you use email/password sign‑up.

---

## 1. Database

1. Create a Postgres database and note the connection string.
2. Run migrations against it (from your machine or CI):

   ```bash
   DATABASE_URL="postgresql://..." npm run db:migrate
   # If drizzle-kit migrate doesn't run all migrations, run the scripts for 003–019:
   bun run db:migrate:019
   # etc. as needed
   ```

---

## 2. Deploy the API

The API is a Hono app that can run on **Node** or **Cloudflare Workers**. The repo uses **Postgres** via `DATABASE_URL`; Workers need that URL in secrets (and a Postgres-compatible driver).

### Option A: Node (Railway, Render, Fly.io, etc.)

1. **Build** (from repo root). The API depends on `packages/shared`; build it first, then the API:

   ```bash
   cd packages/shared && npm run build && cd ../..
   npm run build:api
   ```

2. **Run** the API:

   ```bash
   cd apps/api && node dist/index.js
   ```

   Or use the root script:

   ```bash
   npm run build:api
   node apps/api/dist/index.js
   ```

   Set env in the host (e.g. Railway/Render dashboard):

   - `DATABASE_URL` – Postgres connection string
   - `PORT` – e.g. `3000`
   - `TRUSTED_ORIGINS` – comma-separated frontend origins (e.g. `https://app.yourdomain.com`)
   - `BETTER_AUTH_SECRET`
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (if using email sign-up)
   - Optional: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, etc.

3. **Webhook**: Point Stripe webhook URL to `https://your-api-host/v1/webhooks/stripe`.

### Option B: Cloudflare Workers

1. **Wrangler**: In `wrangler.toml` set `BASE_URL` and `TRUSTED_ORIGINS` (comma-separated).
2. **Secrets** (set in dashboard or via CLI):

   ```bash
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler secret put STRIPE_PRICE_ID
   # RESEND_API_KEY, RESEND_FROM_EMAIL, etc. as needed
   ```

3. **Deploy**:

   ```bash
   npx wrangler deploy
   ```

   Note: The app uses `process.env.DATABASE_URL` in `packages/shared`; in Workers, env is on `c.env`. If the worker entry does not inject `c.env` into the DB layer, you may need to adapt the shared DB init for Workers (e.g. pass `c.env.DATABASE_URL` into the Postgres client).

---

## 3. Deploy the Frontend (Netlify)

1. **Build** (from repo root):

   ```bash
   npm run build:web
   ```

   Or in Netlify: set **Base directory** to `apps/web` and build command to `npm run build` (see `apps/web/netlify.toml`).

2. **Environment variables** (Netlify dashboard → Site settings → Environment variables):

   - `VITE_API_URL` – your API base URL (e.g. `https://your-api.railway.app` or `https://stereos.your-subdomain.workers.dev`).
   - `VITE_STRIPE_PUBLISHABLE_KEY` – Stripe publishable key (for start-trial/checkout).

3. **Publish**: Netlify will publish the `apps/web/dist` output (or `dist` when base dir is `apps/web`).

4. **CORS**: Add the Netlify site URL (e.g. `https://your-site.netlify.app`) to the API’s `TRUSTED_ORIGINS`.

---

## 4. Post-deploy checklist

- [ ] Database migrations applied (including 019 if you use `diff_content`).
- [ ] API health: `curl https://your-api-url/health`
- [ ] Frontend loads and can reach API (check browser network tab for `/v1/` or `/auth/`).
- [ ] Stripe webhook points to `https://your-api-url/v1/webhooks/stripe`.
- [ ] Better Auth callback URL uses your frontend origin; OAuth redirect URIs include your frontend (and API if required).
- [ ] Extension `stereos.baseUrl` / dashboard URL point to your deployed API and frontend if needed.

---

## Quick reference

| What        | Command / setting |
|------------|--------------------|
| Build API  | `npm run build:api` (from root; builds `apps/api` and deps) |
| Build web  | `npm run build:web` or from `apps/web`: `npm run build` |
| Run API    | `node apps/api/dist/index.js` with env set |
| Migrations | `DATABASE_URL="..." npm run db:migrate` + any `db:migrate:0XX` scripts |
| Netlify    | Base dir: `apps/web`, build: `npm run build`, publish: `dist` |
| Workers    | `npx wrangler deploy`; secrets for `DATABASE_URL`, Stripe, Auth, etc. |
