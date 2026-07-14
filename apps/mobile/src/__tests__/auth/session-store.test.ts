import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { persistAuthenticatedSession } from '../../auth/session-store';
import type { MobileUserState } from '../../auth/user-state';

const mockResolveSessionExpiryMs = jest.fn(() => 1_900_000_000_000);
const mockSetSession = jest.fn();
const mockSaveProfile = jest.fn();
const mockClearSession = jest.fn();
const mockError = jest.fn();

jest.mock('@taskforceai/api-client/auth/session-expiry', () => ({
  resolveSessionExpiryMs: (...args: unknown[]) => mockResolveSessionExpiryMs(...args),
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({ error: (...args: unknown[]) => mockError(...args) }),
}));

jest.mock('../../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    setSession: (...args: unknown[]) => mockSetSession(...args),
    saveProfile: (...args: unknown[]) => mockSaveProfile(...args),
    clearSession: (...args: unknown[]) => mockClearSession(...args),
  },
}));

const userProfile = {
  id: 42,
  email: 'user@example.test',
  plan: 'pro',
} as MobileUserState;

describe('mobile auth session persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSession.mockResolvedValue({ ok: true, value: undefined });
    mockSaveProfile.mockResolvedValue({ ok: true, value: undefined });
    mockClearSession.mockResolvedValue({ ok: true, value: undefined });
  });

  it('persists the session and profile together', async () => {
    await expect(
      persistAuthenticatedSession({ accessToken: 'access-token', userProfile })
    ).resolves.toBeUndefined();

    expect(mockResolveSessionExpiryMs).toHaveBeenCalledWith('access-token');
    expect(mockSetSession).toHaveBeenCalledWith({
      accessToken: 'access-token',
      expiresAt: 1_900_000_000_000,
      user: { id: 42, email: 'user@example.test', plan: 'pro' },
    });
    expect(mockSaveProfile).toHaveBeenCalledWith(userProfile);
    expect(mockClearSession).not.toHaveBeenCalled();
  });

  it('reports session persistence failures without writing the profile', async () => {
    const cause = new Error('session write failed');
    mockSetSession.mockResolvedValueOnce({ ok: false, error: cause });

    await expect(
      persistAuthenticatedSession({ accessToken: 'access-token', userProfile })
    ).rejects.toThrow('Failed to save session. Please try again.');

    expect(mockError).toHaveBeenCalledWith('Failed to save mobile auth session', { error: cause });
    expect(mockSaveProfile).not.toHaveBeenCalled();
    expect(mockClearSession).not.toHaveBeenCalled();
  });

  it('reports profile persistence failures after writing the session', async () => {
    const cause = new Error('profile write failed');
    mockSaveProfile.mockResolvedValueOnce({ ok: false, error: cause });

    await expect(
      persistAuthenticatedSession({ accessToken: 'access-token', userProfile })
    ).rejects.toThrow('Failed to save profile. Please try again.');

    expect(mockError).toHaveBeenCalledWith('Failed to save mobile auth profile', { error: cause });
    expect(mockClearSession).toHaveBeenCalledTimes(1);
  });

  it('reports a rollback failure without masking the profile error', async () => {
    const profileError = new Error('profile write failed');
    const rollbackError = new Error('session rollback failed');
    mockSaveProfile.mockResolvedValueOnce({ ok: false, error: profileError });
    mockClearSession.mockResolvedValueOnce({ ok: false, error: rollbackError });

    await expect(
      persistAuthenticatedSession({ accessToken: 'access-token', userProfile })
    ).rejects.toThrow('Failed to save profile. Please try again.');

    expect(mockError).toHaveBeenCalledWith(
      'Failed to roll back mobile auth session after profile failure',
      { error: rollbackError }
    );
  });
});
