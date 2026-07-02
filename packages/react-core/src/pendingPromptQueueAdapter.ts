import { type RunRequest, runRequestSchema } from '@taskforceai/contracts/contracts';

import { extractQueuedRunPayloadMetadata } from '@taskforceai/client-runtime';
import { definedProps } from '@taskforceai/shared/utils/object';

import type { PendingPromptRecord } from './types';
import type { StartStreamingOptions } from './stores/createStreamingStore';
import type { PendingPromptQueueAdapter, RunTaskResponse } from './usePendingPromptQueue';

export interface PendingPromptQueueStorageAdapter {
  listPendingPrompts: () => Promise<PendingPromptRecord[]>;
  updatePromptStatus: (id: number, status: PendingPromptRecord['status']) => Promise<void>;
  removePrompt: (id: number) => Promise<void>;
}

export type PendingPromptListResult =
  | { ok: true; value: PendingPromptRecord[] }
  | { ok: false; error: unknown };

export interface ResultPendingPromptQueueStorageOptions {
  listPendingPrompts: () => Promise<PendingPromptListResult>;
  updatePromptStatus: (id: number, status: PendingPromptRecord['status']) => Promise<void>;
  removePrompt: (id: number) => Promise<void>;
  logger?: {
    error: (message: string, metadata?: unknown) => void;
  };
}

export interface CreatePendingPromptQueueAdapterOptions {
  storage: PendingPromptQueueStorageAdapter;
  runTask: (body: RunRequest) => Promise<RunTaskResponse>;
  startStreaming: (options: StartStreamingOptions) => Promise<void>;
  invalidatePendingPrompts?: () => void;
}

const buildReplayRunRequest = (
  prompt: string,
  options: {
    idempotencyKey: string;
    modelId?: string;
    attachmentIds?: string[];
    runPayload?: PendingPromptRecord['runPayload'];
  }
): RunRequest => {
  const parsedPayload = runRequestSchema.safeParse(options.runPayload);
  if (parsedPayload.success) {
    if (hasMcpClientTools(parsedPayload.data)) {
      throw nonRetryableReplayError(
        'Queued prompts with MCP client tools require an approval handler'
      );
    }
    const legacyMetadata = extractQueuedRunPayloadMetadata(options.runPayload);
    const attachmentIds = parsedPayload.data.attachment_ids ?? legacyMetadata.attachmentIds;
    const payload = { ...parsedPayload.data } as RunRequest & Record<string, unknown>;
    delete payload['attachmentIds'];
    delete payload['conversationId'];
    return {
      ...payload,
      prompt,
      demo: payload.demo ?? false,
      ...(attachmentIds && attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
      options: {
        ...payload.options,
        idempotencyKey: options.idempotencyKey,
      },
    };
  }

  const { attachmentIds, modelId } = extractQueuedRunPayloadMetadata({
    ...(options.modelId ? { modelId: options.modelId } : {}),
    ...(options.attachmentIds?.length ? { attachmentIds: options.attachmentIds } : {}),
  });

  return {
    prompt,
    demo: false,
    ...(modelId ? { modelId } : {}),
    ...(attachmentIds && attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
    options: { idempotencyKey: options.idempotencyKey },
  };
};

const nonRetryableReplayError = (message: string): Error & { status: number } => {
  const error = new Error(message) as Error & { status: number };
  error.status = 400;
  return error;
};

const hasMcpClientTools = (payload: RunRequest): boolean => {
  const clientTools = payload.options?.['clientTools'];
  if (!clientTools) {
    return false;
  }
  if (Array.isArray(clientTools)) {
    return clientTools.length > 0;
  }
  if (typeof clientTools === 'object') {
    const maybeMcpTools = (clientTools as { mcp?: unknown }).mcp;
    return Array.isArray(maybeMcpTools) && maybeMcpTools.length > 0;
  }
  return false;
};

export const createPendingPromptQueueAdapter = ({
  storage,
  runTask,
  startStreaming,
  invalidatePendingPrompts,
}: CreatePendingPromptQueueAdapterOptions): PendingPromptQueueAdapter => ({
  listPendingPrompts: storage.listPendingPrompts,
  updatePromptStatus: storage.updatePromptStatus,
  removePrompt: storage.removePrompt,
  runTask: async (
    prompt: string,
    options: {
      idempotencyKey: string;
      modelId?: string;
      attachmentIds?: string[];
      runPayload?: PendingPromptRecord['runPayload'];
    }
  ): Promise<RunTaskResponse> => {
    return runTask(buildReplayRunRequest(prompt, options));
  },
  startStreaming,
  ...definedProps({ invalidatePendingPrompts }),
});

export const createResultPendingPromptQueueStorage = ({
  listPendingPrompts,
  updatePromptStatus,
  removePrompt,
  logger,
}: ResultPendingPromptQueueStorageOptions): PendingPromptQueueStorageAdapter => ({
  listPendingPrompts: async () => {
    const result = await listPendingPrompts();
    if (result.ok) {
      return result.value;
    }
    logger?.error('Failed to fetch pending prompts', { error: result.error });
    return [];
  },
  updatePromptStatus,
  removePrompt,
});
