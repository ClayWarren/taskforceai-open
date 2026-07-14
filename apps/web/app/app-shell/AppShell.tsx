'use client';

import { usePrivateChatMode, useSessionLifecycleController } from '@taskforceai/react-core';
import { createComputerTheaterPreScreenStatus } from '@taskforceai/presenters';
import React, { useCallback, useEffect, useState } from 'react';

import PendingPrompts from '../components/chat/PendingPrompts';

import { AppPromptComposer } from './chat/AppPromptComposer';
import {
  disableDesktopConsoleLogs,
  useDesktopBrowserPreview,
  useDesktopCompanionPet,
  useDesktopMenuActions,
  useDesktopShellActions,
} from '../lib/platform/desktop-ui';
import { useAppShellNavigationActions } from './navigation/useAppShellNavigationActions';
import { AppShellFrame } from './shell/AppShellFrame';
import { AppShellOverlays } from './shell/AppShellOverlays';
import { useAppShellOverlayState } from './shell/useAppShellOverlayState';
import { useAppShellViewState } from './shell/useAppShellViewState';
import { useQuickSearchSelection } from './shell/useQuickSearchSelection';
import { useRouter } from '../components/routing';
import OfflineIndicator from '../components/shell/OfflineIndicator';
import '../globals.css';
import { useConversationState } from '../lib/hooks/useConversationState';
import { useMobileViewport } from '../lib/hooks/useMobileViewport';
import { usePendingPrompts } from '../lib/hooks/usePendingPrompts';
import { useStreamingMessages } from '../lib/hooks/useStreamingMessages';
import { initializeI18n } from '../lib/i18n';
import { logger } from '../lib/logger';
import { reportOptionalLatencyMark } from '../lib/observability/latency';
import { usePlatformRuntime } from '../lib/platform/PlatformProvider';
import {
  PROMPT_DRAFT_CAPTURE_EVENT,
  readCapturedPromptDraft,
  writeCapturedPromptDraft,
} from '../lib/prompt/hydration-draft-capture';
import { useProfileModal } from '../lib/profile/modal/ProfileModalContext';
import { useAuth } from '../lib/providers/AuthProvider';
import { useStreaming } from '../lib/providers/StreamingProvider';
import {
  persistDesktopTaskMode,
  readDesktopTaskMode,
  type DesktopTaskMode,
} from '../lib/desktop/task-mode';

const markLatency = (name: string, detail?: unknown): void => {
  reportOptionalLatencyMark(name, detail);
};

const valueOrNull = <T,>(value: T | null | undefined): T | null => value ?? null;
const valueOrUndefined = <T,>(value: T | null | undefined): T | undefined => value ?? undefined;
const either = (left: boolean, right: boolean): boolean => left || right;

export interface AppShellProps {
  modelSelectorBootstrap?: React.ComponentProps<typeof AppShellFrame>['modelSelectorBootstrap'];
}

