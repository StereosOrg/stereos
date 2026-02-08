import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createDb } from '@stereos/shared/db';
import { createAuth } from './lib/auth.js';
import { sendEmailViaResendFetch, VERIFICATION_EMAIL_HTML } from './lib/resend-fetch.js';
import type { AppVariables } from './types/app.js';
import eventsRouter from './routes/events.js';
import authRouter from './routes/auth.js';
import billingRouter from './routes/billing.js';
import usersRouter from './routes/users.js';
import onboardingRouter from './routes/onboarding.js';
import invitesRouter from './routes/invites.js';

type Env = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_PRICE_ID: string;
  STRIPE_WEBHOOK_SECRET: string;
  BASE_URL: string;
  TRUSTED_ORIGINS?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

function getAllowedOrigin(c: { req: Request; env: Env }): string {
  const origin = c.req.header('Origin') ?? '';
  const allowed = (c.env.TRUSTED_ORIGINS ?? c.env.BASE_URL ?? '')
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean);
  if (allowed.length === 0) return '*';
  return allowed.includes(origin) ? origin : allowed[0];
}

function addCorsToResponse(c: { req: Request; env: Env; res: Response }, res: Response): Response {
  if (res.headers.get('Access-Control-Allow-Origin')) return res;
  const acao = getAllowedOrigin(c);
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', acao);
  h.set('Access-Control-Allow-Credentials', 'true');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('*', logger());
// Run first so we run last: after next() we add CORS to any response that's missing it (e.g. auth returns raw Response).
app.use('*', async (c, next) => {
  await next();
  c.res = addCorsToResponse(c, c.res);
});
app.use('*', cors({
  origin: (origin, c) => getAllowedOrigin(c),
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Inject request-scoped db and auth (Neon serverless; required for Workers)
app.use('*', async (c, next) => {
  const db = createDb(c.env.DATABASE_URL);
  const apiKey = c.env.RESEND_API_KEY;
  const from = c.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const auth = createAuth(db, {
    baseURL: c.env.BASE_URL,
    trustedOrigins: c.env.TRUSTED_ORIGINS,
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
    GITHUB_CLIENT_ID: c.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: c.env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
  });
  c.set('db', db);
  c.set('auth', auth);
  await next();
});

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: 'cloudflare-workers',
  })
);

app.route('/v1', eventsRouter);
app.route('/v1', authRouter);
app.route('/v1', billingRouter);
app.route('/v1', usersRouter);
app.route('/v1', onboardingRouter);
app.route('/v1', invitesRouter);

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

// Export the handler for Cloudflare Workers
export default app;
