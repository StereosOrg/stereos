import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
/**
 * Create a Drizzle DB instance using Neon's serverless driver.
 * Use this in Workers (pass c.env.DATABASE_URL) and in Node (pass process.env.DATABASE_URL).
 */
export function createDb(connectionString) {
    const sql = neon(connectionString);
    return drizzle({ client: sql, schema });
}
// Default instance for Node when DATABASE_URL is set at process load time (e.g. dev server).
// Workers must not use this; they inject db via context from c.env.DATABASE_URL.
const _defaultConnection = typeof process !== 'undefined' && process.env?.DATABASE_URL
    ? process.env.DATABASE_URL
    : undefined;
export const db = _defaultConnection ? createDb(_defaultConnection) : null;
//# sourceMappingURL=db.js.map