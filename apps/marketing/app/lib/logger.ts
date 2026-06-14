import * as Sentry from '@sentry/react';
import { createStandardAppLogger } from '@taskforceai/observability';
import type { SentryLike } from '@taskforceai/shared/logger';
import { isDesktopRuntime } from '@taskforceai/shared/utils/runtime';

const { logger } = createStandardAppLogger({
  app: 'marketing',
  environment: process.env.NODE_ENV,
  sentry: Sentry as SentryLike,
  isDesktop: isDesktopRuntime(),
});

export { logger };
