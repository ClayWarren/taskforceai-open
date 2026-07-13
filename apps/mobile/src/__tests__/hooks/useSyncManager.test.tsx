import { act } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { useSyncManager } from '../../hooks/useSyncManager';
import { renderHookWithQueryClient } from '../helpers/query-client';

const mockUseManagedSyncManager = jest.fn();
const mockUseNetworkStatus = jest.fn();
const mockGetSession = jest.fn();
const mockCreateMobileSyncClient = jest.fn();
const mockIncrementCounter = jest.fn();
const mockStopTimer = jest.fn();
const mockStartTimer = jest.fn(() => mockStopTimer);
const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

jest.mock('@taskforceai/react-core', () => ({
  useManagedSyncManager: (...args: unknown[]) => mockUseManagedSyncManager(...args),
}));

jest.mock('../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

jest.mock('../../config/base-url', () => ({
  getMobileBaseUrl: () => 'https://mobile.example',
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => mockLogger,
}));

jest.mock('../../observability/metrics', () => ({
  mobileMetrics: {
    incrementCounter: (...args: unknown[]) => mockIncrementCounter(...args),
    startTimer: (...args: unknown[]) => mockStartTimer(...args),
  },
}));

jest.mock('../../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    getSession: () => mockGetSession(),
  },
}));

jest.mock('../../sync/mobileSyncClient', () => ({
  createMobileSyncClient: (...args: unknown[]) => mockCreateMobileSyncClient(...args),
}));

