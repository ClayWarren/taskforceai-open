import { act, renderHook, waitFor } from '@testing-library/react';
import type { SyncStatus } from '@taskforceai/sync-client';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const getStoredTokenMock = vi.fn();
const createHttpSyncClientMock = vi.fn();
const createDesktopSyncClientMock = vi.fn();
const useManagedSyncManagerMock = vi.fn();
const useStorageAdapterMock = vi.fn();
const usePlatformRuntimeMock = vi.fn();
const useAuthMock = vi.fn();
const getBrowserOriginMock = vi.fn();
const isRetryableErrorMock = vi.fn();

vi.mock('@taskforceai/contracts/auth/auth-storage', () => ({
  getStoredToken: getStoredTokenMock,
}));

vi.mock('@taskforceai/contracts/auth/csrf', () => ({
  getCsrfToken: vi.fn(),
}));

vi.mock('@taskforceai/shared/errors', () => ({
  isRetryableError: isRetryableErrorMock,
}));

vi.mock('@taskforceai/sync-client', () => ({
  createHttpSyncClient: createHttpSyncClientMock,
}));

vi.mock('@taskforceai/react-core', () => ({
  useManagedSyncManager: useManagedSyncManagerMock,
}));

vi.mock('../platform/PlatformProvider', () => ({
  usePlatformRuntime: usePlatformRuntimeMock,
  useStorageAdapter: useStorageAdapterMock,
}));

vi.mock('../platform/browser-context', () => ({
  getBrowserOrigin: getBrowserOriginMock,
}));

vi.mock('../platform/desktop/sync-client', () => ({
  createDesktopSyncClient: createDesktopSyncClientMock,
}));

vi.mock('../providers/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { SyncUnauthorizedError } from './sync-manager-errors';
import { useSyncManager } from './useSyncManager';

describe('useSyncManager', () => {
  const syncState = {
    error: null,
    isSyncing: false,
    lastStats: null,
    lastSyncTime: 0,
    status: 'idle' as SyncStatus,
  } as const;
  const sync = vi.fn();
  const storageAdapter = {
    setDeviceId: vi.fn(),
    setLastSyncVersion: vi.fn(),
  };
  const handleAuthFailure = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getStoredTokenMock.mockReturnValue({ ok: true, value: 'token-1' });
    getBrowserOriginMock.mockReturnValue({ ok: true, value: 'http://localhost:3210' });
    isRetryableErrorMock.mockReturnValue(true);
    usePlatformRuntimeMock.mockReturnValue('browser');
    useStorageAdapterMock.mockReturnValue(storageAdapter);
    useAuthMock.mockReturnValue({ handleAuthFailure, isAuthenticated: true, isTokenReady: true });
    useManagedSyncManagerMock.mockReturnValue({ syncState, sync });
  });

  it('wires browser sync with realtime only when auth and a token are present', () => {
    const { result } = renderHook(() => useSyncManager());

    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    expect(config.enabled).toBe(true);
    expect(config.storage).toBe(storageAdapter);
    expect(config.autoSyncInterval).toBe(5 * 60 * 1000);
    expect(config.realtime.enabled).toBe(true);
    expect(result.current.syncState).toBe(syncState);
    expect(result.current.sync).toBe(sync);

    config.createSyncClient();

    expect(createHttpSyncClientMock).toHaveBeenCalledWith('', expect.any(Function), {
      onUnauthorized: expect.any(Function),
      getCsrfToken: expect.any(Function),
    });

    const getToken = createHttpSyncClientMock.mock.calls[0]?.[1];
    expect(getToken()).toBe('token-1');
  });

  it('uses the desktop sync client and reports unauthorized callbacks to auth', () => {
    usePlatformRuntimeMock.mockReturnValue('desktop');

    renderHook(() => useSyncManager(false));
    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    config.createSyncClient();

    expect(createDesktopSyncClientMock).toHaveBeenCalledWith(
      'http://localhost:3210',
      expect.any(Function),
      expect.objectContaining({ onUnauthorized: expect.any(Function) })
    );

    const options = createDesktopSyncClientMock.mock.calls[0]?.[2];
    options.onUnauthorized({ source: 'realtime' });
    expect(handleAuthFailure).toHaveBeenCalledWith('sync_realtime');
  });

  it('blocks manual sync while offline and updates online state when the browser reconnects', async () => {
    renderHook(() => useSyncManager());
    let config = useManagedSyncManagerMock.mock.calls[0]?.[0];

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    await waitFor(() =>
      expect(useManagedSyncManagerMock.mock.calls.at(-1)?.[0].isOnline).toBe(false)
    );
    config = useManagedSyncManagerMock.mock.calls.at(-1)?.[0];
    expect(config.isOnline).toBe(false);
    expect(() => config.beforeManualSync()).toThrow('Cannot sync while offline');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() =>
      expect(useManagedSyncManagerMock.mock.calls.at(-1)?.[0].isOnline).toBe(true)
    );
    expect(useManagedSyncManagerMock.mock.calls.at(-1)?.[0].reconnectSignal).toBeGreaterThan(0);
  });

  it('normalizes unauthorized sync errors and triggers auth failure', () => {
    renderHook(() => useSyncManager());
    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    const sourceError = { status: 401 };
    const normalized = config.normalizeError(sourceError);

    expect(normalized).toBeInstanceOf(SyncUnauthorizedError);

    config.onSyncError({ error: sourceError, normalizedError: normalized });
    expect(handleAuthFailure).toHaveBeenCalledWith('sync_unauthorized_error');
  });

  it('resets sync metadata and retries once when recovery handles a rejected payload', async () => {
    renderHook(() => useSyncManager());
    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    const manager = { sync: vi.fn() };

    expect(config.recovery.shouldRecover({ status: 422 })).toBe(true);
    await config.recovery.recover({ manager });

    expect(storageAdapter.setLastSyncVersion).toHaveBeenCalledWith(0);
    expect(storageAdapter.setDeviceId.mock.calls[0]?.[0]).toMatch(/^web-recovered-/);
    expect(manager.sync).toHaveBeenCalled();
  });
});
