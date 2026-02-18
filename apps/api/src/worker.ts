import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createDb } from '@stereos/shared/db';
import { createAuth } from './lib/auth.js';
import { sendEmailViaResendFetch, VERIFICATION_EMAIL_HTML, MAGIC_LINK_EMAIL_HTML } from './lib/resend-fetch.js';
import type { AppVariables } from './types/app.js';
import type { AuthType } from './lib/auth.js';
import type { Database } from '@stereos/shared/db';
import authRouter from './routes/auth.js';
import billingRouter from './routes/billing.js';
import usersRouter from './routes/users.js';
import onboardingRouter from './routes/onboarding.js';
import invitesRouter from './routes/invites.js';
import telemetryRouter from './routes/telemetry.js';
import teamsRouter from './routes/teams.js';
import partnersRouter from './routes/partners.js';
import aiKeysRouter from './routes/ai-keys.js';
import aiProxyRouter from './routes/ai-proxy.js';
import providerKeysRouter from './routes/provider-keys.js';
import dlpRouter from './routes/dlp.js';
import logpushRouter from './routes/logpush.js';

// Cache db and auth per isolate to avoid expensive re-initialization on every request.
// Env bindings are stable within a deployment, so we key by DATABASE_URL to detect changes.
let _cachedDb: Database | null = null;
let _cachedAuth: AuthType | null = null;
let _cachedDbUrl: string | null = null;

type Env = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  BASE_URL: string;
  TRUSTED_ORIGINS?: string;
  /** Frontend origin for magic link email (e.g. https://stereos.netlify.app). If unset, first TRUSTED_ORIGINS is used. */
  FRONTEND_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OPENROUTER_BROADCAST_SECRET?: string;
  CF_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_API_TOKEN?: string;
  /** Stripe price/meter overrides for dev/test mode (set in wrangler.toml [vars] or secrets) */
  STRIPE_PRICE_TELEMETRY_EVENTS?: string;
  STRIPE_PRICE_FLAT_MONTHLY?: string;
  STRIPE_PRICE_MANAGED_KEYS?: string;
  STRIPE_METER_TELEMETRY_EVENTS?: string;
  STRIPE_METER_MANAGED_KEYS?: string;
  LOGPUSH_PUBLIC_KEY?: string;
  LOGPUSH_PRIVATE_KEY?: string;
  LOGPUSH_INGEST_SECRET?: string;
};

function normalizeOrigin(o: string): string {
  const t = o.trim();
  if (!t) return t;
  if (!/^https?:\/\//i.test(t)) return `https://${t}`;
  return t;
}

function getAllowedOrigin(c: { req: { header: (name: string) => string | undefined }; env: Env }): string {
  const origin = (c.req.header('Origin') ?? '').trim();
  const allowed = (c.env.TRUSTED_ORIGINS ?? c.env.BASE_URL ?? '')
    .split(',')
    .map((o: string) => normalizeOrigin(o))
    .filter(Boolean);
  if (allowed.length === 0) return '*';
  const normalized = normalizeOrigin(origin);
  const isAllowed = origin && allowed.some((a) => a === normalized || a === origin);
  return isAllowed ? origin : allowed[0];
}

function addCorsToResponse(c: { req: { header: (name: string) => string | undefined }; env: Env; res: Response }, res: Response): Response {
  if (res.headers.get('Access-Control-Allow-Origin')) return res;
  const acao = getAllowedOrigin(c);
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', acao);
  h.set('Access-Control-Allow-Credentials', 'true');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Provider-Key');
  h.set('Access-Control-Expose-Headers', 'set-auth-token');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('*', logger());
// Run first so we run last: after next() we add CORS to any response that's missing it (e.g. auth returns raw Response).
// If next() throws, return 500 with CORS so the browser can read the error.
app.use('*', async (c, next) => {
  try {
    await next();
    c.res = addCorsToResponse(c, c.res);
  } catch (err) {
    console.error('[Worker CORS wrap]', err);
    c.res = addCorsToResponse(c, c.json({ error: 'Internal Server Error' }, 500));
  }
});
app.use('*', cors({
  origin: (origin, c) => getAllowedOrigin(c),
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Provider-Key'],
  exposeHeaders: ['set-auth-token'],
  credentials: true,
}));

// Inject db and auth, cached per isolate to stay within CPU time limits.
app.use('*', async (c, next) => {
  try {
    if (!c.env.DATABASE_URL || !c.env.BETTER_AUTH_SECRET) {
      return addCorsToResponse(c, c.json({ error: 'Service Unavailable', message: 'Server configuration error' }, 503));
    }
    // Reuse cached instances within the same Worker isolate.
    if (!_cachedDb || _cachedDbUrl !== c.env.DATABASE_URL) {
      _cachedDb = createDb(c.env.DATABASE_URL);
      _cachedDbUrl = c.env.DATABASE_URL;
      _cachedAuth = null;
    }
    if (!_cachedAuth) {
      const apiKey = c.env.RESEND_API_KEY;
      const from = c.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
      _cachedAuth = createAuth(_cachedDb, {
        baseURL: c.env.BASE_URL,
        trustedOrigins: c.env.TRUSTED_ORIGINS,
        frontendUrl: c.env.FRONTEND_URL,
        secret: c.env.BETTER_AUTH_SECRET,
        sendVerificationEmail: async ({ user, url }) => {
          if (apiKey) {
            const result = await sendEmailViaResendFetch({
              apiKey,
              from,
              to: user.email,
              subject: 'Verify your STEREOS email',
              html: VERIFICATION_EMAIL_HTML(url),
            });
            if (result.error) console.error('[Auth] Resend verification email failed:', result.error);
          } else {
            console.warn('[Auth] RESEND_API_KEY not set; verification link for', user.email, ':', url);
          }
        },
        sendMagicLinkEmail: async ({ email, url }) => {
          if (apiKey) {
            const result = await sendEmailViaResendFetch({
              apiKey,
              from,
              to: email,
              subject: 'Sign in to STEREOS',
              html: MAGIC_LINK_EMAIL_HTML(url),
            });
            if (result.error) console.error('[Auth] Resend magic link email failed:', result.error);
          } else {
            console.warn('[Auth] RESEND_API_KEY not set; magic link for', email, ':', url);
          }
        },
        GITHUB_CLIENT_ID: c.env.GITHUB_CLIENT_ID,
        GITHUB_CLIENT_SECRET: c.env.GITHUB_CLIENT_SECRET,
        GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
      });
    }
    c.set('db', _cachedDb);
    c.set('auth', _cachedAuth);
    await next();
  } catch (err) {
    console.error('[Worker db/auth init]', err);
    return addCorsToResponse(c, c.json({ error: 'Service Unavailable', message: 'Initialization failed' }, 503));
  }
});

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: 'cloudflare-workers',
  })
);

