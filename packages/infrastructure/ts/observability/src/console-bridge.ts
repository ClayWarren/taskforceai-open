import type { ConsoleBridgeHandle, LogLevel, Logger } from '@taskforceai/observability/logger';
import { bridgeConsoleToLogger } from '@taskforceai/observability/logger';

export interface ConsoleBridgeOptions {
  logger: Logger;
  bridgeConsole: boolean;
  preserveNativeConsole: boolean;
  environment: string;
  runtime?: string;
  consoleLevels: LogLevel[];
}

export interface ConsoleBridgeResult {
  consoleBridge?: ConsoleBridgeHandle;
  consoleForTransport?: {
    debug: typeof console.debug;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
  };
}

export const setupConsoleBridge = (options: ConsoleBridgeOptions): ConsoleBridgeResult => {
  const { logger, bridgeConsole, preserveNativeConsole, environment, runtime, consoleLevels } =
    options;

  if (bridgeConsole && typeof window !== 'undefined') {
    const bridge = bridgeConsoleToLogger(logger, {
      levels: consoleLevels,
      preserveNative: preserveNativeConsole,
    });
    if (bridge) {
      return {
        consoleBridge: bridge,
        consoleForTransport: {
          debug: bridge.console.debug,
          info: bridge.console.info,
          warn: bridge.console.warn,
          error: bridge.console.error,
        },
      };
    }
  } else if (bridgeConsole && typeof window === 'undefined') {
    logger.debug('Console bridging requested but window is unavailable; skipping bridge', {
      environment,
      runtime,
    });
  }

  return {};
};
