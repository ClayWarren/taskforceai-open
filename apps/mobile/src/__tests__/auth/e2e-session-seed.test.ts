import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  canUseE2EAuthSeed,
  readE2EAuthSeed,
  seedE2EAuthSession,
} from '../../auth/e2e-session-seed';

const mockMobileEnv = {
  nodeEnv: 'test',
  e2eAuthSeed: {
    enabled: false,
    accessToken: undefined as string | undefined,
    email: undefined as string | undefined,
    userId: undefined as string | undefined,
    plan: undefined as string | undefined,
    expiresAt: undefined as number | undefined,
  },
};
const mockSetSession = jest.fn();
const mockSaveProfile = jest.fn();
const mockInfo = jest.fn();
const mockResolveSessionExpiryMs = jest.fn(() => 1_800_000_000_000);

jest.mock('../../config/env', () => ({
  get mobileEnv() {
    return mockMobileEnv;
  },
}));

jest.mock('../../auth/token-expiry', () => ({
  resolveSessionExpiryMs: (...args: unknown[]) => mockResolveSessionExpiryMs(...args),
}));

jest.mock('../../logger', () => ({
  mobileLogger: {
    info: (...args: unknown[]) => mockInfo(...args),
  },
}));

jest.mock('../../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    setSession: (...args: unknown[]) => mockSetSession(...args),
    saveProfile: (...args: unknown[]) => mockSaveProfile(...args),
  },
}));

describe('E2E auth session seeding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    mockMobileEnv.nodeEnv = 'test';
    mockMobileEnv.e2eAuthSeed = {
      enabled: false,
      accessToken: undefined,
      email: undefined,
      userId: undefined,
      plan: undefined,
      expiresAt: undefined,
    };
    mockSetSession.mockResolvedValue({ ok: true, value: undefined });
    mockSaveProfile.mockResolvedValue({ ok: true, value: undefined });
  });

  it('allows e2e auth seeds only in test or development runtimes', () => {
    expect(canUseE2EAuthSeed({ ...mockMobileEnv, e2eAuthSeed: { ...mockMobileEnv.e2eAuthSeed, enabled: false } })).toBe(
      false
    );
    expect(canUseE2EAuthSeed({ ...mockMobileEnv, e2eAuthSeed: { ...mockMobileEnv.e2eAuthSeed, enabled: true } })).toBe(
      true
    );
    expect(
      canUseE2EAuthSeed({
        ...mockMobileEnv,
        nodeEnv: 'production',
        e2eAuthSeed: { ...mockMobileEnv.e2eAuthSeed, enabled: true },
      })
    ).toBe(false);

    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    expect(
      canUseE2EAuthSeed({
        ...mockMobileEnv,
        nodeEnv: 'production',
        e2eAuthSeed: { ...mockMobileEnv.e2eAuthSeed, enabled: true },
      })
    ).toBe(true);
  });

  it('reads and normalizes the seed from mobile environment values', () => {
    mockMobileEnv.e2eAuthSeed = {
      enabled: true,
      accessToken: ' token ',
      email: ' user@example.test ',
      userId: '',
      plan: 'enterprise',
      expiresAt: 1_900_000_000_000,
    };

    expect(readE2EAuthSeed()).toEqual({
      accessToken: 'token',
      email: 'user@example.test',
      userId: 'user@example.test',
      plan: 'free',
      expiresAt: 1_900_000_000_000,
    });

    mockMobileEnv.e2eAuthSeed.accessToken = '   ';
    expect(readE2EAuthSeed()).toBeNull();
  });

  it('persists the seeded session and matching profile state', async () => {
    mockMobileEnv.e2eAuthSeed = {
      enabled: true,
      accessToken: 'seed-token',
      email: 'user@example.test',
      userId: '42',
      plan: 'pro',
      expiresAt: 1_900_000_000_000,
    };

    await expect(seedE2EAuthSession()).resolves.toBe(true);

    expect(mockResolveSessionExpiryMs).toHaveBeenCalledWith('seed-token', 1_900_000_000_000);
    expect(mockSetSession).toHaveBeenCalledWith({
      accessToken: 'seed-token',
      expiresAt: 1_800_000_000_000,
      user: {
        id: '42',
        email: 'user@example.test',
        plan: 'pro',
      },
    });
    expect(mockSaveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 42,
        email: 'user@example.test',
        plan: 'pro',
      })
    );
    expect(mockInfo).toHaveBeenCalledWith(
      '[E2EAuthSeed] Seeded simulator auth session',
      expect.objectContaining({ email: 'user@example.test', plan: 'pro' })
    );
  });

  it('returns false when no seed is available and throws persistence failures', async () => {
    await expect(seedE2EAuthSession()).resolves.toBe(false);
    expect(mockSetSession).not.toHaveBeenCalled();

    mockMobileEnv.e2eAuthSeed = {
      enabled: true,
      accessToken: 'seed-token',
      email: 'user@example.test',
      userId: 'not-numeric',
      plan: 'admin',
      expiresAt: undefined,
    };
    mockSetSession.mockResolvedValueOnce({ ok: false, error: new Error('session failed') });
    await expect(seedE2EAuthSession()).rejects.toThrow('session failed');

    mockSetSession.mockResolvedValueOnce({ ok: true, value: undefined });
    mockSaveProfile.mockResolvedValueOnce({ ok: false, error: new Error('profile failed') });
    await expect(seedE2EAuthSession()).rejects.toThrow('profile failed');
    expect(mockSaveProfile).toHaveBeenLastCalledWith(expect.objectContaining({ id: 0 }));
  });
});
