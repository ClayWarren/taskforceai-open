export type {
  ConversationRecord,
  ConversationStore,
  ConversationStoreEvent,
  ConversationStoreSubscriber,
  MessageRecord,
  PendingPromptRecord,
  UpsertMessageParams,
} from '@taskforceai/client-runtime';

export type PlatformRuntime = 'browser' | 'desktop';

export interface StreamingRuntimeHandlers {
  onOpen?: () => void;
  onMessage?: (payload: string) => void;
  onError?: (error: unknown) => void;
}

export interface StreamingRuntime {
  startStreaming(taskId: string, handlers: StreamingRuntimeHandlers): Promise<void>;
  stopStreaming(): void;
}
