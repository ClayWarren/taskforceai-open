import {
  initialStreamingLifecycleState,
  selectStreamingContentId,
  selectStreamingStatusId,
  streamingLifecycleReducer,
  type StreamingLifecycleState,
} from '@taskforceai/shared/streaming/lifecycle';
import { useCallback, useEffect, useReducer, useRef, type MutableRefObject } from 'react';

export interface UseStreamingLifecycleOptions {
  isStreaming: boolean;
  streamContent: string;
  finalResponse: string | null;
  errorMessage: string | null;
  conversationId: string | null;
  ensureActiveConversation: () => Promise<string>;
  dispatchFinalResponseOnProp?: boolean;
  resetWhenIdle?: boolean;
}

export interface StreamingLifecycleController {
  state: StreamingLifecycleState;
  contentMessageId: string | null;
  statusMessageId: string | null;
  isMountedRef: MutableRefObject<boolean>;
  resolveConversationId: () => Promise<string>;
  dispatchPlaceholderError: () => void;
  dispatchPlaceholdersReady: (ids: { statusMessageId: string; contentMessageId: string }) => void;
  dispatchAppendContent: (content: string) => void;
  dispatchFinalResponse: (finalResponse: string) => void;
  dispatchError: (message: string) => void;
  resetStreamingState: () => void;
}

export function useStreamingLifecycle({
  isStreaming,
  streamContent,
  finalResponse,
  errorMessage,
  conversationId,
  ensureActiveConversation,
  dispatchFinalResponseOnProp = true,
  resetWhenIdle = false,
}: UseStreamingLifecycleOptions): StreamingLifecycleController {
  const [state, dispatch] = useReducer(streamingLifecycleReducer, initialStreamingLifecycleState);
  const isMountedRef = useRef(true);
  const contentMessageId = selectStreamingContentId(state);
  const statusMessageId = selectStreamingStatusId(state);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const resolveConversationId = useCallback(async () => {
    return conversationId ?? (await ensureActiveConversation());
  }, [conversationId, ensureActiveConversation]);

  useEffect(() => {
    if (isStreaming) {
      dispatch({ type: 'START_STREAM' });
      return;
    }
    if (
      resetWhenIdle &&
      state.state !== 'idle' &&
      state.state !== 'finalizing' &&
      !finalResponse &&
      !errorMessage
    ) {
      dispatch({ type: 'RESET' });
    }
  }, [errorMessage, finalResponse, isStreaming, resetWhenIdle, state.state]);

  useEffect(() => {
    if (!streamContent) return;
    dispatch({
      type: contentMessageId ? 'APPEND_CONTENT' : 'BUFFER_CONTENT',
      content: streamContent,
    });
  }, [contentMessageId, streamContent]);

  useEffect(() => {
    if (!dispatchFinalResponseOnProp) return;
    if (finalResponse) {
      dispatch({ type: 'FINAL_RESPONSE', finalResponse });
    }
  }, [dispatchFinalResponseOnProp, finalResponse]);

  useEffect(() => {
    if (errorMessage) {
      dispatch({ type: 'ERROR', message: errorMessage });
    }
  }, [errorMessage]);

  const dispatchPlaceholderError = useCallback(() => {
    dispatch({ type: 'ERROR', message: 'Failed to create placeholders' });
  }, []);

  const dispatchPlaceholdersReady = useCallback(
    ({
      statusMessageId: nextStatusMessageId,
      contentMessageId: nextContentMessageId,
    }: {
      statusMessageId: string;
      contentMessageId: string;
    }) => {
      dispatch({
        type: 'PLACEHOLDERS_READY',
        statusMessageId: nextStatusMessageId,
        contentMessageId: nextContentMessageId,
      });
    },
    []
  );

  const dispatchAppendContent = useCallback((content: string) => {
    dispatch({ type: 'APPEND_CONTENT', content });
  }, []);

  const dispatchFinalResponse = useCallback((nextFinalResponse: string) => {
    dispatch({ type: 'FINAL_RESPONSE', finalResponse: nextFinalResponse });
  }, []);

  const dispatchError = useCallback((message: string) => {
    dispatch({ type: 'ERROR', message });
  }, []);

  const resetStreamingState = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  return {
    state,
    contentMessageId,
    statusMessageId,
    isMountedRef,
    resolveConversationId,
    dispatchPlaceholderError,
    dispatchPlaceholdersReady,
    dispatchAppendContent,
    dispatchFinalResponse,
    dispatchError,
    resetStreamingState,
  };
}
