import {
  createSentryTransport,
  createTraceOperation,
  injectActiveTraceContext,
  type SentryLike,
} from '@taskforceai/observability';
import { createStandardAppLogger } from '@taskforceai/observability/standard-logger';
import { isDesktopRuntime } from '@taskforceai/browser-runtime/runtime';
import { configureApiTraceContextInjector } from '@taskforceai/api-client';
import { configureAuthLogger } from '@taskforceai/api-client/auth/logger';
import { configurePersistenceLogger, configurePersistenceTracing } from '@taskforceai/persistence';

const { logger } = createStandardAppLogger({
  app: 'console',
  environment: import.meta.env.MODE,
  isDesktop: isDesktopRuntime(),
});

configureAuthLogger(logger);
configurePersistenceLogger(logger);
configurePersistenceTracing(createTraceOperation('@taskforceai/persistence'));
configureApiTraceContextInjector(injectActiveTraceContext);

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
