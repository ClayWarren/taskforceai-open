export const VERSION = '1.4.0';

export interface TaskForceAIOptions {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  responseHook?: TaskResponseHook;
  mockMode?: boolean;
}

export interface ImageAttachment {
  /** Base64-encoded image data */
  data: string;
  /** Image MIME type (e.g. "image/jpeg", "image/png") */
  mime_type: string;
  /** Optional filename */
  name?: string;
  /** Vision detail level: "auto", "low", or "high" (default: auto) */
  detail?: 'auto' | 'low' | 'high';
}

export type TaskSubmissionOptions = {
  [key: string]: unknown;
  modelId?: string;
  silent?: boolean;
  mock?: boolean;
  /** Attachment IDs returned by the transient `/attachments/upload` endpoint. */
  attachment_ids?: string[];
  /** Attachment IDs returned by the transient `/attachments/upload` endpoint. */
  attachmentIds?: string[];
  /** @deprecated Images are uploaded first and submitted as `attachment_ids`. */
  images?: ImageAttachment[];
};

export type TaskTerminalStatus = 'completed' | 'failed' | 'canceled' | 'awaiting_approval';
export type TaskStatusValue = 'processing' | TaskTerminalStatus;

export interface TaskStatus {
  taskId: string;
  status: TaskStatusValue;
  result?: string;
  error?: string;
  message?: string;
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface TaskResult extends TaskStatus {
  status: 'completed';
  result: string;
}

export type TaskStatusCallback = (status: TaskStatus) => void;
export type TaskResponseHook = (response: Response) => void;

export interface TaskStatusStream extends AsyncIterable<TaskStatus> {
  taskId: string;
  cancel(): void;
}
