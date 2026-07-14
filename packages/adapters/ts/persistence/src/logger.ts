import { createDelegatingLogger, type LoggerPort } from '@taskforceai/client-core/ports/logger';

const persistenceLogger = createDelegatingLogger();

export const configurePersistenceLogger = persistenceLogger.configure;
export const getPersistenceLogger = (): LoggerPort => persistenceLogger.logger;
