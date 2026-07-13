import { createDelegatingLogger, type LoggerPort } from '@taskforceai/client-core/ports/logger';

const authLogger = createDelegatingLogger();

export const configureAuthLogger = authLogger.configure;
export const getAuthLogger = (): LoggerPort => authLogger.logger;
