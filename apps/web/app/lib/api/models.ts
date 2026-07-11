import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import { type ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import { fetchModelOptions as baseFetchModels } from '@taskforceai/api-client/utils/models';

import { logger as defaultLogger } from '../logger';
import { type Result, err, ok } from '@taskforceai/client-core/result';
import type { LoggerPort } from '@taskforceai/client-core/ports/logger';
import { readStatusCode } from '@taskforceai/api-client/api/response';
import { definedProps } from '@taskforceai/client-core/utils/object';
import { getServerBaseUrl } from '@taskforceai/config/server-base-url';

export type ModelOptionsError = {
  kind: 'unauthorized' | 'server' | 'network' | 'validation';
  message: string;
  status?: number;
};

const MODEL_REQUEST_TIMEOUT_MS = 30_000;

const withTimeout = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
) => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    return await Promise.race<T>([run(controller.signal), timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const mapModelError = (error: unknown, fallbackMessage: string): ModelOptionsError => {
  const status = readStatusCode(error);
  if (status === 401) {
    return { kind: 'unauthorized', message: fallbackMessage, status };
  }
  if (typeof status === 'number') {
    return { kind: 'server', message: fallbackMessage, status };
  }
  if (error instanceof Error && error.message.length > 0) {
    return { kind: 'network', message: error.message };
  }
  return { kind: 'network', message: fallbackMessage };
};

export const fetchModelOptions = async ({
  client = getBrowserClient(),
  logger = defaultLogger,
}: {
  client?: {
    getModelOptions: (init?: RequestInit) => Promise<ModelSelectorResponse>;
  };
  logger?: LoggerPort | null;
} = {}): Promise<Result<ModelSelectorResponse, ModelOptionsError>> => {
  try {
    const response = await withTimeout(
      (signal) => client.getModelOptions({ signal }),
      MODEL_REQUEST_TIMEOUT_MS,
      'Model options request timed out'
    );
    return ok(response);
  } catch (error) {
    logger?.error('Failed to load model options', { error });
    return err(mapModelError(error, 'Failed to load model options'));
  }
};

export const fetchModelSelectorSnapshot = async ({
  baseUrl = typeof window !== 'undefined' ? '' : getServerBaseUrl(),
  returnFetch = globalThis.fetch,
  logger = defaultLogger,
}: {
  baseUrl?: string;
  returnFetch?: typeof fetch;
  logger?: LoggerPort | null;
} = {}): Promise<Result<ModelSelectorResponse, ModelOptionsError>> => {
  // Skip during SSR/build if running on server without network
  if (typeof window === 'undefined' && !baseUrl) {
    return err({
      kind: 'network',
      message: 'Model selector snapshot unavailable during build',
    });
  }

  const result = await baseFetchModels({
    baseUrl,
    fetch: ((input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MODEL_REQUEST_TIMEOUT_MS);
      const signal = init?.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal;
      return returnFetch(input, {
        ...init,
        signal,
      }).finally(() => {
        clearTimeout(timer);
      });
    }) as typeof fetch,
    cache: 'default',
  });

  if (!result.ok) {
    const error = result.error;
    const status = readStatusCode(error);
    logger?.error('Failed to load model selector snapshot', { error, status });

    if (error.message.includes('schema')) {
      return err({ kind: 'validation', message: 'Model selector snapshot payload invalid' });
    }

    return err({
      kind: typeof status === 'number' ? 'server' : 'network',
      message: 'Failed to load model selector snapshot',
      ...definedProps({ status: typeof status === 'number' ? status : undefined }),
    });
  }

  return ok(result.value);
};
