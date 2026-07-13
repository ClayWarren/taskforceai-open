import { useCallback, useRef } from 'react';

export interface ManagedSyncRunnerOptions<TStats> {
  isSyncing: () => boolean;
  shouldRun?: () => boolean | Promise<boolean>;
  beforeRun?: () => void | Promise<void>;
  runSync: () => Promise<TStats>;
  onStart?: () => void;
  onSuccess?: (stats: TStats) => void | Promise<void>;
  onError?: (error: unknown, normalizedError: Error) => void | Promise<void>;
  normalizeError?: (error: unknown) => Error;
}

const defaultNormalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const useManagedSyncRunner = <TStats>({
  isSyncing,
  shouldRun,
  beforeRun,
  runSync,
  onStart,
  onSuccess,
  onError,
  normalizeError = defaultNormalizeError,
}: ManagedSyncRunnerOptions<TStats>) => {
  const inFlightRef = useRef(false);

  return useCallback(
    async (options: { throwOnError?: boolean } = {}): Promise<void> => {
      if (inFlightRef.current || isSyncing()) {
        return;
      }

      inFlightRef.current = true;
      try {
        if (shouldRun && !(await shouldRun())) {
          return;
        }

        if (isSyncing()) {
          return;
        }

        await beforeRun?.();

        if (isSyncing()) {
          return;
        }

        onStart?.();

        try {
          const stats = await runSync();
          await onSuccess?.(stats);
        } catch (error) {
          const normalizedError = normalizeError(error);
          await onError?.(error, normalizedError);
          if (options.throwOnError) {
            throw normalizedError;
          }
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [beforeRun, isSyncing, normalizeError, onError, onStart, onSuccess, runSync, shouldRun]
  );
};