app.route('/v1', authRouter);
app.route('/v1', billingRouter);
app.route('/v1', usersRouter);
app.route('/v1', onboardingRouter);
app.route('/v1', invitesRouter);
app.route('/v1', telemetryRouter);
app.route('/v1', teamsRouter);
app.route('/v1', partnersRouter);
app.route('/v1', aiKeysRouter);
app.route('/v1', aiProxyRouter);
app.route('/v1', providerKeysRouter);
app.route('/v1', dlpRouter);
app.route('/v1', logpushRouter);

app.notFound((c) => {
  if (c.req.path.startsWith('/v1/') || c.req.path === '/health') {
    return c.json({ error: 'Not Found' }, 404);
  }
  return c.json({ error: 'Not Found' }, 404);
});

// Error handler — check Cloudflare Real-time Logs for full error. Add CORS so browser can read the response.
app.onError((err, c) => {
  console.error('[Worker error]', err?.message ?? err, err?.stack);
  const res = c.json({ error: 'Internal Server Error' }, 500);
  return addCorsToResponse(c, res);
});

// Wrap so any uncaught rejection returns a response with CORS (browser can read it).
function corsOriginFromRequest(req: Request, env: Env): string {
  const origin = (req.headers.get('Origin') ?? '').trim();
  const allowed = (env.TRUSTED_ORIGINS ?? env.BASE_URL ?? '')
    .split(',')
    .map((o: string) => normalizeOrigin(o))
    .filter(Boolean);
  if (allowed.length === 0) return '*';
  const normalized = normalizeOrigin(origin);
  const isAllowed = origin && allowed.some((a) => a === normalized || a === origin);
  return isAllowed ? origin : allowed[0];
}

function addCorsToResponseStandalone(req: Request, env: Env, res: Response): Response {
  if (res.headers.get('Access-Control-Allow-Origin')) return res;
  const acao = corsOriginFromRequest(req, env);
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', acao);
  h.set('Access-Control-Allow-Credentials', 'true');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Provider-Key');
  h.set('Access-Control-Expose-Headers', 'set-auth-token');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    try {
      const res = await app.fetch(request, env, ctx as Parameters<typeof app.fetch>[2]);
      return addCorsToResponseStandalone(request, env, res);
    } catch (err) {
      console.error('[Worker fetch error]', err);
      const res = new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
      return addCorsToResponseStandalone(request, env, res);
    }
  },
};
