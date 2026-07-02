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
const loggerDebugMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();

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
    debug: loggerDebugMock,
    error: loggerErrorMock,
    info: loggerInfoMock,
    warn: loggerWarnMock,
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
      metrics: expect.any(Object),
    });

    const getToken = createHttpSyncClientMock.mock.calls[0]?.[1];
    expect(getToken()).toBe('token-1');
  });

  it('disables realtime when auth is missing or the token is not ready', () => {
    useAuthMock.mockReturnValueOnce({
      handleAuthFailure,
      isAuthenticated: false,
      isTokenReady: true,
    });
    renderHook(() => useSyncManager());
    expect(useManagedSyncManagerMock.mock.calls.at(-1)?.[0].realtime.enabled).toBe(false);

    useAuthMock.mockReturnValueOnce({
      handleAuthFailure,
      isAuthenticated: true,
      isTokenReady: false,
    });
    renderHook(() => useSyncManager());
    expect(useManagedSyncManagerMock.mock.calls.at(-1)?.[0].realtime.enabled).toBe(false);
  });

  it('returns null from sync clients when stored auth token lookup fails', () => {
    getStoredTokenMock.mockReturnValue({ ok: false, error: new Error('missing token') });

    renderHook(() => useSyncManager());
    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    config.createSyncClient();

    const getToken = createHttpSyncClientMock.mock.calls[0]?.[1];
    expect(getToken()).toBeNull();
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

  it('uses the latest auth failure handler for existing sync client callbacks', async () => {
    usePlatformRuntimeMock.mockReturnValue('desktop');
    const firstAuthFailure = vi.fn();
    const latestAuthFailure = vi.fn();
    useAuthMock.mockReturnValueOnce({
      handleAuthFailure: firstAuthFailure,
      isAuthenticated: true,
      isTokenReady: true,
    });

    const { rerender } = renderHook(() => useSyncManager());
    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    config.createSyncClient();
    const options = createDesktopSyncClientMock.mock.calls[0]?.[2];

    useAuthMock.mockReturnValueOnce({
      handleAuthFailure: latestAuthFailure,
      isAuthenticated: true,
      isTokenReady: true,
    });
    rerender();
    await waitFor(() => {
      expect(useManagedSyncManagerMock).toHaveBeenCalledTimes(2);
    });

    options.onUnauthorized({ source: 'push' });

    expect(firstAuthFailure).not.toHaveBeenCalled();
    expect(latestAuthFailure).toHaveBeenCalledWith('sync_push');
  });

  it('uses an empty desktop origin when browser origin resolution fails', () => {
    usePlatformRuntimeMock.mockReturnValue('desktop');
    getBrowserOriginMock.mockReturnValue({ ok: false, error: new Error('bad origin') });

    renderHook(() => useSyncManager());
    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    config.createSyncClient();

    expect(createDesktopSyncClientMock).toHaveBeenCalledWith(
      '',
      expect.any(Function),
      expect.any(Object)
    );
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
    expect(useManagedSyncManagerMock.mock.calls.at(-1)?.[0].beforeManualSync()).toBeUndefined();
    expect(loggerInfoMock).toHaveBeenCalledWith('Network offline');
    expect(loggerInfoMock).toHaveBeenCalledWith('Network online, triggering sync');
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

  it('surfaces retry and non-retryable sync failures through callbacks', () => {
    renderHook(() => useSyncManager());
    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    const retryableError = new Error('temporary outage');

    expect(config.retry.shouldRetry(retryableError)).toBe(true);
    config.retry.onRetry({ attempt: 2, delayMs: 5000, error: retryableError });
    config.retry.onExhausted({
      error: new Error('retry exhausted'),
      sourceError: retryableError,
    });

    expect(loggerWarnMock).toHaveBeenCalledWith('Retrying sync after failure', {
      attempt: 2,
      delayMs: 5000,
      reason: retryableError,
    });
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Sync failed after all retries or non-retryable error',
      {
        error: expect.any(Error),
        sourceError: retryableError,
      }
    );

    isRetryableErrorMock.mockReturnValue(false);
    const nonRetryableError = new Error('validation failed');

    expect(config.retry.shouldRetry(nonRetryableError)).toBe(false);
    config.onSyncError({ error: nonRetryableError, normalizedError: nonRetryableError });

    expect(loggerErrorMock).toHaveBeenCalledWith('Sync failed', { error: nonRetryableError });
    expect(loggerErrorMock).toHaveBeenCalledWith('Sync failed with non-retryable error', {
      error: nonRetryableError,
    });
  });

  it('logs sync lifecycle, conflict, and real-time callbacks', () => {
    renderHook(() => useSyncManager());
    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    const stats = {
      conflicts: 2,
      duration: 12.6,
      pulled: { conversations: 3, deletions: 1, messages: 4 },
      pushed: { conversations: 1, deletions: 1, messages: 2 },
    };

    config.onSyncStart();
    config.onSyncComplete(stats);
    config.onInitialSyncError(new Error('initial failed'), new Error('normalized initial'));
    config.onConflict([{ id: 'conflict-1' }, { id: 'conflict-2' }]);
    config.realtime.onConnect();
    config.realtime.onDisconnect('cleanup');
    config.realtime.onDisconnect('network');
    config.realtime.onEvent({ type: 'conversation.updated' });
    config.realtime.onTrigger('message.created');
    config.realtime.onConnectError(new Error('socket failed'));

    expect(loggerDebugMock).toHaveBeenCalledWith('Sync started');
    expect(loggerInfoMock).toHaveBeenCalledWith('Sync completed', {
      durationMs: 13,
      changesSent: 4,
      changesReceived: 8,
      conflicts: 2,
    });
    expect(loggerErrorMock).toHaveBeenCalledWith('Initial sync failed', expect.any(Error));
    expect(loggerWarnMock).toHaveBeenCalledWith('Sync conflicts detected', { count: 2 });
    expect(loggerInfoMock).toHaveBeenCalledWith('Connecting to real-time sync');
    expect(loggerInfoMock).toHaveBeenCalledWith('Disconnecting from real-time sync');
    expect(loggerInfoMock).toHaveBeenCalledWith('Real-time sync event received', {
      type: 'conversation.updated',
    });
    expect(loggerInfoMock).toHaveBeenCalledWith('Triggered real-time sync', {
      type: 'message.created',
    });
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to connect to real-time sync', {
      error: expect.any(Error),
    });
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

  it('logs recovery failures without throwing from the failure callback', () => {
    renderHook(() => useSyncManager());
    const config = useManagedSyncManagerMock.mock.calls[0]?.[0];
    const recoveryError = new Error('recovery failed');

    config.recovery.onFailed(recoveryError);

    expect(loggerErrorMock).toHaveBeenCalledWith('Sync recovery failed after 422', recoveryError);
  });
});
