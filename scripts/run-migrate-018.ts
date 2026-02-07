/**
 * Run migration 018 (CustomerMember table for invited users in same workspace).
 *
 * Usage: bun run db:migrate:018
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
  const path = resolve(root, 'drizzle/migrations/018_customer_members.sql');
  const body = readFileSync(path, 'utf-8');
  await sql.unsafe(body);
  console.log('Migration 018_customer_members applied.');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
