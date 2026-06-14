/**
 * Base test setup - minimal environment configuration
 * Use this for backend/API tests that don't need DOM
 */
/* c8 ignore file */
/* istanbul ignore file */
import { afterEach, beforeEach, vi } from 'bun:test';
import { config } from 'dotenv';
import { resolve } from 'path';

// Note: Server is now pure Go - no TypeScript server imports needed
// Cache/Redis resets are handled by the Go server internally

const assignEnv = (vars: Record<string, string>) => {
  process.env = { ...process.env, ...vars } as NodeJS.ProcessEnv;
};

// Set test environment FIRST
assignEnv({ NODE_ENV: 'test', BUN_TEST: '1' });

// Set critical environment variables before loading dotenv
assignEnv({
  AUTH_SECRET: process.env['AUTH_SECRET'] || 'SpGZuG4IGiH/iiQopPsKRyIP6bDElSf/RMcLR+2fxJE=',
  AUTH_URL: process.env['AUTH_URL'] || 'http://localhost:3000',
  TASKFORCEAI_API_IN_MEMORY: 'true',
});

// Load .env.test
config({ path: resolve(process.cwd(), '.env.test') });

// Set test database URL
const TEST_DATABASE_URL =
  process.env['DATABASE_URL'] ||
  'postgresql://postgres:postgres@localhost:5432/taskforceai_test?schema=public&sslmode=disable';
assignEnv({ DATABASE_URL: TEST_DATABASE_URL });

// Global mock/module cleanup to prevent cross-file leakage in Bun's single-process runner
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  // Note: Server is now pure Go - no TypeScript cache/Redis cleanup needed
});
