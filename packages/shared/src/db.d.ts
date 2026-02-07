import * as schema from './schema.js';
export type Database = ReturnType<typeof createDb>;
/**
 * Create a Drizzle DB instance using Neon's serverless driver.
 * Use this in Workers (pass c.env.DATABASE_URL) and in Node (pass process.env.DATABASE_URL).
 */
export declare function createDb(connectionString: string): import("drizzle-orm/neon-http").NeonHttpDatabase<typeof schema> & {
    $client: import("@neondatabase/serverless").NeonQueryFunction<false, false>;
};
export declare const db: import("drizzle-orm/neon-http").NeonHttpDatabase<typeof schema> & {
    $client: import("@neondatabase/serverless").NeonQueryFunction<false, false>;
};
//# sourceMappingURL=db.d.ts.map