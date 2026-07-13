import type { LogEntry, LogLevel, LogTransport } from '@taskforceai/observability/logger';
import { type Result, err, ok } from '@taskforceai/client-core/result';

declare global {
  interface Window {
    __TAURI__?: { invoke?: TauriInvoke };
  }
}

export interface TauriTransportOptions {
  command?: string;
  levels?: LogLevel[];
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  onError?: (error: unknown) => void;
}

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export const createTauriTransport = (options: TauriTransportOptions = {}): LogTransport => {
  const command = options.command ?? 'log_event';
  const enabledLevels = new Set(options.levels ?? ['debug', 'info', 'warn', 'error']);
  const defaultInvoker = createDefaultInvoker();
  const invokeProvider = options.invoke ?? (defaultInvoker.ok ? defaultInvoker.value : undefined);
  const onError = options.onError ?? (() => {});

  return {
    name: 'tauri',
    async log(entry: LogEntry) {
      if (!enabledLevels.has(entry.level) || !invokeProvider) {
        return;
      }
      try {
        await invokeProvider(command, {
          entry,
        });
      } catch (error) {
        onError(error);
      }
    },
    async flush() {
      // No internal queue; present for parity with other async transports.
    },
  };
};

const createDefaultInvoker = (): Result<TauriInvoke, 'UNAVAILABLE'> => {
  if (typeof window === 'undefined') {
    return err('UNAVAILABLE');
  }

  if (window.__TAURI__?.invoke) {
    return ok(window.__TAURI__.invoke);
  }

  return ok(async (command: string, args?: Record<string, unknown>) => {
    const tauriModule = await import('@tauri-apps/api/core');
    return tauriModule.invoke(command, args);
  });
};
