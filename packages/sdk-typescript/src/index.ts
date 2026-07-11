import type { FileListResponse, FileUploadOptions, File as TFFile } from './files';
import type {
  CreateThreadOptions,
  Thread,
  ThreadListResponse,
  ThreadMessage,
  ThreadMessagesResponse,
  ThreadRunOptions,
  ThreadRunResponse,
} from './threads';
import {
  TaskForceAIError,
  transportDefaults as def,
  makeRawRequest,
  makeRequest,
} from './transport';
import type {
  TaskForceAIOptions,
  TaskResult,
  TaskTerminalStatus,
  TaskStatus,
  TaskStatusCallback,
  TaskStatusStream,
  TaskSubmissionOptions,
} from './types';
import { VERSION } from './types';

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TaskForceAIError('Task polling cancelled'));
      return;
    }
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeoutId);
      reject(new TaskForceAIError('Task polling cancelled'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });

const MOCK_RESULT = 'This is a mock response. Configure your API key to get real results.';
const TERMINAL_TASK_STATUSES = new Set<TaskTerminalStatus>([
  'completed',
  'failed',
  'canceled',
  'awaiting_approval',
]);
const TASK_STATUSES = new Set<TaskStatus['status']>([
  'processing',
  'completed',
  'failed',
  'canceled',
  'awaiting_approval',
]);

const isTerminalTaskStatus = (status: TaskStatus['status']): status is TaskTerminalStatus =>
  TERMINAL_TASK_STATUSES.has(status as TaskTerminalStatus);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TaskForceAIError(`${label} must be a non-empty string`);
  }
  return value;
};

const requirePositiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TaskForceAIError(`${label} must be a positive integer`);
  }
  return value;
};

const readJsonResponse = async <T>(response: Response, label: string): Promise<T> => {
  try {
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TaskForceAIError('Request timeout', response.status);
    }
    throw new TaskForceAIError(`Invalid ${label} response from server`, response.status);
  }
};

const malformedResponse = (label: string, detail: string): TaskForceAIError =>
  new TaskForceAIError(`Invalid ${label} response from server: ${detail}`);

const stringField = (
  payload: Record<string, unknown>,
  field: string,
  label: string,
  required = true
): string | undefined => {
  const value = payload[field];
  if (value === undefined && !required) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw malformedResponse(label, `${field} must be a string`);
  }
  return value;
};

const numberField = (payload: Record<string, unknown>, field: string, label: string): number => {
  const value = payload[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformedResponse(label, `${field} must be a number`);
  }
  return value;
};

const objectPayload = (payload: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(payload)) {
    throw malformedResponse(label, 'payload must be an object');
  }
  return payload;
};

const validateTaskSubmission = (payload: unknown): string => {
  const record = objectPayload(payload, 'task submission');
  const taskId = record['taskId'];
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw malformedResponse('task submission', 'taskId must be a non-empty string');
  }
  return taskId;
};

const validateAttachmentUpload = (payload: unknown): string => {
  const record = objectPayload(payload, 'attachment upload');
  const id = record['id'];
  if (typeof id !== 'string' || !id.trim()) {
    throw malformedResponse('attachment upload', 'id must be a non-empty string');
  }
  return id;
};

const validateTaskStatus = (payload: unknown, label = 'task status'): TaskStatus => {
  const record = objectPayload(payload, label);
  const taskId = record['taskId'];
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw malformedResponse(label, 'taskId must be a non-empty string');
  }
  const status = record['status'];
  if (typeof status !== 'string' || !TASK_STATUSES.has(status as TaskStatus['status'])) {
    throw malformedResponse(label, 'status is unsupported');
  }
  if (record['result'] !== undefined && typeof record['result'] !== 'string') {
    throw malformedResponse(label, 'result must be a string');
  }
  if (record['error'] !== undefined && typeof record['error'] !== 'string') {
    throw malformedResponse(label, 'error must be a string');
  }
  if (record['message'] !== undefined && typeof record['message'] !== 'string') {
    throw malformedResponse(label, 'message must be a string');
  }
  if (
    record['warnings'] !== undefined &&
    (!Array.isArray(record['warnings']) ||
      record['warnings'].some((warning) => typeof warning !== 'string'))
  ) {
    throw malformedResponse(label, 'warnings must be an array of strings');
  }
  if (record['metadata'] !== undefined && !isRecord(record['metadata'])) {
    throw malformedResponse(label, 'metadata must be an object');
  }
  return { ...record, taskId, status: status as TaskStatus['status'] } as TaskStatus;
};

