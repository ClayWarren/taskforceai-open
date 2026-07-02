export interface DebouncedLatestWriteQueue<T> {
  enqueue: (payload: T) => void;
  flushNow: () => Promise<void>;
  dispose: () => void;
}

export interface CreateDebouncedLatestWriteQueueOptions<T> {
  debounceMs: number;
  persist: (payload: T) => Promise<void>;
  onError?: (error: unknown) => void;
}

interface QueuedWrite<T> {
  payload: T;
  sequence: number;
}

export function createDebouncedLatestWriteQueue<T>({
  debounceMs,
  persist,
  onError,
}: CreateDebouncedLatestWriteQueueOptions<T>): DebouncedLatestWriteQueue<T> {
  let pendingWrite: QueuedWrite<T> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let writeSequence = 0;
  let scheduleVersion = 0;
  let lifecycleVersion = 0;
  let activeFlushPromise: Promise<void> | null = null;

  const clearScheduledFlush = () => {
    if (!timeoutId) {
      return;
    }
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  const flushPendingWrites = async (scheduledVersion?: number): Promise<void> => {
    if (lifecycleVersion === 0) {
      return;
    }

    if (scheduledVersion !== undefined && scheduledVersion !== scheduleVersion) {
      return;
    }

    if (activeFlushPromise) {
      await activeFlushPromise;
      if (pendingWrite) {
        await flushPendingWrites();
      }
      return;
    }

    const activeLifecycleVersion = lifecycleVersion;
    const processPendingWrite = async (): Promise<void> => {
      if (activeLifecycleVersion !== lifecycleVersion) {
        return;
      }

      const queuedWrite = pendingWrite;
      if (!queuedWrite) {
        return;
      }

      pendingWrite = null;

      try {
        await persist(queuedWrite.payload);
      } catch (error) {
        if (activeLifecycleVersion === lifecycleVersion) {
          onError?.(error);
        }
      }

      await processPendingWrite();
    };

    const flushPromise = processPendingWrite();
    activeFlushPromise = flushPromise;

    try {
      await flushPromise;
    } finally {
      if (activeFlushPromise === flushPromise) {
        activeFlushPromise = null;
      }

      if (activeLifecycleVersion === lifecycleVersion && pendingWrite) {
        await flushPendingWrites();
      }
    }
  };

  const scheduleFlush = () => {
    scheduleVersion += 1;
    const nextScheduledVersion = scheduleVersion;

    clearScheduledFlush();

    const nextTimeoutId = setTimeout(() => {
      if (timeoutId === nextTimeoutId) {
        timeoutId = null;
      }

      void flushPendingWrites(nextScheduledVersion);
    }, debounceMs);

    timeoutId = nextTimeoutId;
  };

  lifecycleVersion = 1;

  return {
    enqueue(payload) {
      if (lifecycleVersion === 0) {
        return;
      }

      writeSequence += 1;
      pendingWrite = {
        payload,
        sequence: writeSequence,
      };
      scheduleFlush();
    },
    async flushNow() {
      scheduleVersion += 1;
      clearScheduledFlush();
      await flushPendingWrites();
    },
    dispose() {
      lifecycleVersion = 0;
      scheduleVersion += 1;
      clearScheduledFlush();
      pendingWrite = null;
    },
  };
}
