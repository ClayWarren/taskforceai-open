import { env } from '@taskforceai/shared/config/env';
import { createAppLogger } from '@taskforceai/observability';
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';

// During Bun-driven tests the React Native bridge and observability stack are not available.
// Provide a lightweight stub so hooks/components can import a logger without pulling native code.
const makeTestLogger = () => {
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
};

const isBunTest = env.BUN_TEST === '1';

const baseLogger = isBunTest
  ? makeTestLogger()
  : createAppLogger({
      app: 'mobile',
      environment: __DEV__ ? 'development' : 'production',
      runtime: Platform.OS,
      isTest: false,
      enableConsole: true,
      bridgeConsole: false,
      preserveNativeConsole: __DEV__,
      consoleLevels: __DEV__ ? ['info', 'warn', 'error'] : ['warn', 'error'],
      sentry: {
        client: Sentry,
        levels: ['error'],
        includeMetadata: false,
      },
    }).logger;

export const mobileLogger = baseLogger;

export const createModuleLogger = (
  module: string,
  context: Record<string, unknown> = {}
) => baseLogger.child({ module, ...context });
