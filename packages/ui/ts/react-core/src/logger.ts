import { createDelegatingLogger, type LoggerPort } from '@taskforceai/client-core/ports/logger';

export interface LoggerInterface extends LoggerPort {}

const packageLogger = createDelegatingLogger();

export const configureLogger = packageLogger.configure;
export const logger: LoggerInterface = packageLogger.logger;
