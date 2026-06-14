import type { RunRequest } from '@taskforceai/contracts/contracts';

export interface QueuedRunPayloadOptions {
  prompt: string;
  modelId?: string | null;
  attachmentIds?: string[] | null;
}

export interface QueuedRunPayloadMetadata {
  modelId?: string;
  attachmentIds?: string[];
}

export const createQueuedRunPayload = ({
  prompt,
  modelId,
  attachmentIds,
}: QueuedRunPayloadOptions): RunRequest | undefined => {
  const normalizedAttachmentIds =
    Array.isArray(attachmentIds) && attachmentIds.length > 0 ? attachmentIds : undefined;

  if (!modelId && !normalizedAttachmentIds) {
    return undefined;
  }

  return {
    prompt,
    demo: false,
    ...(modelId ? { modelId } : {}),
    ...(normalizedAttachmentIds ? { attachment_ids: normalizedAttachmentIds } : {}),
  };
};

export const extractQueuedRunPayloadMetadata = (runPayload: unknown): QueuedRunPayloadMetadata => {
  if (!runPayload || typeof runPayload !== 'object') {
    return {};
  }

  const payload = runPayload as {
    modelId?: unknown;
    attachment_ids?: unknown;
    attachmentIds?: unknown;
  };

  const attachmentIds = Array.isArray(payload.attachment_ids)
    ? payload.attachment_ids.filter((value): value is string => typeof value === 'string')
    : Array.isArray(payload.attachmentIds)
      ? payload.attachmentIds.filter((value): value is string => typeof value === 'string')
      : undefined;

  return {
    ...(typeof payload.modelId === 'string' && payload.modelId.length > 0
      ? { modelId: payload.modelId }
      : {}),
    ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
  };
};
