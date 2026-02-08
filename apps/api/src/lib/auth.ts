import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { magicLink } from 'better-auth/plugins/magic-link';
import { createAuthMiddleware } from 'better-auth/api';
import type { Database } from '@stereos/shared/db';
import * as schema from '@stereos/shared/schema';

export interface AuthEnv {
  baseURL?: string;
  basePath?: string;
  trustedOrigins?: string;
  secret?: string;
  /** Override for Workers where Resend may not load; if set, used instead of default email sender */
  sendVerificationEmail?: (params: { user: { email: string }; url: string }) => void | Promise<void>;
  /** Send magic link email (Workers: pass resend-fetch based sender) */
  sendMagicLinkEmail?: (params: { email: string; url: string; token: string }) => void | Promise<void>;
  /** Resend API key for magic link emails in Workers */
  RESEND_API_KEY?: string;
  /** Resend from address */
  RESEND_FROM_EMAIL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

function getEnv(): AuthEnv {
  if (typeof process !== 'undefined' && process.env) {
    return {
      baseURL: process.env.BETTER_AUTH_URL || process.env.BASE_URL || 'http://localhost:3000',
      trustedOrigins: process.env.TRUSTED_ORIGINS,
      secret: process.env.BETTER_AUTH_SECRET,
      GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  return {};
}

export function createAuth(db: Database, envOverrides?: AuthEnv) {
  const env = { ...getEnv(), ...envOverrides };
  const trusted = env.trustedOrigins?.split(',').map((o) => o.trim()).filter(Boolean) || ['http://localhost:5173'];
  // Build the magic link sender. Workers pass a custom callback; Node falls back to email.ts.
  const sendMagicLinkFn = env.sendMagicLinkEmail
    ? async (data: { email: string; url: string; token: string }) => {
        await env.sendMagicLinkEmail!(data);
      }
    : async (data: { email: string; url: string; token: string }) => {
        const { sendMagicLinkEmail: send } = await import('./email.js');
        await send(data.email, data.url);
      };

  return betterAuth({
    secret: env.secret,
    plugins: [
      bearer(),
      magicLink({
        sendMagicLink: sendMagicLinkFn,
        expiresIn: 600, // 10 minutes
      }),
    ],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
      usePlural: true,
    }),
    account: {
      fields: {
        providerId: 'provider',
        accountId: 'accountId',
      },
    },
    session: {
      fields: {
        expiresAt: 'expires',
        token: 'sessionToken',
      },
    },
    baseURL: env.baseURL || 'http://localhost:3000',
    basePath: '/v1/auth',
    trustedOrigins: trusted,
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: {
        sameSite: 'none',
        secure: true,
      },
    },
    emailAndPassword: {
      enabled: false,
    },
  });
}

export type AuthType = ReturnType<typeof createAuth>;
