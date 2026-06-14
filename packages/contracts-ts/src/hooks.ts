'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from './client';
import { ApiClientError } from './client';
import type { RunRequest } from './contracts';
import { type Result, ok } from './utils/result';

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}
export interface UseApiResult<T> extends UseApiState<T> {
  refetch: () => Promise<void>;
}
export interface UseMutationResult<TD, TV> {
  mutate: (v: TV) => Promise<Result<TD>>;
  loading: boolean;
  error: Error | null;
  data: TD | null;
  reset: () => void;
}

export function useApi<T>(
  f: () => Promise<T>,
  d: readonly unknown[] = [],
  o?: { onUnauthorized?: (e: ApiClientError) => void }
): UseApiResult<T> {
  const [s, set] = useState<UseApiState<T>>({ data: null, loading: true, error: null });
  const fRef = useRef(f);
  const onUnauthorizedRef = useRef(o?.onUnauthorized);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  // Keep refs in sync with latest props
  useEffect(() => {
    fRef.current = f;
    onUnauthorizedRef.current = o?.onUnauthorized;
  }, [f, o?.onUnauthorized]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    },
    []
  );

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    set((p) => ({ ...p, loading: true, error: null }));
    try {
      const data = await fRef.current();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      set({ data, loading: false, error: null });
    } catch (e: unknown) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const err = e instanceof Error ? e : new Error('Unknown error');
      if (err instanceof ApiClientError && onUnauthorizedRef.current && err.status === 401)
        onUnauthorizedRef.current(err);
      set({ data: null, loading: false, error: err });
    }
  }, []); // Explicitly empty, depends on refs

  useEffect(() => {
    void load();
  }, [load, ...d]); // Only re-run when explicit dependencies change

  return { ...s, refetch: load };
}

export function useMutation<TD, TV>(fn: (v: TV) => Promise<TD>): UseMutationResult<TD, TV> {
  const [s, set] = useState<UseApiState<TD>>({ data: null, loading: false, error: null });
  const mutate = useCallback(
    async (v: TV): Promise<Result<TD>> => {
      set({ data: null, loading: true, error: null });
      try {
        const data = await fn(v);
        set({ data, loading: false, error: null });
        return ok(data);
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error('Unknown error');
        set({ data: null, loading: false, error: err });
        return { ok: false, error: err };
      }
    },
    [fn]
  );
  return { mutate, ...s, reset: () => set({ data: null, loading: false, error: null }) };
}

export const useConversations = (c: ApiClient, l?: number) =>
  useApi(() => c.getConversations(l), [c, l]);
export const useCurrentUser = (c: ApiClient) => useApi(() => c.currentUser(), [c]);
export const useSubscription = (c: ApiClient) => useApi(() => c.getSubscription(), [c]);
export const useProducts = (c: ApiClient) => useApi(() => c.getProducts(), [c]);
export const useRunTask = (c: ApiClient) => useMutation((b: RunRequest) => c.runTask(b));
export const useDeleteConversation = (c: ApiClient) =>
  useMutation((id: number) => c.deleteConversation(id));
export const useUpdateTheme = (c: ApiClient) => useMutation((t: unknown) => c.updateTheme(t));
export const useCreateSubscription = (c: ApiClient) =>
  useMutation((id: string) => c.createSubscription(id));
export const useCancelSubscription = (c: ApiClient) => useMutation(() => c.cancelSubscription());

export const getErrorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'An unknown error occurred';
export const isApiError = (e: unknown, s?: number): e is ApiClientError =>
  e instanceof ApiClientError && (s === undefined || e.status === s);
