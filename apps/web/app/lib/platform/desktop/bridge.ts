'use client';

const BRIDGE_POLL_INTERVAL_MS = 200;
const BRIDGE_MAX_WAIT_MS = 15_000;
const bridgePromisesByTimeout = new Map<number, Promise<boolean>>();
let importedTauriInvoke: TauriInvoker | null = null;

const getGlobalTauriInvoker = (): TauriInvoker | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const globalObject = window as unknown as {
    __TAURI__?: { core?: { invoke?: TauriInvoker }; invoke?: TauriInvoker };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoker };
  };

  if (globalObject.__TAURI_INTERNALS__?.invoke) {
    return globalObject.__TAURI_INTERNALS__.invoke.bind(globalObject.__TAURI_INTERNALS__);
  }

  if (globalObject.__TAURI__?.core?.invoke) {
    return globalObject.__TAURI__.core.invoke.bind(globalObject.__TAURI__.core);
  }

  if (globalObject.__TAURI__ && typeof globalObject.__TAURI__.invoke === 'function') {
    return globalObject.__TAURI__.invoke.bind(globalObject.__TAURI__);
  }

  return null;
};

const canUseTauriModule = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  const globalObject = window as unknown as {
    __TAURI_IPC__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  return Boolean(globalObject.__TAURI_IPC__ || globalObject.__TAURI_INTERNALS__);
};

const getAvailableTauriInvoker = async (): Promise<TauriInvoker | null> => {
  const globalInvoker = getGlobalTauriInvoker();
  if (globalInvoker) {
    return globalInvoker;
  }

  if (importedTauriInvoke) {
    return importedTauriInvoke;
  }

  if (!canUseTauriModule()) {
    return null;
  }

  try {
    const tauriModule = await import('@tauri-apps/api/core');
    if (typeof tauriModule.invoke === 'function') {
      importedTauriInvoke = tauriModule.invoke as TauriInvoker;
      return importedTauriInvoke;
    }
  } catch {
    return null;
  }

  return null;
};

export const waitForTauriBridge = (timeoutMs: number = BRIDGE_MAX_WAIT_MS): Promise<boolean> => {
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : BRIDGE_MAX_WAIT_MS;

  const existingPromise = bridgePromisesByTimeout.get(normalizedTimeoutMs);
  if (existingPromise) {
    return existingPromise;
  }

  let startCheck: () => void = () => {};
  const promise = new Promise<boolean>((resolve) => {
    const start = Date.now();

    const check = async () => {
      if (typeof window === 'undefined') {
        resolve(false);
        bridgePromisesByTimeout.delete(normalizedTimeoutMs);
        return;
      }

      if (getGlobalTauriInvoker() || (canUseTauriModule() && (await getAvailableTauriInvoker()))) {
        resolve(true);
        bridgePromisesByTimeout.delete(normalizedTimeoutMs);
        return;
      }

      if (Date.now() - start >= normalizedTimeoutMs) {
        resolve(false);
        bridgePromisesByTimeout.delete(normalizedTimeoutMs);
        return;
      }

      window.setTimeout(() => {
        void check();
      }, BRIDGE_POLL_INTERVAL_MS);
    };

    startCheck = () => {
      void check();
    };
  });

  bridgePromisesByTimeout.set(normalizedTimeoutMs, promise);
  startCheck();
  return promise;
};

type TauriInvoker = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriResultParser<T> = (value: unknown) => T;
type TauriUnlisten = () => void;
type TauriEventHandler<T> = (payload: T) => void;
type TauriEventListener<T> = (
  event: string,
  handler: (event: { payload: T }) => void
) => Promise<TauriUnlisten>;

const COMMAND_PATTERN = /^[A-Za-z0-9_.:-]+$/;

export const invokeTauri = async <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
  parseResult?: TauriResultParser<T>
): Promise<T> => {
  const trimmedCommand = command.trim();
  if (!COMMAND_PATTERN.test(trimmedCommand)) {
    throw new Error('Invalid Tauri command');
  }

  const ready = await waitForTauriBridge();
  if (!ready) {
    throw new Error('Tauri bridge not ready');
  }

  const invoker = await getAvailableTauriInvoker();
  if (!invoker) {
    throw new Error('Tauri invoke API is unavailable');
  }

  const result = await invoker(trimmedCommand, args);
  if (parseResult) {
    return parseResult(result);
  }
  return result as T;
};

export const listenTauriEvent = async <T = unknown>(
  event: string,
  handler: TauriEventHandler<T>
): Promise<TauriUnlisten> => {
  const trimmedEvent = event.trim();
  if (!COMMAND_PATTERN.test(trimmedEvent)) {
    throw new Error('Invalid Tauri event');
  }

  const ready = await waitForTauriBridge();
  if (!ready) {
    throw new Error('Tauri bridge not ready');
  }

  try {
    const eventModule = (await import('@tauri-apps/api/event')) as {
      listen?: TauriEventListener<T>;
    };
    if (typeof eventModule.listen !== 'function') {
      throw new Error('Tauri event API is unavailable');
    }

    return await eventModule.listen(trimmedEvent, (payload) => handler(payload.payload));
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Tauri event API is unavailable', { cause: error });
  }
};
