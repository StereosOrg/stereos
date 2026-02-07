/**
 * Run migration 016 (UserFavoriteToolMonthly by actor_id = product e.g. Cursor).
 *
 * Usage: bun run db:migrate:016
 */
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import postgres from 'postgres';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const root = resolve(__dirname, '..');
const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/stereos';

async function main() {
  const sql = postgres(connectionString);
  const path = resolve(root, 'drizzle/migrations/016_user_favorite_tool_by_actor.sql');
  const body = readFileSync(path, 'utf-8');
  await sql.unsafe(body);
  console.log('Migration 016_user_favorite_tool_by_actor applied.');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
