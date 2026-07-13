import { defineConfig } from 'drizzle-kit';
import { resolve } from 'node:path';

const sqlitePath =
  process.env['SYNC_DB_FILE'] ?? resolve(import.meta.dirname, '.tmp', 'sync.sqlite');

export default defineConfig({
  dialect: 'sqlite',
  schema: './drizzle/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: sqlitePath,
  },
});
