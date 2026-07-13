import {
  createSentryTransport,
  createStandardAppLogger,
  createTraceOperation,
  injectActiveTraceContext,
  type SentryLike,
} from '@taskforceai/observability';
import { isDesktopRuntime } from '@taskforceai/browser-runtime/runtime';
import { configureApiTraceContextInjector } from '@taskforceai/api-client';
import { configureAuthLogger } from '@taskforceai/api-client/auth/logger';
import { configurePersistenceLogger, configurePersistenceTracing } from '@taskforceai/persistence';
import { configureSyncLogger } from '@taskforceai/sync-client/logger';
import { configureVoiceLogger } from '@taskforceai/voice/logger';

const { logger } = createStandardAppLogger({
  app: 'web',
  environment: import.meta.env.MODE,
  isDesktop: isDesktopRuntime(),
});

configureAuthLogger(logger);
configurePersistenceLogger(logger);
configurePersistenceTracing(createTraceOperation('@taskforceai/persistence'));
configureApiTraceContextInjector(injectActiveTraceContext);
configureSyncLogger(logger);
configureVoiceLogger(logger);

let hasSentryTransport = false;

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
