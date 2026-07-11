import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

import { useManagedSyncRunner } from './useManagedSyncRunner';

describe('useManagedSyncRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when already syncing or when shouldRun returns false', async () => {
    const runSync = vi.fn(async () => ({ ok: true }));
    const { result, rerender } = renderHook(
      ({ isSyncingRef, shouldRun }) =>
        useManagedSyncRunner({
          isSyncing: () => isSyncingRef.current,
          shouldRun,
          runSync,
        }),
      {
        initialProps: {
          isSyncingRef: { current: true },
          shouldRun: undefined as undefined | (() => boolean),
        },
      }
    );

    await act(async () => {
      await result.current();
    });
    expect(runSync).not.toHaveBeenCalled();

    rerender({
      isSyncingRef: { current: false },
      shouldRun: () => false,
    });

    await act(async () => {
      await result.current();
    });
    expect(runSync).not.toHaveBeenCalled();
  });

  it('runs start, sync, and success handlers in order', async () => {
    const order: string[] = [];
    const { result } = renderHook(() =>
      useManagedSyncRunner({
        isSyncing: () => false,
        beforeRun: () => {
          order.push('before');
        },
        onStart: () => {
          order.push('start');
        },
        runSync: async () => {
          order.push('run');
          return { ok: true };
        },
        onSuccess: async () => {
          order.push('success');
        },
      })
    );

    await act(async () => {
      await result.current();
    });

    expect(order).toEqual(['before', 'start', 'run', 'success']);
  });

  it('normalizes, reports, and rethrows errors when requested', async () => {
    const failure = new Error('boom');
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useManagedSyncRunner({
        isSyncing: () => false,
        runSync: async () => {
          throw failure;
        },
        onError,
      })
    );

    await expect(result.current({ throwOnError: true })).rejects.toThrow('boom');

    expect(onError).toHaveBeenCalledWith(failure, failure);
  });

  it('swallows sync errors by default when throwOnError is omitted', async () => {
    const { result } = renderHook(() =>
      useManagedSyncRunner({
        isSyncing: () => false,
        runSync: async () => {
          throw new Error('boom');
        },
      })
    );

    await act(async () => {
      await expect(result.current()).resolves.toBeUndefined();
    });
  });

  it('normalizes non-error failures and swallows them by default', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useManagedSyncRunner({
        isSyncing: () => false,
        runSync: async () => {
          throw 'broken';
        },
        onError,
      })
    );

    await act(async () => {
      await result.current();
    });

    expect(onError).toHaveBeenCalledWith('broken', expect.objectContaining({ message: 'broken' }));
  });

  it('runs when shouldRun resolves true', async () => {
    const runSync = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() =>
      useManagedSyncRunner({
        isSyncing: () => false,
        shouldRun: async () => true,
        runSync,
      })
    );

    await act(async () => {
      await result.current();
    });

    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent calls while async gates are pending', async () => {
    let releaseShouldRun!: () => void;
    const shouldRun = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          releaseShouldRun = () => resolve(true);
        })
    );
    const runSync = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() =>
      useManagedSyncRunner({
        isSyncing: () => false,
        shouldRun,
        runSync,
      })
    );

    const first = result.current();
    const second = result.current();
    await Promise.resolve();

    expect(shouldRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseShouldRun();
      await Promise.all([first, second]);
    });

    expect(runSync).toHaveBeenCalledTimes(1);
  });
});
