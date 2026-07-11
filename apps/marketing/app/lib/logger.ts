import { createStandardAppLogger } from '@taskforceai/observability/standard-logger';

const { logger } = createStandardAppLogger({
  app: 'marketing',
  environment: process.env.NODE_ENV,
  isDesktop: false,
});

export { logger };
