import type { LogLevel } from '@taskforceai/observability/logger';

export const DEFAULT_CONSOLE_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export const resolveConsoleLevels = ({
  environment,
  runtime,
  explicitLevels,
  productionServerLevels,
}: {
  environment: string;
  runtime?: string | undefined;
  explicitLevels?: LogLevel[] | undefined;
  productionServerLevels?: LogLevel[] | undefined;
}): LogLevel[] => {
  if (explicitLevels) return explicitLevels;
  if (environment !== 'production') return DEFAULT_CONSOLE_LEVELS;
  if (runtime === 'desktop') return ['error'];
  if (runtime === 'server' && productionServerLevels) return productionServerLevels;
  return ['warn', 'error'];
};
