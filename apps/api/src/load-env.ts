/**
 * Load .env before any other modules that use process.env (e.g. shared db).
 * Must be imported first in the entry point.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// load-env.ts lives in apps/api/src/ → repo root .env is ../../../.env
const __dirname = resolve(fileURLToPath(import.meta.url), '..');
config({ path: resolve(__dirname, '../../../.env') });
