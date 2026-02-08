/**
 * Run migration 020 (Replace VerificationToken with Verification table for Better Auth).
 *
 * Usage: bun run db:migrate:020
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
  const path = resolve(root, 'drizzle/migrations/020_add_verification_table.sql');
  const body = readFileSync(path, 'utf-8');
  await sql.unsafe(body);
  console.log('Migration 020_add_verification_table applied.');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
