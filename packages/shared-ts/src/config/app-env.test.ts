import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';

import {
  buildAuthRuntimeEnv,
  buildCommonServerRuntimeEnv,
  buildNextPublicClientRuntimeEnv,
  buildViteClientRuntimeEnv,
  createNextPublicAppEnv,
  createViteAppEnv,
  getRuntimeEnv,
  shouldSkipEnvValidation,
} from './app-env';

const originalProcessEnv = { ...process.env };
const globalScope = globalThis as Record<string, unknown>;

const resetProcessEnv = () => {
  for (const key of Object.keys(process.env)) {
    Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalProcessEnv);
};

const setProcessEnv = (key: string, value: string) => {
  Reflect.set(process.env, key, value);
};

const unsetProcessEnv = (key: string) => {
  Reflect.deleteProperty(process.env, key);
};

describe('config/app-env', () => {
  afterEach(() => {
    resetProcessEnv();
    Reflect.deleteProperty(globalScope, 'window');
  });

  it('reads runtime values from process.env first', () => {
    setProcessEnv('TASKFORCE_RUNTIME_TEST', 'from-process');
    globalScope['window'] = { process: { env: { TASKFORCE_RUNTIME_TEST: 'from-window' } } };

    expect(getRuntimeEnv('TASKFORCE_RUNTIME_TEST')).toBe('from-process');
  });

  it('falls back to browser process env and returns undefined when missing', () => {
    unsetProcessEnv('TASKFORCE_RUNTIME_TEST');
    globalScope['window'] = { process: { env: { TASKFORCE_RUNTIME_TEST: 'from-window' } } };

    expect(getRuntimeEnv('TASKFORCE_RUNTIME_TEST')).toBe('from-window');
    expect(getRuntimeEnv('TASKFORCE_RUNTIME_MISSING')).toBeUndefined();
  });

  it('falls back to import.meta env before browser process env', () => {
    unsetProcessEnv('TASKFORCE_RUNTIME_TEST');
    const importMetaEnv = (import.meta as unknown as { env: Record<string, string | undefined> })
      .env;
    const originalImportMetaValue = importMetaEnv['TASKFORCE_RUNTIME_TEST'];
    try {
      importMetaEnv['TASKFORCE_RUNTIME_TEST'] = 'from-import-meta';
      globalScope['window'] = { process: { env: { TASKFORCE_RUNTIME_TEST: 'from-window' } } };

      expect(getRuntimeEnv('TASKFORCE_RUNTIME_TEST')).toBe('from-import-meta');
    } finally {
      if (originalImportMetaValue === undefined) {
        delete importMetaEnv['TASKFORCE_RUNTIME_TEST'];
      } else {
        importMetaEnv['TASKFORCE_RUNTIME_TEST'] = originalImportMetaValue;
      }
    }
  });

  it('builds common runtime env groups from available variables', () => {
    setProcessEnv('NODE_ENV', 'production');
    setProcessEnv('PORT', '3000');
    setProcessEnv('AUTH_SECRET', 'secret');
    unsetProcessEnv('AUTH_URL');
    setProcessEnv('NEXT_PUBLIC_SITE_URL', 'https://taskforceai.chat');
    setProcessEnv('VITE_SITE_URL', 'https://vite.taskforceai.chat');

    expect(buildCommonServerRuntimeEnv()).toMatchObject({
      NODE_ENV: 'production',
      PORT: '3000',
    });
    expect(buildAuthRuntimeEnv()).toEqual({
      AUTH_SECRET: 'secret',
      AUTH_URL: undefined,
    });
    expect(buildNextPublicClientRuntimeEnv()).toMatchObject({
      NEXT_PUBLIC_SITE_URL: 'https://taskforceai.chat',
    });
    expect(buildViteClientRuntimeEnv({ EXTRA: 'value' })).toMatchObject({
      VITE_SITE_URL: 'https://vite.taskforceai.chat',
      EXTRA: 'value',
    });
  });

  it('detects skip-validation environments', () => {
    setProcessEnv('NODE_ENV', 'test');
    expect(shouldSkipEnvValidation()).toBe(true);

    setProcessEnv('NODE_ENV', 'development');
    setProcessEnv('NEXT_PHASE', 'phase-production-build');
    expect(shouldSkipEnvValidation()).toBe(true);

    unsetProcessEnv('NEXT_PHASE');
    setProcessEnv('BUN_TEST', '1');
    expect(shouldSkipEnvValidation()).toBe(true);
  });

  it('creates Next public and Vite env readers with extra schemas', () => {
    const nextEnv = createNextPublicAppEnv({
      client: { NEXT_PUBLIC_EXTRA_FLAG: z.string() },
      runtimeEnv: {
        NEXT_PUBLIC_EXTRA_FLAG: 'enabled',
        NODE_ENV: 'production',
      },
      skipValidation: false,
    });
    expect(nextEnv.NEXT_PUBLIC_EXTRA_FLAG).toBe('enabled');

    const viteEnv = createViteAppEnv({
      client: { VITE_EXTRA_FLAG: z.string() },
      runtimeEnv: {
        VITE_EXTRA_FLAG: 'enabled',
        NODE_ENV: 'production',
      },
      skipValidation: false,
    });
    expect(viteEnv.VITE_EXTRA_FLAG).toBe('enabled');
  });
});
