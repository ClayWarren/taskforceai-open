import { afterEach, beforeEach, vi } from 'bun:test';

const baselineEnv = { ...process.env };

const restoreEnvInPlace = () => {
  // Remove keys not in baseline
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) {
      delete process.env[key];
    }
  }
  // Restore baseline values
  for (const [key, value] of Object.entries(baselineEnv)) {
    process.env[key] = value as string;
  }
};

const resetAllSync = () => {
  restoreEnvInPlace();
  vi.restoreAllMocks();
};

beforeEach(() => {
  resetAllSync();
});

afterEach(() => {
  resetAllSync();
});
