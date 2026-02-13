import type { Database } from '@stereos/shared/db';
import type { AuthType } from '../lib/auth.js';
import type { User, Customer } from '@stereos/shared/schema';

export type AppVariables = {
  db: Database;
  auth: AuthType;
  apiToken?: unknown;
  providerKey?: string;
  user?: User;
  customer?: Customer;
  session?: { user: { id: string; email?: string; name?: string; image?: string }; [k: string]: unknown };
  adminUser?: { id: string; role: string; [k: string]: unknown };
};
