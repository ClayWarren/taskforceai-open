export type {
  ConversationRecord,
  MessageRecord,
  PendingPromptRecord,
  UpsertMessageParams,
  ConversationStoreEvent,
  ConversationStoreSubscriber,
  ConversationStore,
} from '@taskforceai/client-runtime';

export type PlatformRuntime = 'browser' | 'desktop' | 'server';

export interface StreamingRuntimeHandlers {
  onOpen?: () => void;
  onMessage?: (payload: string) => void;
  onError?: (error: unknown) => void;
}

export interface StreamingRuntime {
  startStreaming(taskId: string, handlers: StreamingRuntimeHandlers): Promise<void>;
  stopStreaming(): void;
  cancelTask?(taskId: string): Promise<void>;
}
