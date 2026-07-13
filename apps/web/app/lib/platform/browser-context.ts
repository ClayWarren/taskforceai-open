import { type Result, err, ok } from '@taskforceai/client-core/result';

export type BrowserContextError = {
  kind: 'unavailable';
  message: string;
};

/**
 * Read the current browser origin when available.
 */
export const getBrowserOrigin = (): Result<string, BrowserContextError> => {
  if (typeof window === 'undefined') {
    return err({ kind: 'unavailable', message: 'Browser origin unavailable.' });
  }

  return ok(window.location.origin);
};
