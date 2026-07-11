import {
  type AttachmentUploadResponse,
  type ApproveTaskRequest,
  type ActiveTasksResponse,
  type ExecutionTraceResponse,
  type RunRequest,
  type RunResponse,
  activeTasksResponseSchema,
  approveTaskRequestSchema,
  attachmentUploadResponseSchema,
  executionTraceResponseSchema,
  runRequestSchema,
  runResponseSchema,
} from '@taskforceai/contracts/contracts';
import { normalizeReactNativeFileAttachment, type RunTaskAttachment } from '../attachments';
import { createHelpers, encodePathSegment, type RequestContext } from './helpers';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const RUN_TASK_TIMEOUT_MS = 180_000;

type ReactNativeFormDataFile = RunTaskAttachment;

const hasUriAttachmentShape = (
  value: unknown
): value is { uri: string; name: string; type?: string } =>
  isRecord(value) &&
  typeof value['uri'] === 'string' &&
  value['uri'].trim().length > 0 &&
  typeof value['name'] === 'string' &&
  value['name'].trim().length > 0 &&
  (typeof value['type'] === 'undefined' || typeof value['type'] === 'string');

const hasDataAttachmentShape = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && typeof value['data'] === 'string' && value['data'].trim().length > 0;

const dataAttachmentToFile = (attachment: Record<string, unknown>): File | Blob => {
  const encoded = String(attachment['data']);
  const base64 = encoded.includes(',') ? encoded.split(',').pop() || '' : encoded;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const mimeType =
    typeof attachment['mime_type'] === 'string'
      ? attachment['mime_type']
      : typeof attachment['format'] === 'string'
        ? `audio/${attachment['format']}`
        : 'application/octet-stream';
  const blob = new Blob([bytes], { type: mimeType });
  return typeof File !== 'undefined' && typeof attachment['name'] === 'string'
    ? new File([blob], attachment['name'], { type: mimeType })
    : blob;
};

const resolveIdempotencyKey = (options: unknown): string | undefined => {
  if (typeof options !== 'object' || options === null) {
    return undefined;
  }
  const key = (options as { idempotencyKey?: unknown }).idempotencyKey;
  if (typeof key !== 'string') {
    return undefined;
  }
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const createTasksClient = (context: RequestContext) => {
  const { request, get } = createHelpers(context);

  const uploadAttachmentBody = async (
    file: File | Blob | ReactNativeFormDataFile
  ): Promise<AttachmentUploadResponse> => {
    const fd = new FormData();
    const safeFile = hasUriAttachmentShape(file) ? normalizeReactNativeFileAttachment(file) : file;
    fd.append('file', safeFile as Blob);
    const response = await request(
      '/api/v1/attachments/upload',
      { method: 'POST', body: fd },
      { parseJson: true }
    );
    return attachmentUploadResponseSchema.parse(response);
  };

  return {
    getExecutionTrace: (taskId: string): Promise<ExecutionTraceResponse> =>
      get(`/api/v1/tasks/${encodePathSegment(taskId)}/trace`, executionTraceResponseSchema),

    listActiveTasks: (limit = 25): Promise<ActiveTasksResponse> =>
      get(
        `/api/v1/tasks/active?limit=${encodeURIComponent(String(limit))}`,
        activeTasksResponseSchema
      ),

    approveTask: async (taskId: string, body: ApproveTaskRequest): Promise<string> => {
      const payload = approveTaskRequestSchema.parse(body);
      const response = await request(`/api/v1/tasks/${encodeURIComponent(taskId)}/approve`, {
        method: 'POST',
        headers: context.buildJsonHeaders(),
        body: JSON.stringify(payload),
      });
      return typeof response === 'string' ? response : 'Decision sent';
    },

    cancelTask: async (taskId: string): Promise<RunResponse> => {
      const response = await request(`/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
        headers: context.buildJsonHeaders(),
      });
      return runResponseSchema.parse(response);
    },

    uploadAttachment: async (
      file: File | Blob | ReactNativeFormDataFile
    ): Promise<AttachmentUploadResponse> => {
      return uploadAttachmentBody(file);
    },

    runTask: async (b: RunRequest): Promise<RunResponse> => {
      const p = runRequestSchema.parse(b);
      const idempotencyKey = resolveIdempotencyKey(p.options);

      const rawAttachmentsInput = (b as { attachments?: unknown }).attachments;
      const rawAttachments = Array.isArray(rawAttachmentsInput) ? rawAttachmentsInput : [];
      const uriAttachments = rawAttachments.filter(hasUriAttachmentShape);
      const dataAttachments = rawAttachments.filter(hasDataAttachmentShape);

      const legacyAudioAttachments = Array.isArray((b as any).audio_attachments)
        ? ((b as any).audio_attachments as unknown[]).filter(hasDataAttachmentShape)
        : [];
      const legacyVideoAttachments = Array.isArray((b as any).video_attachments)
        ? ((b as any).video_attachments as unknown[]).filter(hasDataAttachmentShape)
        : [];
      const uploadedAttachmentIds = await Promise.all([
        ...uriAttachments.map((attachment) => uploadAttachmentBody(attachment)),
        ...dataAttachments.map((attachment) =>
          uploadAttachmentBody(dataAttachmentToFile(attachment))
        ),
        ...legacyAudioAttachments.map((attachment) =>
          uploadAttachmentBody(dataAttachmentToFile(attachment))
        ),
        ...legacyVideoAttachments.map((attachment) =>
          uploadAttachmentBody(dataAttachmentToFile(attachment))
        ),
      ]);
      const attachmentIds = [
        ...(p.attachment_ids ?? []),
        ...uploadedAttachmentIds.map((attachment) => attachment.id),
      ];
      const {
        attachments: _attachments,
        audio_attachments: _audioAttachments,
        video_attachments: _videoAttachments,
        ...jsonPayload
      } = p as Record<string, unknown>;
      if (attachmentIds.length > 0) {
        jsonPayload['attachment_ids'] = attachmentIds;
      } else {
        delete jsonPayload['attachment_ids'];
      }

      const headers = context.buildJsonHeaders();
      if (idempotencyKey) {
        headers.set('Idempotency-Key', idempotencyKey);
      }
      const response = await request(
        '/api/v1/run',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(jsonPayload),
        },
        { timeoutMs: RUN_TASK_TIMEOUT_MS }
      );
      return runResponseSchema.parse(response);
    },
  };
};
