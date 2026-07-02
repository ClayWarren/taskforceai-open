import { afterEach, beforeEach, vi } from 'bun:test';

// Required resets (present in repo)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const loadOptionalReset = async (modulePath: string, exportName: string): Promise<() => void> => {
  try {
    const mod = await import(modulePath);
    if (isRecord(mod)) {
      const candidate = mod[exportName];
      if (typeof candidate === 'function') {
        return () => {
          candidate();
        };
      }
    }
  } catch {
    // ignore optional reset failures
  }
  return () => {};
};

// Optional resets loaded lazily to avoid hard failures when modules are absent
const optionalResetLoaders: Array<() => Promise<() => void>> = [
  () => loadOptionalReset('../qa/metaMetrics', 'resetMetaMetrics'),
  () => loadOptionalReset('../qa/policyManager', 'resetPolicy'),
];

let optionalResets: Array<() => void> = [];
const baselineEnv = { ...process.env };

const loadOptionalResets = async () => {
  const loaded: Array<() => void> = [];
  for (const loader of optionalResetLoaders) {
    try {
      const resetFn = await loader();
      loaded.push(resetFn);
    } catch {
      loaded.push(() => {});
    }
  }
  optionalResets = loaded;
};

const safeResetSync = (fn: () => void) => {
  try {
    fn();
  } catch {
    /* ignore */
  }
};

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
  for (const reset of optionalResets) {
    safeResetSync(reset);
  }
};

beforeEach(async () => {
  if (optionalResets.length === 0) {
    await loadOptionalResets();
  }
  resetAllSync();
});

afterEach(() => {
  resetAllSync();
});
