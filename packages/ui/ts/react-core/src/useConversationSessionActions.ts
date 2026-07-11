import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { definedProps } from '@taskforceai/client-core/utils/object';
import { useSessionLifecycleController } from './useSessionLifecycleController';

export interface ConversationSessionLike {
  handleNewChat: () => Promise<void> | void;
  loadConversation: (summary: ConversationSummary) => Promise<void>;
}

export interface UseConversationSessionActionsOptions {
  conversation: ConversationSessionLike;
  resetStreamingState: () => void;
  afterNewChat?: () => Promise<void> | void;
  afterConversationSelect?: (summary: ConversationSummary) => Promise<void> | void;
  onConversationSelectError?: (error: unknown, summary: ConversationSummary) => void;
}

export const useConversationSessionActions = ({
  conversation,
  resetStreamingState,
  afterNewChat,
  afterConversationSelect,
  onConversationSelectError,
}: UseConversationSessionActionsOptions) =>
  useSessionLifecycleController({
    conversation,
    resetStreamingState,
    ...definedProps({
      afterNewChat,
      afterConversationSelect,
      onConversationSelectError,
    }),
  });
