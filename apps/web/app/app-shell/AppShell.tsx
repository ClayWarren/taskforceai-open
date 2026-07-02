'use client';

import { useSessionLifecycleController } from '@taskforceai/react-core';
import {
  createComputerTheaterPreScreenStatus,
  reportOptionalLatencyMark,
} from '@taskforceai/shared';
import React, { useCallback, useEffect, useState } from 'react';

import PendingPrompts from '../components/chat/PendingPrompts';

import { AppPromptComposer } from './AppPromptComposer';
import { AppShellFrame } from './AppShellFrame';
import { AppShellOverlays } from './AppShellOverlays';
import { useRouter } from '../components/routing';
import OfflineIndicator from '../components/shell/OfflineIndicator';
import '../globals.css';
import { useConversationState } from '../lib/hooks/useConversationState';
import { useMobileViewport } from '../lib/hooks/useMobileViewport';
import { usePendingPrompts } from '../lib/hooks/usePendingPrompts';
import { useStreamingMessages } from '../lib/hooks/useStreamingMessages';
import { initializeI18n } from '../lib/i18n';
import { logger } from '../lib/logger';
import type { AppServerPetState } from '../lib/platform/desktop/app-server';
import { getDesktopAppServerStatus } from '../lib/platform/desktop/app-server';
import { listenTauriEvent } from '../lib/platform/desktop/bridge';
import { disableDesktopConsoleLogs } from '../lib/platform/disableDesktopConsoleLogs';
import { usePlatformRuntime } from '../lib/platform/PlatformProvider';
import {
  PROMPT_DRAFT_CAPTURE_EVENT,
  readCapturedPromptDraft,
  writeCapturedPromptDraft,
} from '../lib/prompt/hydration-draft-capture';
import { useProfileModal } from '../lib/profile/ProfileModalContext';
import { useAuth } from '../lib/providers/AuthProvider';
import { useStreaming } from '../lib/providers/StreamingProvider';
import { useDesktopShellActions } from './useDesktopShellActions';
import { useAppShellOverlayState } from './useAppShellOverlayState';
import { useAppShellNavigationActions } from './useAppShellNavigationActions';
import { useAppShellViewState } from './useAppShellViewState';
import { useQuickSearchSelection } from './useQuickSearchSelection';

const markLatency = (name: string, detail?: unknown): void => {
  reportOptionalLatencyMark(name, detail);
};

export interface AppShellProps {
  modelSelectorBootstrap?: React.ComponentProps<typeof AppShellFrame>['modelSelectorBootstrap'];
}

