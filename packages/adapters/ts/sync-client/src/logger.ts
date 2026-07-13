import { createDelegatingLogger, type LoggerPort } from '@taskforceai/client-core/ports/logger';

const syncLogger = createDelegatingLogger();

export const configureSyncLogger = syncLogger.configure;
export const getSyncLogger = (): LoggerPort => syncLogger.logger;
