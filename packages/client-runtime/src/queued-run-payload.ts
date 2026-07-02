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

const extractStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  let strings: string[] | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string') {
      continue;
    }
    if (!strings) {
      strings = [];
    }
    strings.push(item);
  }

  return strings?.length ? strings : undefined;
};

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

  const attachmentIds =
    extractStringArray(payload.attachment_ids) ?? extractStringArray(payload.attachmentIds);
  const metadata: QueuedRunPayloadMetadata = {};

  if (typeof payload.modelId === 'string' && payload.modelId.length > 0) {
    metadata.modelId = payload.modelId;
  }
  if (attachmentIds) {
    metadata.attachmentIds = attachmentIds;
  }

  return metadata;
};