export const AppShell: React.FC<AppShellProps> = ({ modelSelectorBootstrap }) => {
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
  const [desktopPet, setDesktopPet] = useState<AppServerPetState | null>(null);
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

  const { availableUpdate, handleCheckForUpdates } = useDesktopShellActions(
    platformRuntime === 'desktop' ? 'desktop' : 'browser'
  );

  useEffect(() => {
    if (platformRuntime !== 'desktop') {
      return;
    }

    let active = true;
    const unlistenCallbacks: Array<() => void> = [];

    const registerMenuListeners = async () => {
      try {
        const [unlistenSettings, unlistenUpdates] = await Promise.all([
          listenTauriEvent('desktop-menu:settings', () => {
            openProfileModal();
          }),
          listenTauriEvent('desktop-menu:check-for-updates', () => {
            handleCheckForUpdates?.();
          }),
        ]);

        if (!active) {
          unlistenSettings();
          unlistenUpdates();
          return;
        }

        unlistenCallbacks.push(unlistenSettings, unlistenUpdates);
      } catch (error) {
        logger.warn('Failed to register desktop menu listeners', { error });
      }
    };

    void registerMenuListeners();

    return () => {
      active = false;
      for (const unlisten of unlistenCallbacks) {
        unlisten();
      }
    };
  }, [handleCheckForUpdates, openProfileModal, platformRuntime]);

  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const handleShowTerminal = useCallback(() => {
    if (platformRuntime !== 'desktop') {
      return;
    }
    setIsTerminalOpen((open) => !open);
  }, [platformRuntime]);

  useEffect(() => {
    if (platformRuntime !== 'desktop') {
      setDesktopPet(null);
      return;
    }

    let active = true;
    const loadPet = async () => {
      try {
        const status = await getDesktopAppServerStatus();
        if (active) {
          setDesktopPet(status.pet ?? null);
        }
      } catch (error) {
        logger.debug('[App] Desktop companion unavailable', { error });
      }
    };

    void loadPet();
    const timer = window.setInterval(() => {
      void loadPet();
    }, 30_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [platformRuntime]);

  const conversation = useConversationState();
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
    enabled: conversation.isInitialized,
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
    platformRuntime: platformRuntime === 'desktop' ? 'desktop' : 'browser',
    router,
    setIsSidebarOpen,
  });

  const promptComposerProps: Omit<React.ComponentProps<typeof AppPromptComposer>, 'variant'> = {
    initialModelSelector: modelSelectorBootstrap ?? null,
    isDisabled:
      isPromptDisabled || (!conversation.isInitialized && !canUseCenteredPromptBeforeRestore),
    promptVariant,
    promptValue: promptDraft,
    session: messageSession,
    showPromptLogo,
    onPromptValueChange: setPromptDraft,
    updateToRemoteConversation: conversation.updateToRemoteConversation,
  };

  return (
    <>
      <OfflineIndicator />
      {conversation.isInitialized ? <PendingPrompts /> : null}
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
        initialIsPublic={conversation.isPublic}
        initialShareId={conversation.shareId ?? undefined}
      />
      <AppShellFrame
        canShareConversation={canShareConversation}
        conversation={conversation}
        errorMessage={errorMessage}
        isAuthLoading={isAuthLoading}
        isAuthenticated={isAuthenticated}
        isMobileViewport={isMobileViewport}
        isPromptDisabled={isPromptDisabled}
        isSidebarOpen={isSidebarOpen}
        companionPet={desktopPet}
        messages={messages}
        modelSelectorBootstrap={modelSelectorBootstrap ?? null}
        promptComposerProps={promptComposerProps}
        promptVariant={promptVariant}
        rateLimitResetTime={rateLimitResetTime}
        shouldShowNewChatShortcut={shouldShowNewChatShortcut}
        showMobileHero={showMobileHero}
        showPromptLogo={showPromptLogo}
        desktopUpdateVersion={availableUpdate?.version ?? null}
        isTerminalOpen={isTerminalOpen}
        enableWorkspaceFileTree={platformRuntime === 'desktop'}
        userEmail={user?.email}
        userImpersonatorId={
          user?.impersonator_id === undefined || user.impersonator_id === null
            ? null
            : String(user.impersonator_id)
        }
        onConversationSelect={(summary) => {
          void handleConversationSelect(summary);
        }}
        onHamburgerClick={handleMobileHamburgerClick}
        onLogoClick={handleLogoClick}
        onNewChat={handleNewChatClick}
        onOpenChangelog={handleOpenChangelog}
        onOpenProfile={handleOpenProfile}
        onOpenReportIssue={handleOpenReportIssue}
        onOpenSidebar={() => setIsSidebarOpen(true)}
        onSearchClick={handleSearchClick}
        onAgentManagerClick={platformRuntime === 'desktop' ? handleAgentManagerClick : undefined}
        onSendMessage={handleSendMessage}
        onShare={() => setIsShareModalOpen(true)}
        onShowTerminal={platformRuntime === 'desktop' ? handleShowTerminal : undefined}
        onCloseTerminal={() => setIsTerminalOpen(false)}
        onCheckForUpdates={handleCheckForUpdates}
        onSidebarClose={() => setIsSidebarOpen(false)}
        onSignIn={handleSignInClick}
        clearErrorMessage={clearErrorMessage}
      />
    </>
  );
};
