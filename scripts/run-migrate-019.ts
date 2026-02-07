/**
 * Run migration 019 (ArtifactLink.diff_content for storing unified diff).
 *
 * Usage: bun run db:migrate:019
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
  const path = resolve(root, 'drizzle/migrations/019_artifact_link_diff_content.sql');
  const body = readFileSync(path, 'utf-8');
  await sql.unsafe(body);
  console.log('Migration 019_artifact_link_diff_content applied.');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