// eslint-disable-next-line complexity -- This shell coordinates independent desktop lifecycle effects.
export const AppShell: React.FC<AppShellProps> = ({ modelSelectorBootstrap }) => {
  const resolvedModelSelectorBootstrap = valueOrNull(modelSelectorBootstrap);
  useEffect(() => {
    disableDesktopConsoleLogs();
    logger.debug('[App] Component mounted');
  }, []);

  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth();
  useEffect(() => {
    if (!isAuthLoading) {
      markLatency('auth.state.ready', { isAuthenticated });
    }
  }, [isAuthLoading, isAuthenticated]);

  const platformRuntime = usePlatformRuntime();
  const desktopRuntime = platformRuntime === 'desktop';
  const desktopPet = useDesktopCompanionPet(desktopRuntime);
  const [desktopTaskMode, setDesktopTaskMode] = useState<DesktopTaskMode>(readDesktopTaskMode);
  const [promptDraft, setPromptDraftState] = useState(readCapturedPromptDraft);
  const setPromptDraft = useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (valueOrUpdater) => {
      setPromptDraftState((previousValue) => {
        const nextValue =
          typeof valueOrUpdater === 'function' ? valueOrUpdater(previousValue) : valueOrUpdater;
        writeCapturedPromptDraft(nextValue);
        return nextValue;
      });
    },
    []
  );
  const { open: openProfileModal } = useProfileModal();
  const isMobileViewport = useMobileViewport();
  const privateChatMode = usePrivateChatMode({
    isAuthenticated,
    isAuthLoading,
  });
  const { disablePrivateChat, isPrivateChat } = privateChatMode;
  useEffect(() => {
    if (desktopTaskMode !== 'chat' && isPrivateChat) {
      disablePrivateChat();
    }
  }, [desktopTaskMode, disablePrivateChat, isPrivateChat]);
  const {
    closeQuickSearch,
    handleAgentManagerClick,
    handleMobileHamburgerClick,
    handleOpenReportIssue,
    handleSearchClick,
    isAgentManagerOpen,
    isQuickSearchOpen,
    isReportIssueOpen,
    isShareModalOpen,
    isSidebarOpen,
    setIsReportIssueOpen,
    setIsAgentManagerOpen,
    setIsShareModalOpen,
    setIsSidebarOpen,
  } = useAppShellOverlayState();

  useEffect(() => {
    const syncCapturedPromptDraft = (event?: Event) => {
      const eventValue =
        event instanceof CustomEvent && typeof event.detail?.value === 'string'
          ? event.detail.value
          : null;
      const capturedDraft = eventValue ?? readCapturedPromptDraft();
      setPromptDraftState((previousValue) =>
        previousValue === capturedDraft ? previousValue : capturedDraft
      );
    };

    syncCapturedPromptDraft();
    window.addEventListener(PROMPT_DRAFT_CAPTURE_EVENT, syncCapturedPromptDraft);
    return () => {
      window.removeEventListener(PROMPT_DRAFT_CAPTURE_EVENT, syncCapturedPromptDraft);
    };
  }, []);

  const { availableUpdate, desktopUpdateAction, desktopUpdateMessage, handleCheckForUpdates } =
    useDesktopShellActions(desktopRuntime ? 'desktop' : 'browser');
  const { closeBrowserPreview, isBrowserPreviewOpen, openBrowserPreview } =
    useDesktopBrowserPreview(desktopRuntime);
  useDesktopMenuActions({
    desktopRuntime,
    onCheckForUpdates: handleCheckForUpdates,
    onOpenBrowserPreview: openBrowserPreview,
    onOpenSettings: openProfileModal,
  });

  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const handleShowTerminal = useCallback(() => {
    if (platformRuntime !== 'desktop') {
      return;
    }
    setIsTerminalOpen((open) => !open);
  }, [platformRuntime]);

  const conversation = useConversationState({ isPrivateMode: isPrivateChat });
  const messages = conversation.messages;

  const streamingContext = useStreaming();

  useEffect(() => {
    logger.debug('[App] useStreaming() state', {
      isStreaming: streamingContext.isStreaming,
      hasErrorMessage: !!streamingContext.errorMessage,
      hasFinalResponse: !!streamingContext.finalResponse,
      hasStreamContent: !!streamingContext.streamContent,
    });
  }, [
    streamingContext.isStreaming,
    streamingContext.errorMessage,
    streamingContext.finalResponse,
    streamingContext.streamContent,
  ]);
  const {
    isStreaming,
    errorMessage,
    rateLimitResetTime,
    finalResponse,
    clearErrorMessage,
    setErrorMessage,
    startStreaming,
    streamContent,
    sources,
    finalSources,
    toolEvents,
    finalToolEvents,
    elapsedSeconds,
    agentStatuses,
    trace_id,
    pendingApproval,
    computerUseEnabled,
    useLoggedInServices,
    reset,
  } = streamingContext;

  const { resetStreamingState } = useStreamingMessages({
    isStreaming,
    streamContent,
    finalResponse,
    errorMessage,
    persistenceEnabled: !isPrivateChat,
    conversationId: conversation.conversationId,
    ensureActiveConversation: conversation.ensureActiveConversation,
    setMessages: conversation.setMessages,
    sources,
    finalSources,
    toolEvents,
    finalToolEvents,
    elapsedSeconds,
    agentStatuses,
    trace_id,
    pendingApproval,
  });

  const resetConversationStreamingState = useCallback(() => {
    reset();
    resetStreamingState();
  }, [reset, resetStreamingState]);

  const handlePrivateChatToggle = useCallback(() => {
    resetConversationStreamingState();
    privateChatMode.togglePrivateChat();
  }, [privateChatMode, resetConversationStreamingState]);

  useEffect(() => {
    initializeI18n();
  }, []);

  const { handleConversationSelect, handleNewChat, messageSession, pendingPromptReplay } =
    useSessionLifecycleController({
      conversation,
      messaging: {
        conversation: {
          addUserMessage: conversation.addUserMessage,
          ensureActiveConversation: conversation.ensureActiveConversation,
          setMessages: conversation.setMessages,
        },
        streaming: {
          startStreaming,
          clearErrorMessage,
          setErrorMessage,
        },
      },
      resetStreamingState: resetConversationStreamingState,
      afterNewChat: async () => {
        closeQuickSearch();
        await router.push('/');
      },
      afterConversationSelect: async () => {
        await router.navigate({ to: '/' });
      },
      onConversationSelectError: (error) => {
        logger.error('Failed to load conversation', { error });
      },
    });

  const handleNewChatClick = useCallback(() => {
    void handleNewChat();
  }, [handleNewChat]);

  if (!messageSession || !pendingPromptReplay) {
    throw new Error('AppShell requires a session lifecycle controller with messaging support');
  }

  usePendingPrompts({
    isStreaming,
    startStreaming: pendingPromptReplay.startStreaming,
    isAuthenticated,
    enabled: conversation.isInitialized && !isPrivateChat,
  });

  const handleQuickSearchSelect = useQuickSearchSelection({
    closeQuickSearch,
    loadConversation: conversation.loadConversation,
    navigateHome: () => router.navigate({ to: '/' }),
    resetStreamingState: resetConversationStreamingState,
  });

  const {
    canShareConversation,
    isPromptDisabled,
    promptVariant,
    remoteConversationId,
    reportIssueContext,
    shouldShowNewChatShortcut,
    showMobileHero,
    showPromptLogo,
  } = useAppShellViewState({
    conversationId: conversation.conversationId,
    isAuthenticated,
    isInitialized: conversation.isInitialized,
    isMobileViewport,
    isStreaming,
    messages,
  });
  const canUseCenteredPromptBeforeRestore = promptVariant === 'centered' && messages.length === 0;

  const {
    handleLogoClick,
    handleOpenChangelog,
    handleOpenProfile,
    handleSendMessage,
    handleSignInClick,
  } = useAppShellNavigationActions({
    isAuthenticated,
    messageSession,
    openProfileModal,
    platformRuntime: desktopRuntime ? 'desktop' : 'browser',
    router,
    setIsSidebarOpen,
  });

  const promptComposerProps: Omit<React.ComponentProps<typeof AppPromptComposer>, 'variant'> = {
    initialModelSelector: resolvedModelSelectorBootstrap,
    isDisabled:
      isPromptDisabled || (!conversation.isInitialized && !canUseCenteredPromptBeforeRestore),
    isPrivateChat,
    persistenceEnabled: !isPrivateChat,
    promptVariant,
    promptValue: promptDraft,
    session: messageSession,
    showPromptLogo,
    onPromptValueChange: setPromptDraft,
    updateToRemoteConversation: conversation.updateToRemoteConversation,
  };

  const handleDesktopTaskModeChange = useCallback(
    (mode: DesktopTaskMode) => {
      if (mode !== 'chat') {
        disablePrivateChat();
      }
      setDesktopTaskMode(mode);
      persistDesktopTaskMode(mode);
    },
    [disablePrivateChat]
  );

  return (
    <>
      <OfflineIndicator />
      {conversation.isInitialized && !isPrivateChat ? <PendingPrompts /> : null}
      <AppShellOverlays
        computerUseEnabled={computerUseEnabled}
        isStreaming={isStreaming}
        useLoggedInServices={useLoggedInServices}
        toolEvents={toolEvents}
        preScreenStatus={createComputerTheaterPreScreenStatus(agentStatuses)}
        isReportIssueOpen={isReportIssueOpen}
        onReportIssueOpenChange={setIsReportIssueOpen}
        reportIssueContext={reportIssueContext}
        isQuickSearchOpen={isQuickSearchOpen}
        isAuthenticated={isAuthenticated}
        onCloseQuickSearch={closeQuickSearch}
        onNewChat={handleNewChatClick}
        onQuickSearchSelect={handleQuickSearchSelect}
        remoteConversationId={remoteConversationId}
        isShareModalOpen={isShareModalOpen}
        onCloseShareModal={() => setIsShareModalOpen(false)}
        isAgentManagerOpen={isAgentManagerOpen}
        onCloseAgentManager={() => setIsAgentManagerOpen(false)}
        desktopTaskMode={desktopTaskMode}
        desktopRuntime={desktopRuntime}
        initialIsPublic={conversation.isPublic}
        initialShareId={valueOrUndefined(conversation.shareId)}
      />
      <AppShellFrame
        canShareConversation={canShareConversation}
        conversation={conversation}
        errorMessage={errorMessage}
        isAuthLoading={isAuthLoading}
        isAuthenticated={isAuthenticated}
        isMobileViewport={isMobileViewport}
        isPromptDisabled={isPromptDisabled}
        isPrivateChat={isPrivateChat}
        isPrivateChatToggleDisabled={either(
          isStreaming,
          privateChatMode.isPrivateChatToggleDisabled
        )}
        isSidebarOpen={isSidebarOpen}
        companionPet={desktopPet}
        messages={messages}
        modelSelectorBootstrap={resolvedModelSelectorBootstrap}
        promptComposerProps={promptComposerProps}
        promptVariant={promptVariant}
        rateLimitResetTime={rateLimitResetTime}
        shouldShowNewChatShortcut={shouldShowNewChatShortcut}
        showMobileHero={showMobileHero}
        showPromptLogo={showPromptLogo}
        desktopUpdateVersion={availableUpdate?.version ?? null}
        desktopUpdateAction={desktopUpdateAction}
        desktopUpdateMessage={desktopUpdateMessage}
        desktopTaskMode={desktopTaskMode}
        desktopRuntime={desktopRuntime}
        isTerminalOpen={isTerminalOpen}
        isBrowserPreviewOpen={isBrowserPreviewOpen}
        enableWorkspaceFileTree={desktopRuntime && desktopTaskMode === 'code'}
        userEmail={user?.email}
        userImpersonatorId={
          user?.impersonator_id === undefined || user.impersonator_id === null
            ? null
            : String(user.impersonator_id)
        }
        onConversationSelect={(summary) => {
          void handleConversationSelect(summary).then(() => {
            privateChatMode.disablePrivateChat();
          });
        }}
        onHamburgerClick={handleMobileHamburgerClick}
        onLogoClick={handleLogoClick}
        onNewChat={handleNewChatClick}
        onOpenChangelog={handleOpenChangelog}
        onOpenProfile={handleOpenProfile}
        onOpenReportIssue={handleOpenReportIssue}
        onOpenSidebar={() => setIsSidebarOpen(true)}
        onSearchClick={handleSearchClick}
        onTogglePrivateChat={handlePrivateChatToggle}
        onAgentManagerClick={desktopRuntime ? handleAgentManagerClick : undefined}
        onSendMessage={handleSendMessage}
        onShare={() => setIsShareModalOpen(true)}
        onOpenBrowserPreview={desktopRuntime ? openBrowserPreview : undefined}
        onCloseBrowserPreview={closeBrowserPreview}
        onShowTerminal={desktopRuntime ? handleShowTerminal : undefined}
        onCloseTerminal={() => setIsTerminalOpen(false)}
        onCheckForUpdates={handleCheckForUpdates}
        onSidebarClose={() => setIsSidebarOpen(false)}
        onDesktopTaskModeChange={handleDesktopTaskModeChange}
        onSignIn={handleSignInClick}
        clearErrorMessage={clearErrorMessage}
      />
    </>
  );
};
