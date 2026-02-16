/**
 * Run AI Gateway migration (031).
 *
 * Usage: bun run scripts/run-migrate-031.ts
 */
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import postgres from 'postgres';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const root = resolve(__dirname, '..');
const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/stereos';

const migrations = ['031_ai_gateway.sql'];

async function main() {
  const sql = postgres(connectionString);
  for (const file of migrations) {
    const path = resolve(root, 'drizzle/migrations', file);
    const body = readFileSync(path, 'utf-8');
    console.log(`Applying ${file}...`);
    await sql.unsafe(body);
    console.log(`  ✓ ${file} applied.`);
  }
  await sql.end();
  console.log('All migrations applied successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
