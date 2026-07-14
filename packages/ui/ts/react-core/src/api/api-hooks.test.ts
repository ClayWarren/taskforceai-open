import { describe, expect, it, vi } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import '../../../../../../tests/setup/dom';

import { ApiClientError } from '@taskforceai/api-client/client';
import { getErrorMessage, isApiError, useApi, useMutation } from './api-hooks';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('contracts hooks', () => {
  it('useApi resolves data and supports refetch', async () => {
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const { result } = renderHook(() => useApi(load, [load]));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBe('first');

    await act(async () => {
      await result.current.refetch();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe('second');
  });

  it('useApi calls onUnauthorized callback for 401 errors', async () => {
    const unauthorizedError = new ApiClientError(401, { detail: 'Unauthorized' }, 'Unauthorized');
    const load = vi.fn().mockRejectedValue(unauthorizedError);
    const onUnauthorized = vi.fn();

    const { result } = renderHook(() =>
      useApi(load, [load], {
        onUnauthorized,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(onUnauthorized).toHaveBeenCalledWith(unauthorizedError);
    expect(result.current.error).toBe(unauthorizedError);
  });

  it('useApi completes loads after React StrictMode remounts the hook', async () => {
    const load = vi.fn().mockResolvedValue('strict-data');
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(StrictMode, null, children);

    const { result } = renderHook(() => useApi(load, [load]), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe('strict-data');
    expect(result.current.error).toBeNull();
  });

  it('useApi accepts dependency lists whose length changes between renders', async () => {
    const load = vi.fn().mockResolvedValue('data');
    let dependencies: readonly unknown[] = ['first'];
    const { rerender } = renderHook(() => useApi(load, dependencies));

    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
    });

    dependencies = ['first', 'second'];
    rerender();

    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  it('useApi ignores stale responses when dependencies change', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const firstLoad = vi.fn(() => first.promise);
    const secondLoad = vi.fn(() => second.promise);
    let load = firstLoad;

    const { result, rerender } = renderHook(() => useApi(load, [load]));

    load = secondLoad;
    rerender();

    await act(async () => {
      second.resolve('fresh');
      await second.promise;
    });

    await waitFor(() => {
      expect(result.current.data).toBe('fresh');
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      first.resolve('stale');
      await first.promise;
    });

    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(secondLoad).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe('fresh');
    expect(result.current.error).toBeNull();
  });

  it('useMutation returns ok result on success', async () => {
    const mutateFn = vi.fn(async (value: number) => value * 2);
    const { result } = renderHook(() => useMutation<number, number>(mutateFn));

    let mutationResult: any = null;
    await act(async () => {
      mutationResult = await result.current.mutate(4);
    });

    expect(mutationResult?.ok).toBe(true);
    expect(mutationResult && mutationResult.ok ? mutationResult.value : undefined).toBe(8);
    expect(result.current.data).toBe(8);
    expect(result.current.error).toBeNull();
  });

  it('useMutation returns err result on failure', async () => {
    const failure = new Error('Mutation failed');
    const mutateFn = vi.fn(async () => {
      throw failure;
    });
    const { result } = renderHook(() => useMutation<string, string>(mutateFn));

    let mutationResult: any = null;
    await act(async () => {
      mutationResult = await result.current.mutate('payload');
    });

    expect(mutationResult?.ok).toBe(false);
    expect(mutationResult && !mutationResult.ok ? mutationResult.error : undefined).toBe(failure);
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeNull();
  });

  it('exposes helper guards for API errors and messages', () => {
    const apiError = new ApiClientError(500, { detail: 'Oops' }, 'Oops');

    expect(getErrorMessage(apiError)).toBe('Oops');
    expect(getErrorMessage('bad payload')).toBe('An unknown error occurred');
    expect(isApiError(apiError)).toBe(true);
    expect(isApiError(apiError, 500)).toBe(true);
    expect(isApiError(apiError, 401)).toBe(false);
    expect(isApiError(new Error('nope'))).toBe(false);
  });
});