const validateTaskResult = (payload: unknown): TaskResult => {
  const record = objectPayload(payload, 'task result');
  const status = validateTaskStatus(
    record['status'] === undefined ? { ...record, status: 'completed' } : record,
    'task result'
  );
  if (status.status !== 'completed') {
    throw malformedResponse('task result', 'status must be completed');
  }
  if (typeof status.result !== 'string') {
    throw malformedResponse('task result', 'result must be a string');
  }
  return status as TaskResult;
};

const validateThread = (payload: unknown, label = 'thread'): Thread => {
  const record = objectPayload(payload, label);
  numberField(record, 'id', label);
  stringField(record, 'timestamp', label);
  stringField(record, 'user_input', label);
  stringField(record, 'result', label);
  numberField(record, 'execution_time', label);
  stringField(record, 'model', label);
  numberField(record, 'agent_count', label);
  for (const field of ['sources', 'agentStatuses', 'toolEvents']) {
    if (record[field] !== null && !Array.isArray(record[field])) {
      throw malformedResponse(label, `${field} must be an array or null`);
    }
  }
  return record as unknown as Thread;
};

const validateThreadList = (payload: unknown): ThreadListResponse => {
  const record = objectPayload(payload, 'thread list');
  if (!Array.isArray(record['conversations'])) {
    throw malformedResponse('thread list', 'conversations must be an array');
  }
  numberField(record, 'total', 'thread list');
  numberField(record, 'limit', 'thread list');
  numberField(record, 'offset', 'thread list');
  if (typeof record['has_more'] !== 'boolean') {
    throw malformedResponse('thread list', 'has_more must be a boolean');
  }
  record['conversations'].forEach((thread, index) =>
    validateThread(thread, `thread list item ${index}`)
  );
  return record as unknown as ThreadListResponse;
};

const validateThreadMessage = (payload: unknown, label = 'thread message'): ThreadMessage => {
  const record = objectPayload(payload, label);
  numberField(record, 'id', label);
  numberField(record, 'thread_id', label);
  const role = record['role'];
  if (role !== 'user' && role !== 'assistant') {
    throw malformedResponse(label, 'role is unsupported');
  }
  stringField(record, 'content', label);
  stringField(record, 'created_at', label, false);
  return record as unknown as ThreadMessage;
};

const validateThreadMessages = (payload: unknown): ThreadMessagesResponse => {
  const record = objectPayload(payload, 'thread messages');
  if (!Array.isArray(record['messages'])) {
    throw malformedResponse('thread messages', 'messages must be an array');
  }
  if (record['truncated'] !== undefined && typeof record['truncated'] !== 'boolean') {
    throw malformedResponse('thread messages', 'truncated must be a boolean');
  }
  record['messages'].forEach((message, index) =>
    validateThreadMessage(message, `thread message ${index}`)
  );
  return record as unknown as ThreadMessagesResponse;
};

const validateThreadRun = (payload: unknown): ThreadRunResponse => {
  const record = objectPayload(payload, 'thread run');
  stringField(record, 'taskId', 'thread run');
  stringField(record, 'status', 'thread run');
  return record as unknown as ThreadRunResponse;
};

const validateFile = (payload: unknown, label = 'file'): TFFile => {
  const record = objectPayload(payload, label);
  stringField(record, 'id', label);
  stringField(record, 'filename', label);
  stringField(record, 'purpose', label);
  numberField(record, 'bytes', label);
  numberField(record, 'created_at', label);
  stringField(record, 'mime_type', label, false);
  return record as unknown as TFFile;
};

const validateFileList = (payload: unknown): FileListResponse => {
  const record = objectPayload(payload, 'file list');
  const files = Array.isArray(record['files'])
    ? record['files']
    : Array.isArray(record['data'])
      ? record['data']
      : undefined;
  if (!files) {
    throw malformedResponse('file list', 'files must be an array');
  }
  numberField(record, 'total', 'file list');
  files.forEach((file, index) => validateFile(file, `file list item ${index}`));
  return { ...record, files } as unknown as FileListResponse;
};

