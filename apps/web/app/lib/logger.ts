import {
  createSentryTransport,
  createTraceOperation,
  injectActiveTraceContext,
  type SentryLike,
} from '@taskforceai/observability';
import { createStandardAppLogger } from '@taskforceai/observability/standard-logger';
import { createTauriTransport } from '@taskforceai/observability/tauri-transport';
import { isDesktopRuntime } from '@taskforceai/browser-runtime/runtime';
import { configureApiTraceContextInjector } from '@taskforceai/api-client';
import { configureAuthLogger } from '@taskforceai/api-client/auth/logger';
import { configurePersistenceLogger, configurePersistenceTracing } from '@taskforceai/persistence';
import { configureSyncLogger } from '@taskforceai/sync-client/logger';
import { configureVoiceLogger } from '@taskforceai/voice/logger';
import { configureLogger as configureReactCoreLogger } from '@taskforceai/react-core';

const initiallyDesktop = isDesktopRuntime();
const { logger } = createStandardAppLogger({
  app: 'web',
  environment: import.meta.env.MODE,
  isDesktop: initiallyDesktop,
});

configureAuthLogger(logger);
configureReactCoreLogger(logger);
configurePersistenceLogger(logger);
configurePersistenceTracing(createTraceOperation('@taskforceai/persistence'));
configureApiTraceContextInjector(injectActiveTraceContext);
configureSyncLogger(logger);
configureVoiceLogger(logger);

let hasSentryTransport = false;
let hasDesktopTransport = initiallyDesktop;

export const installDesktopLoggerTransport = (): void => {
  if (hasDesktopTransport || import.meta.env.MODE === 'test') {
    return;
  }

  logger.mergeContext({ runtime: 'desktop' });
  logger.addTransport(
    createTauriTransport({
      levels: ['debug', 'info', 'warn', 'error'],
    })
  );
  hasDesktopTransport = true;
};

export const installSentryLoggerTransport = (sentry: SentryLike): void => {
  if (hasSentryTransport || import.meta.env.MODE === 'test') {
    return;
  }

  logger.addTransport(
    createSentryTransport({
      sentry,
      levels: ['error'],
    })
  );
  hasSentryTransport = true;
};

export { logger };
