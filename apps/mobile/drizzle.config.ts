import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/storage/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: 'taskforceai.db',
  },
});