export class TaskForceAI {
  private ak: string;
  private url: string;
  private t: number;
  private rh?: (r: Response) => void;
  private mm: boolean;
  private mcc: Map<string, number> = new Map();

  constructor(o: TaskForceAIOptions) {
    this.mm = o.mockMode ?? false;
    if (!this.mm && !o.apiKey) {
      throw new TaskForceAIError('API key is required when not in mock mode');
    }
    this.ak = o.apiKey || '';
    this.url = o.baseUrl || 'https://taskforceai.chat/api/v1/developer';
    this.t = o.timeout || def.timeout;
    if (o.responseHook) {
      this.rh = o.responseHook;
    }
  }

  private mockResponse<T>(e: string, method: string): T {
    if (method === 'POST' && e === '/run') {
      const taskId = `mock-${Math.random().toString(36).slice(2, 10)}`;
      this.mcc.set(taskId, 0);
      return { taskId, status: 'processing' } as T;
    }
    if (e.startsWith('/status/')) {
      const taskId = e.split('/').pop()!;
      const count = this.mcc.get(taskId) || 0;
      this.mcc.set(taskId, count + 1);
      if (count < 1) {
        return { taskId, status: 'processing', message: 'Mock task processing...' } as T;
      }
      return { taskId, status: 'completed', result: MOCK_RESULT } as T;
    }
    if (e.startsWith('/results/')) {
      const taskId = e.split('/').pop()!;
      return { taskId, status: 'completed', result: MOCK_RESULT } as T;
    }
    return { status: 'ok' } as T;
  }

  private req = <T>(e: string, i: RequestInit = {}, r = false): Promise<T> => {
    if (this.mm) {
      return Promise.resolve(this.mockResponse<T>(e, i.method || 'GET'));
    }
    const config = { apiKey: this.ak, baseUrl: this.url, timeout: this.t };
    return makeRequest<T>(
      e,
      i,
      this.rh ? { ...config, responseHook: this.rh } : config,
      r,
      def.maxRetries
    );
  };

  private fileResponse = async (
    endpoint: string,
    init: RequestInit,
    action: 'upload' | 'download',
    retryable = false
  ): Promise<Response> => {
    try {
      return await makeRawRequest(
        endpoint,
        init,
        {
          apiKey: this.ak,
          baseUrl: this.url,
          timeout: this.t,
          defaultContentType: false,
          ...(this.rh ? { responseHook: this.rh } : {}),
        },
        retryable,
        def.maxRetries
      );
    } catch (error) {
      if (
        error instanceof TaskForceAIError &&
        typeof error.statusCode === 'number' &&
        error.message.startsWith('HTTP ')
      ) {
        throw new TaskForceAIError(
          `Failed to ${action} file: ${error.statusCode}`,
          error.statusCode
        );
      }
      throw error;
    }
  };

  private apiRootUrl = (): string => this.url.replace(/\/developer\/?$/, '');

  private attachmentResponse = async (init: RequestInit): Promise<Response> =>
    makeRawRequest(
      '/attachments/upload',
      init,
      {
        apiKey: this.ak,
        baseUrl: this.apiRootUrl(),
        timeout: this.t,
        defaultContentType: false,
        ...(this.rh ? { responseHook: this.rh } : {}),
      },
      false,
      def.maxRetries
    );

