import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

import { useManagedRealtimeSync } from './useManagedRealtimeSync';

describe('useManagedRealtimeSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects only when enabled with a client', () => {
    const connectRealtime = vi.fn(() => vi.fn());

    const { rerender, unmount } = renderHook(
      ({ enabled, client }) =>
        useManagedRealtimeSync({
          client,
          enabled,
          isSyncing: false,
          onSyncRequired: vi.fn(),
        }),
      {
        initialProps: {
          enabled: false,
          client: { connectRealtime },
        },
      }
    );

    expect(connectRealtime).not.toHaveBeenCalled();

    rerender({
      enabled: true,
      client: { connectRealtime },
    });

    expect(connectRealtime).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('queues throttled events and triggers one follow-up sync', () => {
    let handler: ((event: { type: string }) => void) | undefined;
    const connectRealtime = vi.fn((nextHandler: (event: { type: string }) => void) => {
      handler = nextHandler;
      return vi.fn();
    });
    const onSyncRequired = vi.fn();

    renderHook(() =>
      useManagedRealtimeSync({
        client: { connectRealtime },
        enabled: true,
        isSyncing: false,
        onSyncRequired,
      })
    );

    act(() => {
      handler?.({ type: 'conversation:updated' });
      handler?.({ type: 'conversation:updated' });
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(2);
  });

  it('processes queued events after an in-flight sync completes', async () => {
    let handler: ((event: { type: string }) => void) | undefined;
    let resolveSync: (() => void) | undefined;
    const connectRealtime = vi.fn((nextHandler: (event: { type: string }) => void) => {
      handler = nextHandler;
      return vi.fn();
    });
    const onSyncRequired = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        })
    );

    renderHook(() =>
      useManagedRealtimeSync({
        client: { connectRealtime },
        enabled: true,
        isSyncing: false,
        onSyncRequired,
        throttleMs: 3000,
      })
    );

    act(() => {
      handler?.({ type: 'conversation:updated' });
      handler?.({ type: 'conversation:updated' });
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSync?.();
      await Promise.resolve();
      vi.advanceTimersByTime(3000);
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(2);
  });

  it('drops queued realtime events after a sync failure', async () => {
    let handler: ((event: { type: string }) => void) | undefined;
    let rejectSync: ((error: Error) => void) | undefined;
    const connectRealtime = vi.fn((nextHandler: (event: { type: string }) => void) => {
      handler = nextHandler;
      return vi.fn();
    });
    const onSyncRequired = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectSync = reject;
        })
    );

    renderHook(() =>
      useManagedRealtimeSync({
        client: { connectRealtime },
        enabled: true,
        isSyncing: false,
        onSyncRequired,
        throttleMs: 3000,
      })
    );

    act(() => {
      handler?.({ type: 'conversation:updated' });
      handler?.({ type: 'conversation:updated' });
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectSync?.(new Error('sync failed'));
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(3000);
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(1);
  });

  it('reports realtime-triggered sync failures', async () => {
    let handler: ((event: { type: string }) => void) | undefined;
    const failure = new Error('sync failed');
    const connectRealtime = vi.fn((nextHandler: (event: { type: string }) => void) => {
      handler = nextHandler;
      return vi.fn();
    });
    const onSyncError = vi.fn();

    renderHook(() =>
      useManagedRealtimeSync({
        client: { connectRealtime },
        enabled: true,
        isSyncing: false,
        onSyncRequired: vi.fn(async () => {
          throw failure;
        }),
        onSyncError,
      })
    );

    await act(async () => {
      handler?.({ type: 'message:created' });
      await Promise.resolve();
    });

    expect(onSyncError).toHaveBeenCalledWith(failure, 'message:created');
  });

  it('disconnects manually and suppresses disconnect errors', () => {
    const disconnect = vi.fn(() => {
      throw new Error('disconnect failed');
    });
    const connectRealtime = vi.fn(() => disconnect);
    const onDisconnectError = vi.fn();

    const { result } = renderHook(() =>
      useManagedRealtimeSync({
        client: { connectRealtime },
        enabled: true,
        isSyncing: false,
        onSyncRequired: vi.fn(),
        onDisconnectError,
      })
    );

    expect(() => {
      act(() => {
        result.current.disconnectRealtime('manual');
      });
    }).not.toThrow();

    expect(onDisconnectError).toHaveBeenCalled();
  });

  it('reports connect, event, trigger, and cleanup callbacks', () => {
    let handler: ((event: { type: string } | null) => void) | undefined;
    const disconnect = vi.fn();
    const connectRealtime = vi.fn((nextHandler: (event: { type: string } | null) => void) => {
      handler = nextHandler;
      return disconnect;
    });
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const onEvent = vi.fn();
    const onTrigger = vi.fn();
    const onSyncRequired = vi.fn();

    const { unmount } = renderHook(() =>
      useManagedRealtimeSync({
        client: { connectRealtime },
        enabled: true,
        isSyncing: () => false,
        onSyncRequired,
        onConnect,
        onDisconnect,
        onEvent,
        onTrigger,
      })
    );

    act(() => {
      handler?.(null);
      handler?.({ type: 'conversation:updated' });
    });

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'conversation:updated' });
    expect(onTrigger).toHaveBeenCalledWith('conversation:updated');
    expect(onSyncRequired).toHaveBeenCalledWith('conversation:updated');

    unmount();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledWith('cleanup');
  });

  it('handles connection failures and avoids duplicate inactive disconnects', () => {
    const onConnectError = vi.fn();
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const disconnect = vi.fn();
    const connectRealtime = vi.fn(() => {
      throw new Error('connect failed');
    });

    const { rerender } = renderHook(
      ({ enabled, client }) =>
        useManagedRealtimeSync({
          client,
          enabled,
          isSyncing: false,
          onSyncRequired: vi.fn(),
          onConnect,
          onConnectError,
          onDisconnect,
        }),
      {
        initialProps: {
          enabled: true,
          client: { connectRealtime } as { connectRealtime: () => () => void } | null,
        },
      }
    );

    expect(onConnectError).toHaveBeenCalledWith(expect.any(Error));
    expect(onConnect).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();

    rerender({
      enabled: true,
      client: { connectRealtime: vi.fn(() => disconnect) },
    });
    rerender({
      enabled: false,
      client: { connectRealtime: vi.fn(() => disconnect) },
    });
    rerender({ enabled: true, client: null });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledWith('cleanup');
  });

  it('rechecks queued events while syncing and clears queued work on manual disconnect', () => {
    let handler: ((event: { type: string }) => void) | undefined;
    const disconnect = vi.fn();
    const connectRealtime = vi.fn((nextHandler: (event: { type: string }) => void) => {
      handler = nextHandler;
      return disconnect;
    });
    const onSyncRequired = vi.fn();
    let syncing = true;

    const { result } = renderHook(() =>
      useManagedRealtimeSync({
        client: { connectRealtime },
        enabled: true,
        isSyncing: () => syncing,
        onSyncRequired,
        recheckIntervalMs: 10,
      })
    );

    act(() => {
      handler?.({ type: 'conversation:updated' });
      vi.advanceTimersByTime(10);
    });

    expect(onSyncRequired).not.toHaveBeenCalled();

    act(() => {
      result.current.disconnectRealtime('manual');
      syncing = false;
      vi.advanceTimersByTime(10);
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(onSyncRequired).not.toHaveBeenCalled();
  });
});
