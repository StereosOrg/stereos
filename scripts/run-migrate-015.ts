/**
 * Run migration 015 (UserFavoriteToolMonthly materialized view).
 * Use when db:migrate didn't run it (e.g. journal only has 001/002).
 *
 * Usage: bun run db:migrate:015
 *        (Bun loads .env from repo root automatically)
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
  const path = resolve(root, 'drizzle/migrations/015_user_favorite_tool_monthly.sql');
  const body = readFileSync(path, 'utf-8');
  await sql.unsafe(body);
  console.log('Migration 015_user_favorite_tool_monthly applied.');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
