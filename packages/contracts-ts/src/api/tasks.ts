import { getBrowserClient } from '@taskforceai/contracts/browserClient';
import type { ExecutionTrace, RunRequest, RunResponse } from '@taskforceai/contracts/contracts';
import { getCsrfToken } from '@taskforceai/contracts/auth/csrf';

import { getAuthLogger } from '../auth/logger';
import { type Result, err, ok } from '../utils/result';
import { readErrorBody, readStatusCode } from '@taskforceai/shared/utils/api';
import { classifyApiError } from './error-utils';

export type RunTaskError = {
  kind: 'rate_limit' | 'unauthorized' | 'server' | 'network' | 'not_found';
  message: string;
  status?: number;
  resetTime?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readResetTime = (body: unknown): string | undefined => {
  if (!isRecord(body)) {
    return undefined;
  }
  const resetTime = body['resetTime'];
  return typeof resetTime === 'string' ? resetTime : undefined;
};

const mapRunTaskError = (error: unknown, fallbackMessage: string): RunTaskError => {
  const status = readStatusCode(error);
  if (status === 429) {
    const body = readErrorBody(error);
    const resetTime = readResetTime(body);
    return {
      kind: 'rate_limit',
      message: fallbackMessage,
      status,
      ...(resetTime !== undefined ? { resetTime } : {}),
    };
  }
  const classified = classifyApiError(error);
  return {
    kind: classified.kind,
    message: fallbackMessage,
    ...(classified.status !== undefined ? { status: classified.status } : {}),
  };
};

const logger = getAuthLogger();

export const runTask = async (payload: RunRequest): Promise<Result<RunResponse, RunTaskError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    const data = await client.runTask(payload);
    return ok(data);
  } catch (error) {
    logger.error('Failed to run task', { error });
    return err(mapRunTaskError(error, 'Failed to run task'));
  }
};

export const cancelTask = async (taskId: string): Promise<Result<RunResponse, RunTaskError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    const data = await client.cancelTask(taskId);
    return ok(data);
  } catch (error) {
    logger.error('Failed to cancel task', { error, taskId });
    return err(mapRunTaskError(error, 'Failed to stop run'));
  }
};

export const uploadAttachment = async (file: File | Blob): Promise<string> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    const response = await client.uploadAttachment(file);
    return response.id;
  } catch (error) {
    logger.error('Failed to upload attachment', { error });
    throw error;
  }
};

export const fetchExecutionTrace = async (
  taskId: string
): Promise<Result<ExecutionTrace, RunTaskError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    const response = await client.getExecutionTrace(taskId);
    return ok(response.trace);
  } catch (error) {
    const mapped = mapRunTaskError(error, 'Failed to fetch execution trace');
    if (mapped.status !== 404) {
      logger.error('Failed to fetch execution trace', { error, taskId });
    }
    return err(mapped);
  }
};
