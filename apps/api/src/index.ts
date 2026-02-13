import './load-env.js';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { Hono } from 'hono';
import { createDb } from '@stereos/shared/db';
import { createAuth } from './lib/auth.js';
import type { AppVariables } from './types/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import authRouter from './routes/auth.js';
import chatCompletionsRouter from './routes/chat-completions.js';
import billingRouter from './routes/billing.js';
import usersRouter from './routes/users.js';
import onboardingRouter from './routes/onboarding.js';
import invitesRouter from './routes/invites.js';
import telemetryRouter from './routes/telemetry.js';
import teamsRouter from './routes/teams.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/stereos';
const db = createDb(connectionString);
const auth = createAuth(db);

const app = new Hono<{ Variables: AppVariables }>();

app.use('*', logger());
app.use('*', cors({
  origin: process.env.TRUSTED_ORIGINS?.split(',')?.map((o) => o.trim()) || ['http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Provider-Key'],
  exposeHeaders: ['set-auth-token'],
  credentials: true,
}));

app.use('*', async (c, next) => {
  c.set('db', db);
  c.set('auth', auth);
  await next();
});

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.route('/v1', authRouter);
app.route('/v1', chatCompletionsRouter);
app.route('/v1', billingRouter);
app.route('/v1', usersRouter);
app.route('/v1', onboardingRouter);
app.route('/v1', invitesRouter);
app.route('/v1', telemetryRouter);
app.route('/v1', teamsRouter);

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Start server when run directly (Node dev); Workers use worker.ts
if (typeof process !== 'undefined') {
  const port = parseInt(process.env.PORT || '3000', 10);
  console.log(`🚀 STEREOS API on http://localhost:${port}`);
  serve({
    fetch: app.fetch,
    port,
  });
}

export default app;
