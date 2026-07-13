import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { definedProps } from '@taskforceai/client-core/utils/object';
import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface SessionLifecycleConversation {
  handleNewChat: () => Promise<void> | void;
  loadConversation: (summary: ConversationSummary) => Promise<void>;
}

export interface SessionLifecycleMessagingConversation<TMessage> {
  addUserMessage: (content: string) => Promise<void> | void;
  ensureActiveConversation: () => Promise<string>;
  setMessages: Dispatch<SetStateAction<TMessage[]>>;
}

export interface SessionLifecycleMessagingStreaming<TStartStreamingOptions> {
  startStreaming: (options: TStartStreamingOptions) => Promise<void>;
  clearErrorMessage: () => void;
  setErrorMessage: (message: string, resetTime?: string) => void;
}

export interface SessionLifecycleMessageSession<TMessage, TStartStreamingOptions> {
  conversation: {
    onSendMessage: (content: string) => Promise<void> | void;
    ensureConversationId: () => Promise<string>;
    ensureActiveConversation: () => Promise<string>;
    setMessages: Dispatch<SetStateAction<TMessage[]>>;
  };
  streaming: SessionLifecycleMessagingStreaming<TStartStreamingOptions>;
  invalidatePendingPrompts?: () => void;
}

export interface SessionLifecyclePendingPromptReplay<TStartStreamingOptions> {
  startStreaming: (options: TStartStreamingOptions) => Promise<void>;
  invalidatePendingPrompts?: () => void;
}

interface SessionLifecycleControllerBaseOptions {
  conversation: SessionLifecycleConversation;
  resetStreamingState: () => void;
  afterNewChat?: () => Promise<void> | void;
  afterConversationSelect?: (summary: ConversationSummary) => Promise<void> | void;
  onConversationSelectError?: (error: unknown, summary: ConversationSummary) => void;
}

interface SessionLifecycleControllerMessagingOptions<TMessage, TStartStreamingOptions> {
  conversation: SessionLifecycleMessagingConversation<TMessage>;
  streaming: SessionLifecycleMessagingStreaming<TStartStreamingOptions>;
}

export interface UseSessionLifecycleControllerOptionsBase extends SessionLifecycleControllerBaseOptions {
  messaging?: undefined;
  invalidatePendingPrompts?: undefined;
}

export interface UseSessionLifecycleControllerOptionsWithMessaging<
  TMessage,
  TStartStreamingOptions,
> extends SessionLifecycleControllerBaseOptions {
  messaging: SessionLifecycleControllerMessagingOptions<TMessage, TStartStreamingOptions>;
  invalidatePendingPrompts?: () => void;
}

export interface SessionLifecycleControllerActions {
  handleNewChat: () => Promise<void>;
  handleConversationSelect: (summary: ConversationSummary) => Promise<void>;
}

export function useSessionLifecycleController<TMessage, TStartStreamingOptions>({
  conversation,
  messaging,
  resetStreamingState,
  invalidatePendingPrompts,
  afterNewChat,
  afterConversationSelect,
  onConversationSelectError,
}:
  | UseSessionLifecycleControllerOptionsBase
  | UseSessionLifecycleControllerOptionsWithMessaging<
      TMessage,
      TStartStreamingOptions
    >): SessionLifecycleControllerActions & {
  messageSession?: SessionLifecycleMessageSession<TMessage, TStartStreamingOptions>;
  pendingPromptReplay?: SessionLifecyclePendingPromptReplay<TStartStreamingOptions>;
} {
  const handleNewChat = useCallback(async () => {
    resetStreamingState();
    await conversation.handleNewChat();
    await afterNewChat?.();
  }, [afterNewChat, conversation, resetStreamingState]);

  const handleConversationSelect = useCallback(
    async (summary: ConversationSummary) => {
      resetStreamingState();
      try {
        await conversation.loadConversation(summary);
        await afterConversationSelect?.(summary);
      } catch (error) {
        onConversationSelectError?.(error, summary);
      }
    },
    [afterConversationSelect, conversation, onConversationSelectError, resetStreamingState]
  );

  const messageSession = useMemo(() => {
    if (!messaging) {
      return undefined;
    }

    return {
      conversation: {
        onSendMessage: messaging.conversation.addUserMessage,
        ensureConversationId: messaging.conversation.ensureActiveConversation,
        ensureActiveConversation: messaging.conversation.ensureActiveConversation,
        setMessages: messaging.conversation.setMessages,
      },
      streaming: messaging.streaming,
      ...definedProps({ invalidatePendingPrompts }),
    };
  }, [invalidatePendingPrompts, messaging]);

  const pendingPromptReplay = useMemo(() => {
    if (!messaging) {
      return undefined;
    }

    return {
      startStreaming: messaging.streaming.startStreaming,
      ...definedProps({ invalidatePendingPrompts }),
    };
  }, [invalidatePendingPrompts, messaging]);

  if (messageSession && pendingPromptReplay) {
    return {
      handleNewChat,
      handleConversationSelect,
      messageSession,
      pendingPromptReplay,
    };
  }

  return {
    handleNewChat,
    handleConversationSelect,
  };
}
