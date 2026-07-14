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

const getClientTools = (runPayload: unknown): unknown => {
  if (!runPayload || typeof runPayload !== 'object') {
    return undefined;
  }
  const options = (runPayload as { options?: unknown }).options;
  if (!options || typeof options !== 'object') {
    return undefined;
  }
  return (options as { clientTools?: unknown }).clientTools;
};

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

export const hasQueuedMcpClientTools = (runPayload: unknown): boolean => {
  const clientTools = getClientTools(runPayload);
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

export const stripQueuedMcpClientTools = (runPayload: RunRequest): RunRequest => {
  if (!runPayload.options || typeof runPayload.options !== 'object') {
    return runPayload;
  }
  const options = runPayload.options as Record<string, unknown>;
  if (!Object.hasOwn(options, 'clientTools')) {
    return runPayload;
  }

  const nextOptions = { ...options };
  delete nextOptions['clientTools'];
  const nextPayload = { ...runPayload } as RunRequest & Record<string, unknown>;
  if (Object.keys(nextOptions).length > 0) {
    nextPayload.options = nextOptions as RunRequest['options'];
  } else {
    delete nextPayload['options'];
  }
  return nextPayload;
};
