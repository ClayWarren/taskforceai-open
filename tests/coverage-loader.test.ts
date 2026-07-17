import { Glob } from 'bun';
import { describe, it, expect } from 'bun:test';

// This "test" exists solely to load all package source files during coverage runs.
// Bun's coverage only reports on files that are actually loaded/imported.
// This ensures untrained files appear in the report with 0% coverage.

const SRC_GLOBS = ['packages/**/*.{ts,tsx}'];

const IGNORE_PATTERNS = [
  '.test.',
  '.test-harness.',
  '.test-support.',
  '.spec.',
  '__mocks__',
  'd.ts',
  'types.ts',
  'node_modules',
  'dist',
  'benchmarks',
  '.bench.',
  '/scripts/',
  'generated',
];

const writeLog = (level: 'info' | 'error', message: string, meta?: Record<string, unknown>) => {
  const payload = { level, message, timestamp: new Date().toISOString(), ...meta };
  const line = `${JSON.stringify(payload)}\n`;
  if (level === 'error') {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
};

describe('Packages Coverage Loader', () => {
  it('loads all package source files', async () => {
    const rootDir = process.cwd();
    const filesToLoad: string[] = [];

    for (const pattern of SRC_GLOBS) {
      const glob = new Glob(pattern);
      for (const file of glob.scanSync({ cwd: rootDir, absolute: true })) {
        if (IGNORE_PATTERNS.some((p) => file.includes(p))) continue;
        filesToLoad.push(file);
      }
    }

    writeLog('info', 'Attempting to load package files', { files: filesToLoad.length });

    // Set dummy env vars for configuration files that require them during import
    process.env['SYNC_DATABASE_URL'] = 'postgresql://localhost:5432/dummy?sslmode=disable';

    let loaded = 0;
    const failures: { file: string; error: unknown }[] = [];

    for (const file of filesToLoad) {
      try {
        await import(file);
        loaded++;
      } catch (error) {
        failures.push({ file, error });
      }
    }

    writeLog('info', 'Package file loading complete', { loaded, errors: failures.length });
    if (failures.length > 0) {
      const summary = failures
        .slice(0, 5)
        .map((failure) => `${failure.file}: ${formatError(failure.error)}`)
        .join('\n');
      const message = `Failed to import ${failures.length} files.\n${summary}`;
      throw new Error(message);
    }
    expect(loaded).toBeGreaterThan(0);
  }, 60000); // Extended timeout
});
