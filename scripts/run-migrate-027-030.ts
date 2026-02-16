/**
 * Run partner migrations 027-030 in order.
 *
 * Usage: bun run scripts/run-migrate-027-030.ts
 */
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import postgres from 'postgres';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const root = resolve(__dirname, '..');
const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/stereos';

const migrations = [
  '027_partners_and_referrals.sql',
  '028_partner_tier_trigger.sql',
  '029_partner_status.sql',
  '030_partner_columns.sql',
];

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
  console.log('All partner migrations applied successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
