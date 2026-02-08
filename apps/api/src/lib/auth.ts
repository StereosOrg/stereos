import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
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
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
      usePlural: true,
    }),
    account: {
      fields: {
        providerId: 'provider',
        providerAccountId: 'accountId',
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
    emailVerification: {
      sendVerificationEmail: env.sendVerificationEmail ?? (async ({ user, url }) => {
        const { sendVerificationEmail: send } = await import('./email.js');
        void send(user.email, url);
      }),
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