describe('useSyncManager', () => {
  const syncState = {
    error: null,
    isSyncing: false,
    lastStats: null,
    lastSyncTime: 0,
    status: 'idle',
  };
  const sync = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ isOnline: true });
    mockGetSession.mockResolvedValue({ ok: true, value: { accessToken: 'mobile-token' } });
    mockUseManagedSyncManager.mockReturnValue({ syncState, sync });
  });

  it('wires the managed sync manager with mobile storage, network state, and token-backed clients', async () => {
    const { result } = await renderHookWithQueryClient(() => useSyncManager());

    const config = mockUseManagedSyncManager.mock.calls[0]?.[0];
    expect(config.enabled).toBe(true);
    expect(config.isOnline).toBe(true);
    expect(config.isActive).toBe(true);
    expect(result.current.syncState).toBe(syncState);
    expect(result.current.sync).toBe(sync);
    expect(result.current.isOnline).toBe(true);

    await config.createSyncClient();
    expect(mockCreateMobileSyncClient).toHaveBeenCalledWith({
      baseUrl: 'https://mobile.example',
      getToken: expect.any(Function),
    });
    const getToken = mockCreateMobileSyncClient.mock.calls[0]?.[0].getToken;
    await expect(getToken()).resolves.toBe('mobile-token');

    await expect(config.shouldRun()).resolves.toBe(true);
    mockGetSession.mockResolvedValueOnce({ ok: false, error: new Error('missing session') });
    await expect(config.shouldRun()).resolves.toBe(false);
  });

  it('runs sync through the policy wrapper and always stops the duration timer', async () => {
    await renderHookWithQueryClient(() => useSyncManager());
    const config = mockUseManagedSyncManager.mock.calls[0]?.[0];
    const manager = { sync: jest.fn().mockResolvedValue('synced') };

    await expect(config.runSync(manager)).resolves.toBe('synced');

    expect(mockStartTimer).toHaveBeenCalledWith('sync.duration');
    expect(manager.sync).toHaveBeenCalledTimes(1);
    expect(mockStopTimer).toHaveBeenCalledTimes(1);
  });

  it('records successful sync stats and invalidates conversation queries', async () => {
    const { queryClient } = await renderHookWithQueryClient(() => useSyncManager());
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const config = mockUseManagedSyncManager.mock.calls[0]?.[0];

    await act(async () => {
      await config.onSyncComplete({
        conflicts: 2,
        pulled: { conversations: 3, messages: 4, deletions: 1 },
        pushed: { conversations: 1, messages: 2, deletions: 1 },
      });
    });

    expect(mockIncrementCounter).toHaveBeenCalledWith('sync.success', {
      itemsSynced: 12,
      conflictsResolved: 2,
    });
    expect(mockLogger.info).toHaveBeenCalledWith('Sync successful', {
      stats: expect.objectContaining({ conflicts: 2 }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['conversations'] });
  });

  it('classifies sync failures and records normalized errors', async () => {
    await renderHookWithQueryClient(() => useSyncManager());
    const config = mockUseManagedSyncManager.mock.calls[0]?.[0];

    const unavailable = { status: 503 };
    config.onSyncError({
      error: unavailable,
      normalizedError: new Error('temporarily unavailable'),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith('Sync temporarily unavailable', {
      status: 503,
    });

    const generic = new Error('bad sync');
    config.onSyncError({ error: generic, normalizedError: generic });
    expect(mockLogger.error).toHaveBeenCalledWith('Sync failed', { error: generic });
    expect(mockIncrementCounter).toHaveBeenLastCalledWith('sync.failure', {
      error: 'bad sync',
    });
  });

  it('logs realtime lifecycle callbacks and cleanup-specific disconnect failures', async () => {
    await renderHookWithQueryClient(() => useSyncManager());
    const config = mockUseManagedSyncManager.mock.calls[0]?.[0];

    config.realtime.onConnect();
    config.realtime.onDisconnect('inactive');
    config.realtime.onConnectError(new Error('connect failed'));
    config.realtime.onDisconnectError(new Error('cleanup failed'), 'cleanup');
    config.realtime.onDisconnectError(new Error('network failed'), 'network');

    expect(mockLogger.info).toHaveBeenCalledWith('Connecting to realtime sync');
    expect(mockLogger.debug).toHaveBeenCalledWith('Disconnecting realtime sync (inactive or offline)');
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to initiate realtime sync connection', {
      error: expect.any(Error),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith('Error during realtime disconnect cleanup', {
      error: expect.any(Error),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith('Error during realtime disconnect', {
      error: expect.any(Error),
    });
  });

  it('retries failed sync work and opens the circuit after consecutive failures', async () => {
    jest.useFakeTimers();
    await renderHookWithQueryClient(() => useSyncManager());
    const config = mockUseManagedSyncManager.mock.calls[0]?.[0];
    const manager = { sync: jest.fn().mockRejectedValue(new Error('offline')) };

    const syncPromise = config.runSync(manager).catch((error: Error) => error);
    await act(async () => {
      await jest.runAllTimersAsync();
    });
    await syncPromise;

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Retrying sync after failure',
      expect.objectContaining({ reason: expect.any(Error) })
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Sync circuit breaker opened',
      expect.objectContaining({ reason: expect.anything() })
    );
    jest.useRealTimers();
  });

  it('raises reconnect signals when connectivity returns and the app becomes active', async () => {
    let appStateListener: ((state: string) => void) | undefined;
    const remove = jest.fn();
    const mockAppState = {
      currentState: 'active',
      addEventListener: jest.fn(),
    };
    mockAppState.addEventListener.mockImplementation((_, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove } as never;
    });
    const rendered = await renderHookWithQueryClient(() => useSyncManager(true, mockAppState as never));
    await act(async () => { await Promise.resolve(); });
    expect(mockAppState.addEventListener).toHaveBeenCalled();

    mockUseNetworkStatus.mockReturnValue({ isOnline: false });
    await rendered.rerender(undefined);
    mockUseNetworkStatus.mockReturnValue({ isOnline: true });
    await rendered.rerender(undefined);
    expect(mockUseManagedSyncManager.mock.calls.at(-1)?.[0].reconnectSignal).toBeGreaterThan(0);

    await act(async () => {
      appStateListener?.('background');
      await Promise.resolve();
    });
    await act(async () => {
      appStateListener?.('active');
      await Promise.resolve();
    });
    expect(mockUseManagedSyncManager.mock.calls.at(-1)?.[0].isActive).toBe(true);

    await act(async () => { rendered.unmount(); });
  });
});
