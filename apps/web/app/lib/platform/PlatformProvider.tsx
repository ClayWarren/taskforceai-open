'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { dexieStorage } from '../storage/dexie-adapter';
import type { StorageAdapter } from '@taskforceai/persistence';
import { createBrowserConversationStore } from './browser/conversation-store';
import { createBrowserStreamingRuntime } from './browser/streaming-runtime';
import { createLazyAsyncProxy, createLazyResourceLoader } from './lazy-resource';
import type { ConversationStore, PlatformRuntime, StreamingRuntime } from './platform-interfaces';
import { detectRuntime } from '@taskforceai/shared/utils/runtime';
import { logger as platformLogger } from '../logger';

const ConversationStoreContext = createContext<ConversationStore | null>(null);
export const StreamingRuntimeContext = createContext<StreamingRuntime | null>(null);
const PlatformRuntimeContext = createContext<PlatformRuntime>('browser');
const StorageAdapterContext = createContext<StorageAdapter | null>(null);

interface PlatformProviderProps {
  children: ReactNode;
}

const RUNTIME_PROMOTION_POLL_MS = 250;
const RUNTIME_PROMOTION_TIMEOUT_MS = 15_000;

const desktopConversationStoreLoader = createLazyResourceLoader(async () => {
  const module = await import('./desktop/conversation-store');
  return module.createDesktopConversationStore();
});

const createLazyDesktopConversationStore = (): ConversationStore => {
  const store = createLazyAsyncProxy<Omit<ConversationStore, 'subscribe'>>(
    desktopConversationStoreLoader.get
  ) as ConversationStore;

  store.subscribe = (listener) => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const attemptSubscribe = () => {
      desktopConversationStoreLoader
        .get()
        .then((resolvedStore) => {
          if (!active) {
            return;
          }
          unsubscribe = resolvedStore.subscribe(listener);
        })
        .catch((error: unknown) => {
          if (!active) return;
          platformLogger.error('Failed to subscribe to conversation store, retrying', { error });
          retryTimeout = globalThis.setTimeout(attemptSubscribe, 1000);
        });
    };

    attemptSubscribe();

    return () => {
      active = false;
      unsubscribe?.();
      if (retryTimeout !== null) {
        globalThis.clearTimeout(retryTimeout);
        retryTimeout = null;
      }
    };
  };

  return store;
};

const desktopStreamingRuntimeLoader = createLazyResourceLoader(async () => {
  const module = await import('./desktop/streaming-runtime');
  return module.createDesktopStreamingRuntime();
});

const createLazyDesktopStreamingRuntime = (): StreamingRuntime => {
  const runtime = createLazyAsyncProxy<Pick<StreamingRuntime, 'startStreaming'>>(
    desktopStreamingRuntimeLoader.get
  ) as StreamingRuntime;

  runtime.stopStreaming = () => {
    desktopStreamingRuntimeLoader.getResolved()?.stopStreaming();
  };

  return runtime;
};

const desktopStorageAdapterLoader = createLazyResourceLoader(async () => {
  const module = await import('../storage/tauri-adapter');
  return module.tauriStorage;
});

const createLazyDesktopStorageAdapter = (): StorageAdapter =>
  createLazyAsyncProxy(desktopStorageAdapterLoader.get);

export const PlatformProvider = ({ children }: PlatformProviderProps) => {
  const [runtime, setRuntime] = useState<PlatformRuntime>(() => detectRuntime());

  useEffect(() => {
    if (runtime === 'desktop' || typeof window === 'undefined') {
      return;
    }

    let cancelled = false;
    const deadline = Date.now() + RUNTIME_PROMOTION_TIMEOUT_MS;

    const probeRuntime = () => {
      if (cancelled) {
        return;
      }

      if (detectRuntime() === 'desktop') {
        setRuntime('desktop');
        return;
      }

      if (Date.now() < deadline) {
        window.setTimeout(probeRuntime, RUNTIME_PROMOTION_POLL_MS);
      }
    };

    probeRuntime();

    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const conversationStore = useMemo<ConversationStore>(() => {
    return runtime === 'desktop'
      ? createLazyDesktopConversationStore()
      : createBrowserConversationStore();
  }, [runtime]);

  const streamingRuntime = useMemo<StreamingRuntime>(() => {
    return runtime === 'desktop'
      ? createLazyDesktopStreamingRuntime()
      : createBrowserStreamingRuntime();
  }, [runtime]);

  const storageAdapterInstance = useMemo<StorageAdapter>(() => {
    return runtime === 'desktop' ? createLazyDesktopStorageAdapter() : dexieStorage;
  }, [runtime]);

  return (
    <PlatformRuntimeContext.Provider value={runtime}>
      <ConversationStoreContext.Provider value={conversationStore}>
        <StreamingRuntimeContext.Provider value={streamingRuntime}>
          <StorageAdapterContext.Provider value={storageAdapterInstance}>
            {children}
          </StorageAdapterContext.Provider>
        </StreamingRuntimeContext.Provider>
      </ConversationStoreContext.Provider>
    </PlatformRuntimeContext.Provider>
  );
};

export const useConversationStore = (): ConversationStore => {
  const store = useContext(ConversationStoreContext);
  if (!store) {
    throw new Error('useConversationStore must be used within PlatformProvider');
  }
  return store;
};

export const useStreamingRuntime = (): StreamingRuntime => {
  const runtime = useContext(StreamingRuntimeContext);
  if (!runtime) {
    throw new Error('useStreamingRuntime must be used within PlatformProvider');
  }
  return runtime;
};

export const usePlatformRuntime = (): PlatformRuntime => {
  return useContext(PlatformRuntimeContext);
};

export const useStorageAdapter = (): StorageAdapter => {
  const adapter = useContext(StorageAdapterContext);
  if (!adapter) {
    throw new Error('useStorageAdapter must be used within PlatformProvider');
  }
  return adapter;
};