  async uploadAttachment(file: File | Blob): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await this.attachmentResponse({ method: 'POST', body: formData });
    return validateAttachmentUpload(await readJsonResponse<unknown>(response, 'attachment upload'));
  }

  private async uploadImageAttachment(image: NonNullable<TaskSubmissionOptions['images']>[number]) {
    const encoded = image.data.includes(',') ? image.data.split(',').pop() || '' : image.data;
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: image.mime_type });
    return this.uploadAttachment(
      new File([blob], image.name || 'attachment', { type: image.mime_type })
    );
  }

  async submitTask(p: string, o: TaskSubmissionOptions = {}): Promise<string> {
    requireNonEmptyString(p, 'Prompt');
    const {
      silent: s = false,
      mock: m = false,
      images,
      modelId,
      attachment_ids,
      attachmentIds,
      ...rest
    } = o;
    const options: Record<string, unknown> = { silent: s, mock: m, ...rest };
    const body: Record<string, unknown> = { prompt: p, options };
    if (modelId) body['modelId'] = modelId;
    const resolvedAttachmentIds = [
      ...(attachment_ids ?? []),
      ...(attachmentIds ?? []),
      ...(images && images.length > 0
        ? this.mm
          ? images.map((_, index) => `mock-attachment-${index}`)
          : await Promise.all(images.map((image) => this.uploadImageAttachment(image)))
        : []),
    ];
    if (resolvedAttachmentIds.length > 0) {
      body['attachment_ids'] = resolvedAttachmentIds;
    }
    return validateTaskSubmission(
      await this.req<unknown>('/run', { method: 'POST', body: JSON.stringify(body) })
    );
  }

  async getTaskStatus(id: string, signal?: AbortSignal): Promise<TaskStatus> {
    requireNonEmptyString(id, 'Task ID');
    return validateTaskStatus(await this.req<unknown>(`/status/${id}`, { signal }, true));
  }
  async getTaskResult(id: string): Promise<TaskResult> {
    requireNonEmptyString(id, 'Task ID');
    return validateTaskResult(await this.req<unknown>(`/results/${id}`));
  }

  private async *poll(
    id: string,
    ms: number,
    max: number,
    on?: TaskStatusCallback,
    sig?: AbortSignal
  ) {
    for (let i = 0; i < max; i++) {
      if (sig?.aborted) throw new TaskForceAIError('Task polling cancelled');
      const s = await this.getTaskStatus(id, sig);
      on?.(s);
      yield s;
      if (isTerminalTaskStatus(s.status)) return;
      await sleep(ms, sig);
    }
    throw new TaskForceAIError('Task did not complete within the expected time');
  }

  async waitForCompletion(
    id: string,
    ms: number = def.pollIntervalMs,
    max: number = def.maxPollAttempts,
    on?: TaskStatusCallback,
    sig?: AbortSignal
  ): Promise<TaskResult> {
    for await (const s of this.poll(id, ms, max, on, sig)) {
      if (s.status === 'completed') {
        if (typeof s.result === 'string') {
          return s as TaskResult;
        }
        return this.getTaskResult(id);
      }
      if (s.status === 'failed') throw new TaskForceAIError(s.error || 'Task failed');
      if (s.status === 'canceled') {
        throw new TaskForceAIError(s.error || s.message || 'Task canceled');
      }
      if (s.status === 'awaiting_approval') {
        throw new TaskForceAIError(s.error || s.message || 'Task is awaiting approval');
      }
    }
    throw new TaskForceAIError('Task did not complete within the expected time');
  }

  async runTask(
    p: string,
    o: TaskSubmissionOptions = {},
    ms: number = def.pollIntervalMs,
    max: number = def.maxPollAttempts,
    on?: TaskStatusCallback
  ) {
    return this.waitForCompletion(await this.submitTask(p, o), ms, max, on);
  }

  streamTaskStatus(
    id: string,
    ms: number = def.pollIntervalMs,
    max: number = def.maxPollAttempts,
    on?: TaskStatusCallback,
    sig?: AbortSignal
  ): TaskStatusStream {
    requireNonEmptyString(id, 'Task ID');
    let cancel = false;
    const controller = new AbortController();
    const signal = sig ? AbortSignal.any([sig, controller.signal]) : controller.signal;
    return {
      taskId: id,
      cancel: () => {
        cancel = true;
        controller.abort();
      },
      [Symbol.asyncIterator]: async function* (this: TaskForceAI) {
        try {
          for await (const s of this.poll(id, ms, max, on, signal)) {
            if (cancel) throw new TaskForceAIError('Task stream cancelled');
            yield s;
          }
        } catch (error) {
          if (cancel) throw new TaskForceAIError('Task stream cancelled');
          throw error;
        }
      }.bind(this),
    };
  }

  async runTaskStream(
    p: string,
    o: TaskSubmissionOptions = {},
    ms: number = def.pollIntervalMs,
    max: number = def.maxPollAttempts,
    on?: TaskStatusCallback,
    sig?: AbortSignal
  ) {
    return this.streamTaskStatus(await this.submitTask(p, o), ms, max, on, sig);
  }

  // Thread methods
  async createThread(options?: CreateThreadOptions): Promise<Thread> {
    const body = options?.title === undefined ? {} : { title: options.title };
    return validateThread(
      await this.req<unknown>('/threads', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    );
  }

  async listThreads(limit = 20, offset = 0): Promise<ThreadListResponse> {
    return validateThreadList(await this.req<unknown>(`/threads?limit=${limit}&offset=${offset}`));
  }

  async getThread(threadId: number): Promise<Thread> {
    requirePositiveInteger(threadId, 'Thread ID');
    return validateThread(await this.req<unknown>(`/threads/${threadId}`));
  }

  async deleteThread(threadId: number): Promise<void> {
    void threadId;
    throw new TaskForceAIError(
      'deleteThread is not supported by the current Developer API. Threads cannot be deleted via SDK.'
    );
  }

  async getThreadMessages(
    threadId: number,
    limit = 50,
    offset = 0
  ): Promise<ThreadMessagesResponse> {
    requirePositiveInteger(threadId, 'Thread ID');
    return validateThreadMessages(
      await this.req<unknown>(`/threads/${threadId}/messages?limit=${limit}&offset=${offset}`)
    );
  }

  async runInThread(threadId: number, options: ThreadRunOptions): Promise<ThreadRunResponse> {
    requirePositiveInteger(threadId, 'Thread ID');
    if (!options.prompt?.trim()) {
      throw new TaskForceAIError('Prompt must be a non-empty string');
    }
    const body: Record<string, unknown> = { prompt: options.prompt };
    if (options.modelId !== undefined) body['modelId'] = options.modelId;
    if (options.stream !== undefined) body['stream'] = options.stream;
    return validateThreadRun(
      await this.req<unknown>(`/threads/${threadId}/runs`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    );
  }

  // File methods
  async uploadFile(
    filename: string,
    content: Blob | ArrayBuffer,
    options?: FileUploadOptions
  ): Promise<TFFile> {
    requireNonEmptyString(filename, 'Filename');
    const blob = content instanceof Blob ? content : new Blob([content]);
    const purpose = options?.purpose ?? 'assistants';
    const mimeType = options?.mime_type ?? (blob.type || 'application/octet-stream');

    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('purpose', purpose);
    formData.append('mime_type', mimeType);

    const response = await this.fileResponse(
      '/files',
      {
        method: 'POST',
        body: formData,
      },
      'upload'
    );

    return validateFile(await readJsonResponse<unknown>(response, 'upload'), 'upload');
  }

  async listFiles(limit = 20, offset = 0): Promise<FileListResponse> {
    return validateFileList(await this.req<unknown>(`/files?limit=${limit}&offset=${offset}`));
  }

  async getFile(fileId: string): Promise<TFFile> {
    requireNonEmptyString(fileId, 'File ID');
    return validateFile(await this.req<unknown>(`/files/${fileId}`));
  }

  async deleteFile(fileId: string): Promise<void> {
    requireNonEmptyString(fileId, 'File ID');
    await this.req<void>(`/files/${fileId}`, { method: 'DELETE' });
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    requireNonEmptyString(fileId, 'File ID');
    try {
      const response = await this.fileResponse(
        `/files/${encodeURIComponent(fileId)}/content`,
        { method: 'GET' },
        'download',
        true
      );
      return await response.arrayBuffer();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TaskForceAIError('Request timeout');
      }
      throw error;
    }
  }
}

export {
  TaskForceAIError,
  TaskStatus,
  TaskResult,
  TaskSubmissionOptions,
  TaskStatusCallback,
  TaskStatusStream,
  TaskForceAIOptions,
  VERSION,
  def as transportDefaults,
};
export type { ImageAttachment } from './types';

// Thread exports
export type {
  Thread,
  ThreadMessage,
  CreateThreadOptions,
  ThreadListResponse,
  ThreadMessagesResponse,
  ThreadRunOptions,
  ThreadRunResponse,
} from './threads';

// File exports
export type { File as TFFile, FileUploadOptions, FileListResponse } from './files';
