import {
  createDebouncedLatestWriteQueue,
  type DebouncedLatestWriteQueue,
} from '@taskforceai/client-runtime';
import { useCallback, useEffect, useRef } from 'react';

import { logger } from '../logger';
import { useConversationStore } from '../platform/PlatformProvider';
import type { SourceReference, ToolUsageEvent } from '../types';

const STREAM_WRITE_DEBOUNCE_MS = 500;

export interface PendingDbWrite {
  messageId: string;
  conversationId: string;
  content: string;
  isStreaming: boolean;
  error: string | null;
  sources?: SourceReference[];
  isAgentStatus?: boolean;
}

export interface PendingToolEventsWrite {
  messageId: string;
  conversationId: string | null;
  toolEvents: ToolUsageEvent[];
}

interface StreamingPersistenceQueuesOptions {
  ensureActiveConversation: () => Promise<string>;
}

export function useStreamingPersistenceQueues({
  ensureActiveConversation,
}: StreamingPersistenceQueuesOptions) {
  const conversationStore = useConversationStore();
  const isMountedRef = useRef(true);
  const persistDbWriteRef = useRef<(payload: PendingDbWrite) => Promise<void>>(async () => {});
  const persistToolEventsWriteRef = useRef<(payload: PendingToolEventsWrite) => Promise<void>>(
    async () => {}
  );
  const dbWriteQueueRef = useRef<DebouncedLatestWriteQueue<PendingDbWrite> | null>(null);
  const toolEventsWriteQueueRef = useRef<DebouncedLatestWriteQueue<PendingToolEventsWrite> | null>(
    null
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  persistDbWriteRef.current = async (payload: PendingDbWrite) => {
    await conversationStore.upsertMessage({
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      role: 'assistant',
      content: payload.content,
      isStreaming: payload.isStreaming,
      error: payload.error,
      ...(payload.sources ? { sources: payload.sources } : {}),
      ...(payload.isAgentStatus !== undefined ? { isAgentStatus: payload.isAgentStatus } : {}),
    });
  };

  persistToolEventsWriteRef.current = async (payload: PendingToolEventsWrite) => {
    const activeConversationId = payload.conversationId ?? (await ensureActiveConversation());
    if (!isMountedRef.current) {
      return;
    }

    await conversationStore.upsertMessage({
      conversationId: activeConversationId,
      messageId: payload.messageId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      isAgentStatus: true,
      sources: [],
      toolEvents: payload.toolEvents,
    });
  };

  if (!dbWriteQueueRef.current) {
    dbWriteQueueRef.current = createDebouncedLatestWriteQueue({
      debounceMs: STREAM_WRITE_DEBOUNCE_MS,
      persist: (payload) => persistDbWriteRef.current(payload),
      onError: (error) => {
        logger.error('[useStreamingMessages] Failed to flush pending message', { error });
      },
    });
  }

  if (!toolEventsWriteQueueRef.current) {
    toolEventsWriteQueueRef.current = createDebouncedLatestWriteQueue({
      debounceMs: STREAM_WRITE_DEBOUNCE_MS,
      persist: (payload) => persistToolEventsWriteRef.current(payload),
      onError: (error) => {
        logger.error('[useStreamingMessages] Failed to flush pending tool events', { error });
      },
    });
  }

  const appendQueuedContentWrite = useCallback(
    (payload: PendingDbWrite) => dbWriteQueueRef.current?.enqueue(payload),
    []
  );

  const appendQueuedToolEventsWrite = useCallback(
    (payload: PendingToolEventsWrite) => toolEventsWriteQueueRef.current?.enqueue(payload),
    []
  );

  const flushPendingDbWritesImmediately = useCallback(async () => {
    await dbWriteQueueRef.current?.flushNow();
  }, []);

  const flushPendingToolEventsWritesImmediately = useCallback(async () => {
    await toolEventsWriteQueueRef.current?.flushNow();
  }, []);

  const disposeStreamingPersistenceQueues = useCallback(() => {
    dbWriteQueueRef.current?.dispose();
    toolEventsWriteQueueRef.current?.dispose();
  }, []);

  return {
    conversationStore,
    appendQueuedContentWrite,
    appendQueuedToolEventsWrite,
    flushPendingDbWritesImmediately,
    flushPendingToolEventsWritesImmediately,
    disposeStreamingPersistenceQueues,
  };
}
