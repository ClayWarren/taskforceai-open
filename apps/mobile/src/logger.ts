import { env } from '@taskforceai/config/env';
import {
  createAppLogger,
  createTraceOperation,
  injectActiveTraceContext,
} from '@taskforceai/observability';
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { configureApiTraceContextInjector } from '@taskforceai/api-client';
import { configureAuthLogger } from '@taskforceai/api-client/auth/logger';
import { configurePersistenceLogger, configurePersistenceTracing } from '@taskforceai/persistence';
import { configureSyncLogger } from '@taskforceai/sync-client/logger';
import { configureVoiceLogger } from '@taskforceai/voice/logger';

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

configureAuthLogger(baseLogger);
configurePersistenceLogger(baseLogger);
configurePersistenceTracing(createTraceOperation('@taskforceai/persistence'));
configureApiTraceContextInjector(injectActiveTraceContext);
configureSyncLogger(baseLogger);
configureVoiceLogger(baseLogger);

export const createModuleLogger = (
  module: string,
  context: Record<string, unknown> = {}
) => baseLogger.child({ module, ...context });
