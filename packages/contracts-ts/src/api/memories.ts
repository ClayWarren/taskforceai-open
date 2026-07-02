import { getBrowserClient } from '@taskforceai/contracts/browserClient';
import type {
  CreateMemoryRequest,
  Memory,
  UpdateMemoryRequest,
} from '@taskforceai/contracts/contracts';
import { getCsrfToken } from '../auth/csrf';

import { getAuthLogger } from '../auth/logger';
import { type Result, err, ok } from '../utils/result';
import { classifyApiError } from './error-utils';

export type MemoriesError = {
  kind: 'unauthorized' | 'not_found' | 'server' | 'network';
  message: string;
  status?: number;
};

const mapMemoriesError = (error: unknown, fallbackMessage: string): MemoriesError => {
  const classified = classifyApiError(error);
  return {
    kind: classified.kind,
    message: fallbackMessage,
    ...(classified.status !== undefined ? { status: classified.status } : {}),
  };
};

const logger = getAuthLogger();

export const fetchMemories = async (): Promise<Result<Memory[], MemoriesError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    return ok(await client.listMemories());
  } catch (error) {
    const memoriesError = mapMemoriesError(error, 'Failed to load memories');
    logger.error('Failed to load memories', { error, memoriesError });
    return err(memoriesError);
  }
};

export const createMemory = async (
  request: CreateMemoryRequest
): Promise<Result<true, MemoriesError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    await client.createMemory(request);
    return ok(true);
  } catch (error) {
    const memoriesError = mapMemoriesError(error, 'Failed to create memory');
    logger.error('Failed to create memory', { error, memoriesError });
    return err(memoriesError);
  }
};

export const updateMemory = async (
  id: number,
  request: UpdateMemoryRequest
): Promise<Result<Memory, MemoriesError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    return ok(await client.updateMemory(id, request));
  } catch (error) {
    const memoriesError = mapMemoriesError(error, 'Failed to update memory');
    logger.error('Failed to update memory', { error, memoriesError, id });
    return err(memoriesError);
  }
};

export const deleteMemory = async (id: number): Promise<Result<true, MemoriesError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    await client.deleteMemory(id);
    return ok(true);
  } catch (error) {
    const memoriesError = mapMemoriesError(error, 'Failed to delete memory');
    logger.error('Failed to delete memory', { error, memoriesError, id });
    return err(memoriesError);
  }
};
