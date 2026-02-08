import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
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
  return betterAuth({
    secret: env.secret,
    plugins: [bearer()],
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
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        // After email verification: redirect to frontend WITH session token in URL so cross-origin
        // (e.g. Netlify → Workers) can store it and use Bearer auth when cookies are blocked.
        if (ctx.path !== '/verify-email') return;
        const newSession = ctx.context.newSession as { session?: { token?: string }; token?: string; user?: unknown } | undefined;
        const token = newSession?.session?.token ?? newSession?.token;
        const callbackURL = ctx.query?.callbackURL as string | undefined;
        if (token && callbackURL) {
          const url = new URL(callbackURL);
          url.searchParams.set('session_token', token);
          throw ctx.redirect(url.toString());
        }
      }),
    },
    emailVerification: {
      sendVerificationEmail: env.sendVerificationEmail
        ? async (data: { user: { email: string }; url: string }) => {
            await env.sendVerificationEmail!({ user: data.user, url: data.url });
          }
        : async (data: { user: { email: string }; url: string }) => {
            const { sendVerificationEmail: send } = await import('./email.js');
            await send(data.user.email, data.url);
          },
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      requireEmailVerification: true,
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID || '',
        clientSecret: env.GITHUB_CLIENT_SECRET || '',
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID || '',
        clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      },
    },
  });
}

export type AuthType = ReturnType<typeof createAuth>;
