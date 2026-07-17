import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

const loadMobileEnvMock = vi.fn((input: { env: Record<string, string | undefined> }) => ({
  google: {
    androidClientId: input.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  },
  rawEnv: input.env,
}));
const ensureMobileGoogleClientIdMock = vi.fn(() => 'google-client-id');

vi.mock('@taskforceai/config/mobile', () => ({
  loadMobileEnv: loadMobileEnvMock,
  ensureMobileGoogleClientId: ensureMobileGoogleClientIdMock,
}));

const originalEnv = { ...process.env };
let importCounter = 0;

const resetEnv = () => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
};

const importEnvConfig = async (): Promise<typeof import('../../config/env')> =>
  (await import(`../../config/env?case=${importCounter++}`)) as typeof import('../../config/env');

describe('mobile env config', () => {
  beforeEach(() => {
    loadMobileEnvMock.mockClear();
    ensureMobileGoogleClientIdMock.mockClear();
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it('uses the live process env in test workers so logic tests can override values', async () => {
    process.env.JEST_WORKER_ID = '1';
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID = 'android-client';

    const envModule = await importEnvConfig();

    expect(loadMobileEnvMock).toHaveBeenCalledWith({
      env: expect.objectContaining({
        JEST_WORKER_ID: '1',
        EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: 'android-client',
      }),
    });
    expect(envModule.getGoogleAndroidClientId()).toBe('android-client');
  });

  it('reads Metro-inlineable mobile env keys outside test workers', async () => {
    delete process.env.BUN_TEST;
    delete process.env.JEST_WORKER_ID;
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
    process.env.EXPO_PUBLIC_SYNC_URL = 'https://sync.example.test';
    process.env.EXPO_PUBLIC_VOICE_GATEWAY_URL = 'https://voice.example.test';
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'web-client';
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID = 'android-client';

    await importEnvConfig();

    expect(loadMobileEnvMock).toHaveBeenCalledWith({
      env: expect.objectContaining({
        NODE_ENV: 'production',
        EXPO_PUBLIC_API_URL: 'https://api.example.test',
        EXPO_PUBLIC_SYNC_URL: 'https://sync.example.test',
        EXPO_PUBLIC_VOICE_GATEWAY_URL: 'https://voice.example.test',
        EXPO_PUBLIC_GOOGLE_CLIENT_ID: 'web-client',
        EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: 'android-client',
      }),
    });
  });

  it('delegates required Google client validation to the shared mobile config', async () => {
    const envModule = await importEnvConfig();

    expect(envModule.requireGoogleClientId()).toBe('google-client-id');
    expect(ensureMobileGoogleClientIdMock).toHaveBeenCalledWith(envModule.mobileEnv);
  });

  it('installs an env object when the runtime process shim lacks one', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'env');
    try {
      Object.defineProperty(process, 'env', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      await importEnvConfig();
      expect(process.env).toEqual({});
    } finally {
      if (descriptor) {
        Object.defineProperty(process, 'env', descriptor);
      }
    }
  });
});
