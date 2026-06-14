import { buildRunFormData } from '../attachments';
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
} from '../contracts';
import { createHelpers, encodePathSegment, type RequestContext } from './helpers';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const RUN_TASK_TIMEOUT_MS = 180_000;

type ReactNativeFormDataFile = { uri: string; name: string; type: string };

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
      const fd = new FormData();
      fd.append('file', file as Blob);
      const response = await request(
        '/api/v1/attachments/upload',
        { method: 'POST', body: fd },
        { parseJson: true }
      );
      return attachmentUploadResponseSchema.parse(response);
    },

    runTask: async (b: RunRequest): Promise<RunResponse> => {
      const p = runRequestSchema.parse(b);
      const idempotencyKey = resolveIdempotencyKey(p.options);

      const rawAttachmentsInput = (b as { attachments?: unknown }).attachments;
      const rawAttachments = Array.isArray(rawAttachmentsInput) ? rawAttachmentsInput : [];
      const uriAttachments = rawAttachments.filter(hasUriAttachmentShape);
      const dataAttachments = rawAttachments.filter(hasDataAttachmentShape);

      if (uriAttachments.length > 0) {
        const payload = {
          ...p,
          attachments: dataAttachments.length > 0 ? dataAttachments : undefined,
          audio_attachments: (b as any).audio_attachments,
          video_attachments: (b as any).video_attachments,
        };
        const fd = buildRunFormData(payload as any, uriAttachments);
        const requestInit: RequestInit = { method: 'POST', body: fd };
        if (idempotencyKey) {
          const headers = new Headers();
          headers.set('Idempotency-Key', idempotencyKey);
          requestInit.headers = headers;
        }
        const response = await request('/api/v1/run', requestInit, {
          timeoutMs: RUN_TASK_TIMEOUT_MS,
        });
        return runResponseSchema.parse(response);
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
          body: JSON.stringify(p),
        },
        { timeoutMs: RUN_TASK_TIMEOUT_MS }
      );
      return runResponseSchema.parse(response);
    },
  };
};
