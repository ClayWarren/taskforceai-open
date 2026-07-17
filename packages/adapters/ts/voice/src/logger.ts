import { createDelegatingLogger, type LoggerPort } from '@taskforceai/client-core/ports/logger';

export type VoiceLogger = LoggerPort;

const voiceLogger = createDelegatingLogger();

export const configureVoiceLogger = voiceLogger.configure;
export const getVoiceLogger = (): VoiceLogger => voiceLogger.logger;
