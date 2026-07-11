import type { LoggerPort } from '@taskforceai/client-core/ports/logger';

export type VoiceLogger = LoggerPort;

const noop = (): void => {};
let target: VoiceLogger = { debug: noop, info: noop, warn: noop, error: noop };

const logger: VoiceLogger = {
  debug: (message, metadata) => target.debug(message, metadata),
  info: (message, metadata) => target.info(message, metadata),
  warn: (message, metadata) => target.warn(message, metadata),
  error: (message, metadata) => target.error(message, metadata),
};

export const configureVoiceLogger = (configured: VoiceLogger): void => {
  target = configured;
};

export const getVoiceLogger = (): VoiceLogger => logger;
