import { useMemo } from 'react';

interface ShellMessage {
  content: string;
}

interface UseAppShellViewStateOptions {
  conversationId: string | null | undefined;
  isAuthenticated: boolean;
  isInitialized: boolean;
  isMobileViewport: boolean;
  isStreaming: boolean;
  messages: ShellMessage[];
}

const parseRemoteConversationId = (conversationId: string | null | undefined): number | null => {
  const match = /^(?:remote-)?([1-9]\d*)$/.exec(conversationId ?? '');
  if (!match?.[1]) {
    return null;
  }

  const parsedId = Number(match[1]);
  return Number.isSafeInteger(parsedId) ? parsedId : null;
};

export function useAppShellViewState({
  conversationId,
  isAuthenticated,
  isInitialized,
  isMobileViewport,
  isStreaming,
  messages,
}: UseAppShellViewStateOptions) {
  return useMemo(() => {
    const remoteConversationId = parseRemoteConversationId(conversationId);

    const lastMessagePreview = (() => {
      const latest = messages[messages.length - 1];
      return latest ? latest.content.slice(0, 280) : undefined;
    })();

    const reportIssueContext: {
      conversationId?: string | null;
      lastMessagePreview?: string;
    } = {};
    if (conversationId !== undefined) {
      reportIssueContext.conversationId = conversationId;
    }
    if (lastMessagePreview) {
      reportIssueContext.lastMessagePreview = lastMessagePreview;
    }

    const hasMessages = messages.length > 0;

    return {
      canShareConversation: isAuthenticated && hasMessages && remoteConversationId !== null,
      isPromptDisabled: !isAuthenticated && hasMessages,
      promptVariant:
        !isMobileViewport && !hasMessages ? ('centered' as const) : ('bottom' as const),
      remoteConversationId,
      reportIssueContext,
      shouldShowNewChatShortcut: isAuthenticated && Boolean(conversationId && hasMessages),
      showMobileHero: isInitialized && isMobileViewport && !hasMessages && !isStreaming,
      showPromptLogo: !hasMessages && !isStreaming,
    };
  }, [conversationId, isAuthenticated, isInitialized, isMobileViewport, isStreaming, messages]);
}
