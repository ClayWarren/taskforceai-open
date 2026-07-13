import {
  type SessionLifecycleConversation,
  type UseSessionLifecycleControllerOptionsBase,
  useSessionLifecycleController,
} from './useSessionLifecycleController';

export interface ConversationSessionLike extends SessionLifecycleConversation {}
export interface UseConversationSessionActionsOptions extends Pick<
  UseSessionLifecycleControllerOptionsBase,
  | 'conversation'
  | 'resetStreamingState'
  | 'afterNewChat'
  | 'afterConversationSelect'
  | 'onConversationSelectError'
> {}

export const useConversationSessionActions = useSessionLifecycleController;
