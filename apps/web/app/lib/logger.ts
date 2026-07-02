import { createStandardAppLogger } from '@taskforceai/observability';
import { createSentryTransport, type SentryLike } from '@taskforceai/shared/logger';
import { isDesktopRuntime } from '@taskforceai/shared/utils/runtime';

const { logger } = createStandardAppLogger({
  app: 'web',
  environment: import.meta.env.MODE,
  isDesktop: isDesktopRuntime(),
});

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
