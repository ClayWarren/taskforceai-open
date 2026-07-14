import * as Sentry from '@sentry/react';
import { createStandardAppLogger } from '@taskforceai/observability/standard-logger';

const { logger } = createStandardAppLogger({
  app: 'status',
  environment: process.env.NODE_ENV,
  sentry: Sentry,
});

export { logger };
