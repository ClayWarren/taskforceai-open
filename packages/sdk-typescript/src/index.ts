import type { FileListResponse, FileUploadOptions, File as TFFile } from './files';
import type {
  CreateThreadOptions,
  Thread,
  ThreadListResponse,
  ThreadMessagesResponse,
  ThreadRunOptions,
  ThreadRunResponse,
} from './threads';
import { TaskForceAIError, transportDefaults as def, makeRequest } from './transport';
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });

const MOCK_RESULT = 'This is a mock response. Configure your API key to get real results.';
const TERMINAL_TASK_STATUSES = new Set<TaskTerminalStatus>([
  'completed',
  'failed',
  'awaiting_approval',
]);

const isTerminalTaskStatus = (status: TaskStatus['status']): status is TaskTerminalStatus =>
  TERMINAL_TASK_STATUSES.has(status as TaskTerminalStatus);

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

  async submitTask(p: string, o: TaskSubmissionOptions = {}): Promise<string> {
    requireNonEmptyString(p, 'Prompt');
    const { silent: s = false, mock: m = false, images, modelId, ...rest } = o;
    const options: Record<string, unknown> = { silent: s, mock: m, ...rest };
    const body: Record<string, unknown> = { prompt: p, options };
    if (modelId) body['modelId'] = modelId;
    if (images && images.length > 0) {
      body['attachments'] = images;
    }
    return (
      await this.req<{ taskId: string }>('/run', { method: 'POST', body: JSON.stringify(body) })
    ).taskId;
  }

  async getTaskStatus(id: string): Promise<TaskStatus> {
    requireNonEmptyString(id, 'Task ID');
    return this.req<TaskStatus>(`/status/${id}`, {}, true);
  }
  async getTaskResult(id: string): Promise<TaskResult> {
    requireNonEmptyString(id, 'Task ID');
    return this.req<TaskResult>(`/results/${id}`);
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
      const s = await this.getTaskStatus(id);
      on?.(s);
      yield s;
      if (isTerminalTaskStatus(s.status)) return;
      await sleep(ms);
    }
    throw new TaskForceAIError('Task did not complete within the expected time');
  }

  async waitForCompletion(
    id: string,
    ms = def.pollIntervalMs,
    max = def.maxPollAttempts,
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
      if (s.status === 'awaiting_approval') {
        throw new TaskForceAIError(s.error || s.message || 'Task is awaiting approval');
      }
    }
    throw new TaskForceAIError('Task did not complete within the expected time');
  }

  async runTask(
    p: string,
    o: TaskSubmissionOptions = {},
    ms = def.pollIntervalMs,
    max = def.maxPollAttempts,
    on?: TaskStatusCallback
  ) {
    return this.waitForCompletion(await this.submitTask(p, o), ms, max, on);
  }

  streamTaskStatus(
    id: string,
    ms = def.pollIntervalMs,
    max = def.maxPollAttempts,
    on?: TaskStatusCallback,
    sig?: AbortSignal
  ): TaskStatusStream {
    requireNonEmptyString(id, 'Task ID');
    let cancel = false;
    return {
      taskId: id,
      cancel: () => (cancel = true),
      [Symbol.asyncIterator]: async function* (this: TaskForceAI) {
        for await (const s of this.poll(id, ms, max, on, sig)) {
          if (cancel) throw new TaskForceAIError('Task stream cancelled');
          yield s;
        }
      }.bind(this),
    };
  }

  async runTaskStream(
    p: string,
    o: TaskSubmissionOptions = {},
    ms = def.pollIntervalMs,
    max = def.maxPollAttempts,
    on?: TaskStatusCallback,
    sig?: AbortSignal
  ) {
    return this.streamTaskStatus(await this.submitTask(p, o), ms, max, on, sig);
  }

  // Thread methods
  async createThread(options?: CreateThreadOptions): Promise<Thread> {
    return this.req<Thread>('/threads', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  async listThreads(limit = 20, offset = 0): Promise<ThreadListResponse> {
    return this.req<ThreadListResponse>(`/threads?limit=${limit}&offset=${offset}`);
  }

  async getThread(threadId: number): Promise<Thread> {
    requirePositiveInteger(threadId, 'Thread ID');
    return this.req<Thread>(`/threads/${threadId}`);
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
    return this.req<ThreadMessagesResponse>(
      `/threads/${threadId}/messages?limit=${limit}&offset=${offset}`
    );
  }

  async runInThread(threadId: number, options: ThreadRunOptions): Promise<ThreadRunResponse> {
    requirePositiveInteger(threadId, 'Thread ID');
    if (!options.prompt?.trim()) {
      throw new TaskForceAIError('Prompt must be a non-empty string');
    }
    return this.req<ThreadRunResponse>(`/threads/${threadId}/runs`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
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

    const url = `${this.url}/files`;
    const headers: Record<string, string> = {};
    if (this.ak) headers['x-api-key'] = this.ak;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new TaskForceAIError(`Failed to upload file: ${response.status}`);
    }

    return response.json() as Promise<TFFile>;
  }

  async listFiles(limit = 20, offset = 0): Promise<FileListResponse> {
    return this.req<FileListResponse>(`/files?limit=${limit}&offset=${offset}`);
  }

  async getFile(fileId: string): Promise<TFFile> {
    requireNonEmptyString(fileId, 'File ID');
    return this.req<TFFile>(`/files/${fileId}`);
  }

  async deleteFile(fileId: string): Promise<void> {
    requireNonEmptyString(fileId, 'File ID');
    await this.req<void>(`/files/${fileId}`, { method: 'DELETE' });
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    requireNonEmptyString(fileId, 'File ID');
    const url = `${this.url}/files/${fileId}/content`;
    const headers: Record<string, string> = {};
    if (this.ak) headers['x-api-key'] = this.ak;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new TaskForceAIError(`Failed to download file: ${response.status}`);
    }

    return response.arrayBuffer();
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
