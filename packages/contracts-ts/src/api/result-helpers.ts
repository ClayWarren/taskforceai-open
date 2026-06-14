import { readStatusCode } from '@taskforceai/shared/utils/api';

import { type Result, err, ok } from '../utils/result';

export type ApiStatusError = {
  kind: 'unauthorized' | 'server' | 'network';
  message: string;
  status?: number;
};

export const mapStatusError = (error: unknown, fallbackMessage: string): ApiStatusError => {
  const status = readStatusCode(error);
  if (status === 401) {
    return { kind: 'unauthorized', message: fallbackMessage, status };
  }
  if (typeof status === 'number') {
    return { kind: 'server', message: fallbackMessage, status };
  }
  return { kind: 'network', message: fallbackMessage };
};

export const unwrapResult = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
};

export const runApiOperation = async <T, E>(
  message: string,
  mapError: (error: unknown, message: string) => E,
  logError: (message: string, details: Record<string, unknown>) => void,
  operation: () => Promise<T>,
  details: Record<string, unknown> = {}
): Promise<Result<T, E>> => {
  try {
    return ok(await operation());
  } catch (error) {
    logError(message, { error, ...details });
    return err(mapError(error, message));
  }
};
