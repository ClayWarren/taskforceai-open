import { describe, expect, it, vi } from 'bun:test';

const validateEnv = vi.fn();
const env = { NEXT_PUBLIC_APP_URL: 'https://console.example.com' };
const loadWebEnv = vi.fn(() => ({ env, validateEnv }));

vi.mock('@taskforceai/shared/config/server', () => ({
  loadWebEnv,
}));

const importEnvModule = () => import(`./env?test=${Date.now()}-${Math.random()}`);

describe('console env config', () => {
  it('loads web env with browser-safe process flags and re-exports the result', async () => {
    loadWebEnv.mockClear();

    const envModule = await importEnvModule();

    expect(loadWebEnv).toHaveBeenCalledWith({
      env: process.env,
      isTestEnv: process.env['NODE_ENV'] === 'test',
      isBuildTime: process.env['NEXT_PHASE'] === 'phase-production-build',
      isClientSide: typeof window !== 'undefined',
    });
    expect(envModule.env).toBe(env);
    expect(envModule.validateEnv).toBe(validateEnv);
  });
});
