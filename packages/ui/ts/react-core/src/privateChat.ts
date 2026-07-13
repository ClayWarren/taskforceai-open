import { useCallback, useEffect, useMemo, useState } from 'react';

export const PRIVATE_CHAT_DISCLOSURE =
  "This chat won't appear in your history, be added to memory, or be used to train models.";

export const PRIVATE_CHAT_UNSAVED_RETRY_MESSAGE =
  'Private Chat could not send. This prompt was not saved for retry.';

export interface UsePrivateChatModeOptions {
  isAuthenticated: boolean;
  isAuthLoading?: boolean;
  isStreaming?: boolean;
}

export function usePrivateChatMode({
  isAuthenticated,
  isAuthLoading = false,
  isStreaming = false,
}: UsePrivateChatModeOptions) {
  const [requestedPrivateChat, setRequestedPrivateChat] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setRequestedPrivateChat(false);
    }
  }, [isAuthLoading, isAuthenticated]);

  const isPrivateChat = isAuthenticated && requestedPrivateChat;
  const shouldRenderPrivateChatToggle = isAuthenticated;
  const isPrivateChatToggleDisabled = isStreaming;

  const setPrivateChat = useCallback(
    (nextPrivateChat: boolean) => {
      setRequestedPrivateChat(isAuthenticated && nextPrivateChat);
    },
    [isAuthenticated]
  );

  const disablePrivateChat = useCallback(() => {
    setRequestedPrivateChat(false);
  }, []);

  const togglePrivateChat = useCallback(() => {
    if (!isAuthenticated || isStreaming) {
      return;
    }
    setRequestedPrivateChat((current) => !current);
  }, [isAuthenticated, isStreaming]);

  return useMemo(
    () => ({
      isPrivateChat,
      shouldRenderPrivateChatToggle,
      isPrivateChatToggleDisabled,
      setPrivateChat,
      disablePrivateChat,
      togglePrivateChat,
    }),
    [
      disablePrivateChat,
      isPrivateChat,
      isPrivateChatToggleDisabled,
      setPrivateChat,
      shouldRenderPrivateChatToggle,
      togglePrivateChat,
    ]
  );
}
