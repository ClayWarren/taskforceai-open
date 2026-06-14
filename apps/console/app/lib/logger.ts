import * as Sentry from '@sentry/react';
import { createStandardAppLogger } from '@taskforceai/observability';
import { isDesktopRuntime } from '@taskforceai/shared/utils/runtime';

const { logger } = createStandardAppLogger({
  app: 'console',
  environment: import.meta.env.MODE,
  sentry: Sentry,
  isDesktop: isDesktopRuntime(),
});

export { logger };
