// Context types for Hono application

import type { Database } from '@stereos/shared/db';
import type { AuthType } from '../lib/auth.js';
import { Customer } from '@stereos/shared/schema';
import { User } from '@stereos/shared/schema';

export interface HonoContext {
  get(key: 'user'): User | undefined;
  get(key: 'customer'): Customer | undefined;
  get(key: 'apiToken'): any | undefined;
  get(key: 'db'): Database;
  get(key: 'auth'): AuthType;
  set(key: string, value: any): void;
  env?: unknown;
  req: {
    raw: {
      headers: Headers;
    };
    header(name: string): string | undefined;
    path: string;
    param(name: string): string;
    query(name: string): string;
    valid<T>(type: 'json'): T;
  };
  res: {
    json(data: any, status?: number): void;
    html(data: string): void;
    redirect(url: string, status?: number): void;
  };
}

// Generic context type for middleware
export type HonoMiddlewareContext = HonoContext;

// Context types for specific middleware
export type RequireAuthContext = HonoContext;
export type RequireOnboardingContext = HonoContext;
export type RequirePaymentContext = HonoContext;
export type AuthMiddlewareContext = HonoContext;

// Extend Hono context with Hono methods
export interface HonoContext {
  redirect(url: string, status?: number): void;
  json(data: any, status?: number): void;
}

// Type guards for context
export function isUserContext(c: HonoContext): c is HonoContext {
  return c.get('user') !== undefined;
}

export function isCustomerContext(c: HonoContext): c is HonoContext {
  return c.get('customer') !== undefined;
}

export function isApiTokenContext(c: HonoContext): c is HonoContext {
  return c.get('apiToken') !== undefined;
}