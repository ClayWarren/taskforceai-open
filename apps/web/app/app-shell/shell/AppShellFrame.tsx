'use client';

import clsx from 'clsx';
import React, { useState } from 'react';

import Sidebar from '../../components/shell/Sidebar';
import type { AppServerPetState } from '@taskforceai/contracts/app-server';
import { AppPromptComposer } from '../chat/AppPromptComposer';
import { ChatView } from '../chat/ChatView';
import { CollapsedSidebar } from '../navigation/CollapsedSidebar';
import {
  DESKTOP_CODE_WORKSPACE_PANE_WIDTH,
  DesktopAuthButtons,
  DesktopBrowserPanel,
  DesktopCodeWorkspaceSurface,
  DesktopCompanion,
  DesktopTerminalPanel,
  WorkspaceFileTreePanel,
  type DesktopCodeWorkspaceView,
  type DesktopUpdateAction,
} from '../../lib/platform/desktop-ui';
import type { DesktopTaskMode } from '../../lib/desktop/task-mode';
import { AppShellNavigationControls } from './AppShellNavigationControls';
import { AppShellTopControls } from './AppShellTopControls';

interface AppShellFrameProps {
  canShareConversation: boolean;
  conversation: {
    conversationId?: string | null;
    ensureActiveConversation: () => Promise<string>;
    hasMoreMessages: boolean;
    isInitialized: boolean;
    isLoadingMore: boolean;
    loadMoreMessages: () => Promise<void>;
  };
  errorMessage: string | null;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  isMobileViewport: boolean;
  isPromptDisabled: boolean;
  isPrivateChat: boolean;
  isPrivateChatToggleDisabled?: boolean;
  isSidebarOpen: boolean;
  companionPet?: AppServerPetState | null;
  messages: React.ComponentProps<typeof ChatView>['messages'];
  modelSelectorBootstrap?: React.ComponentProps<typeof ChatView>['modelSelectorBootstrap'];
  promptComposerProps: Omit<React.ComponentProps<typeof AppPromptComposer>, 'variant'>;
  promptVariant: React.ComponentProps<typeof ChatView>['promptVariant'];
  rateLimitResetTime: string | null;
  shouldShowNewChatShortcut: boolean;
  showMobileHero: boolean;
  showPromptLogo: boolean;
  desktopUpdateVersion?: string | null;
  desktopUpdateAction?: DesktopUpdateAction;
  desktopUpdateMessage?: string | null;
  desktopTaskMode?: DesktopTaskMode;
  desktopRuntime?: boolean;
  isTerminalOpen?: boolean;
  isBrowserPreviewOpen?: boolean;
  enableWorkspaceFileTree?: boolean;
  userEmail?: string | null;
  userImpersonatorId?: string | null;
  onConversationSelect: NonNullable<React.ComponentProps<typeof Sidebar>['onConversationSelect']>;
  onHamburgerClick: () => void;
  onLogoClick: () => void;
  onNewChat: () => void;
  onOpenChangelog: () => void;
  onOpenProfile: () => void;
  onOpenBrowserPreview?: () => void;
  onCloseBrowserPreview?: () => void;
  onOpenReportIssue: () => void;
  onOpenSidebar: () => void;
  onSearchClick: () => void;
  onTogglePrivateChat: () => void;
  onAgentManagerClick?: () => void;
  onSendMessage: (content: string) => void;
  onShare: () => void;
  onShowTerminal?: () => void;
  onCloseTerminal?: () => void;
  onCheckForUpdates?: () => void;
  onSidebarClose: () => void;
  onDesktopTaskModeChange?: (_mode: DesktopTaskMode) => void;
  onSignIn: () => void;
  clearErrorMessage: () => void;
}

const BROWSER_PANEL_WIDTH = 'clamp(380px, 42vw, 760px)';
const defaultValue = <T,>(value: T | undefined, fallback: T): T =>
  value === undefined ? fallback : value;

interface ShellLayout {
  shouldRenderCenteredPrompt: boolean;
  shouldRenderChatView: boolean;
  shouldRenderBrowserPanel: boolean;
  desktopBrowserRightInset: string | undefined;
  desktopBrowserShellStyle: React.CSSProperties | undefined;
}

const computeShellLayout = (args: {
  conversation: AppShellFrameProps['conversation'];
  promptVariant: AppShellFrameProps['promptVariant'];
  messageCount: number;
  showMobileHero: boolean;
  errorMessage: string | null;
  isBrowserPreviewOpen: boolean;
  isMobileViewport: boolean;
}): ShellLayout => {
  const shouldRenderCenteredPrompt =
    args.conversation.isInitialized || args.promptVariant === 'centered';
  const shouldRenderChatView =
    args.conversation.isInitialized &&
    (args.messageCount > 0 ||
      args.showMobileHero ||
      Boolean(args.errorMessage) ||
      Boolean(args.conversation.hasMoreMessages));
  const shouldRenderBrowserPanel = args.isBrowserPreviewOpen && !args.isMobileViewport;
  const desktopBrowserRightInset = shouldRenderBrowserPanel ? BROWSER_PANEL_WIDTH : undefined;
  const desktopBrowserShellStyle = shouldRenderBrowserPanel
    ? ({
        '--desktop-browser-panel-width': BROWSER_PANEL_WIDTH,
      } as React.CSSProperties & Record<'--desktop-browser-panel-width', string>)
    : undefined;

  return {
    shouldRenderCenteredPrompt,
    shouldRenderChatView,
    shouldRenderBrowserPanel,
    desktopBrowserRightInset,
    desktopBrowserShellStyle,
  };
};

// eslint-disable-next-line complexity -- Rendering branches mirror independent shell capabilities.
export function AppShellFrame({
  canShareConversation,
  conversation,
  errorMessage,
  isAuthLoading,
  isAuthenticated,
  isMobileViewport,
  isPromptDisabled,
  isPrivateChat,
  isPrivateChatToggleDisabled: privateChatToggleDisabled,
  isSidebarOpen,
  companionPet,
  messages,
  modelSelectorBootstrap: modelSelectorBootstrapValue,
  promptComposerProps,
  promptVariant,
  rateLimitResetTime,
  shouldShowNewChatShortcut,
  showMobileHero,
  showPromptLogo,
  desktopUpdateVersion,
  desktopUpdateAction: desktopUpdateActionValue,
  desktopUpdateMessage,
  desktopTaskMode,
  desktopRuntime = false,
  isTerminalOpen: terminalOpen,
  isBrowserPreviewOpen: browserPreviewOpen,
  enableWorkspaceFileTree: workspaceFileTreeEnabled,
  userEmail,
  userImpersonatorId,
  onConversationSelect,
  onHamburgerClick,
  onLogoClick,
  onNewChat,
  onOpenChangelog,
  onOpenProfile,
  onOpenBrowserPreview,
  onCloseBrowserPreview: closeBrowserPreview,
  onOpenReportIssue,
  onOpenSidebar,
  onSearchClick,
  onTogglePrivateChat,
  onAgentManagerClick,
  onSendMessage,
  onShare,
  onShowTerminal,
  onCloseTerminal: closeTerminal,
  onCheckForUpdates,
  onSidebarClose,
  onDesktopTaskModeChange,
  onSignIn,
  clearErrorMessage,
}: AppShellFrameProps) {
  const isPrivateChatToggleDisabled = defaultValue(privateChatToggleDisabled, false);
  const modelSelectorBootstrap = defaultValue(modelSelectorBootstrapValue, null);
  const desktopUpdateAction = defaultValue(desktopUpdateActionValue, 'idle');
  const isTerminalOpen = defaultValue(terminalOpen, false);
  const isBrowserPreviewOpen = defaultValue(browserPreviewOpen, false);
  const enableWorkspaceFileTree =
    defaultValue(workspaceFileTreeEnabled, false) &&
    (!desktopRuntime || desktopTaskMode === 'code');
  const onCloseBrowserPreview = defaultValue(closeBrowserPreview, () => {});
  const onCloseTerminal = defaultValue(closeTerminal, () => {});
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(false);
  const [isRealtimeVoiceActive, setIsRealtimeVoiceActive] = useState(false);
  const [isCodeWorkspaceOpen, setIsCodeWorkspaceOpen] = useState(false);
  const [codeWorkspaceView, setCodeWorkspaceView] = useState<DesktopCodeWorkspaceView>('empty');
  const {
    shouldRenderCenteredPrompt,
    shouldRenderChatView,
    shouldRenderBrowserPanel,
    desktopBrowserRightInset,
    desktopBrowserShellStyle,
  } = computeShellLayout({
    conversation,
    promptVariant,
    messageCount: messages.length,
    showMobileHero,
    errorMessage,
    isBrowserPreviewOpen,
    isMobileViewport,
  });
  const codeWorkspacePaneActive =
    desktopRuntime && desktopTaskMode === 'code' && isCodeWorkspaceOpen;
  const desktopRightInset = codeWorkspacePaneActive
    ? DESKTOP_CODE_WORKSPACE_PANE_WIDTH
    : desktopBrowserRightInset;
  const desktopShellStyle = codeWorkspacePaneActive
    ? ({
        '--desktop-browser-panel-width': DESKTOP_CODE_WORKSPACE_PANE_WIDTH,
      } as React.CSSProperties & Record<'--desktop-browser-panel-width', string>)
    : desktopBrowserShellStyle;
  const shouldInsetDesktopContent = shouldRenderBrowserPanel || codeWorkspacePaneActive;

  React.useEffect(() => {
    if (desktopTaskMode !== 'code') setIsCodeWorkspaceOpen(false);
  }, [desktopTaskMode]);

  return (
    <>
      {userImpersonatorId && (
        <div className="sticky top-0 z-[1000] bg-red-600 py-1 text-center text-xs font-bold tracking-widest text-white uppercase">
          Support Mode: Impersonating {userEmail}
        </div>
      )}
      {!isAuthenticated && !isAuthLoading && !isMobileViewport ? (
        <DesktopAuthButtons onSignIn={onSignIn} />
      ) : null}
      <div
        className={clsx(
          'app-container relative flex min-h-screen text-slate-100',
          'bg-[linear-gradient(180deg,#050915_0%,#060814_42%,#04060f_100%)]'
        )}
        style={desktopShellStyle}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(1100px at 18% 12%, rgba(59,130,246,0.2), transparent 55%), radial-gradient(900px at 78% 78%, rgba(14,165,233,0.16), transparent 52%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: 'radial-gradient(1200px at 50% 72%, rgba(30,64,175,0.24), transparent 62%)',
          }}
        />

        <CollapsedSidebar
          isSidebarOpen={isSidebarOpen}
          isAuthenticated={isAuthenticated}
          shouldShowNewChatShortcut={shouldShowNewChatShortcut}
          onLogoClick={onLogoClick}
          onNewChat={onNewChat}
          onSearchClick={onSearchClick}
          onAgentManagerClick={onAgentManagerClick}
          onFileTreeClick={
            enableWorkspaceFileTree ? () => setIsFileTreeOpen((isOpen) => !isOpen) : undefined
          }
          onOpenSidebar={onOpenSidebar}
          onOpenProfile={onOpenProfile}
          onOpenBrowserPreview={onOpenBrowserPreview}
          onShowTerminal={onShowTerminal}
          onCheckForUpdates={onCheckForUpdates}
          desktopUpdateAction={desktopUpdateAction}
        />

        <Sidebar
          isOpen={isSidebarOpen}
          onClose={onSidebarClose}
          onNewChat={onNewChat}
          onOpenChangelog={onOpenChangelog}
          onOpenReportIssue={onOpenReportIssue}
          onCheckForUpdates={onCheckForUpdates}
          desktopUpdateVersion={desktopUpdateVersion}
          desktopUpdateAction={desktopUpdateAction}
          desktopUpdateMessage={desktopUpdateMessage}
          desktopTaskMode={desktopRuntime ? desktopTaskMode : undefined}
          onDesktopTaskModeChange={onDesktopTaskModeChange}
          desktopRuntime={desktopRuntime}
          onAgentManagerClick={onAgentManagerClick}
          activeConversationId={conversation.conversationId ?? null}
          onConversationSelect={onConversationSelect}
        />

        <WorkspaceFileTreePanel
          isOpen={enableWorkspaceFileTree && isFileTreeOpen}
          onClose={() => setIsFileTreeOpen(false)}
          onInsertIntoComposer={(text) => {
            const current = promptComposerProps.promptValue ?? '';
            promptComposerProps.onPromptValueChange?.(
              current.trim() ? `${current.trimEnd()}\n\n${text}` : text
            );
          }}
        />

        <AppShellTopControls
          isAuthenticated={isAuthenticated}
          desktopUpdateVersion={desktopUpdateVersion}
          desktopUpdateAction={desktopUpdateAction}
          onCheckForUpdates={onCheckForUpdates}
          isPrivateChat={isPrivateChat}
          isPrivateChatToggleDisabled={isPrivateChatToggleDisabled}
          onTogglePrivateChat={onTogglePrivateChat}
          shouldInsetControls={shouldInsetDesktopContent}
          showPrivateChatToggle={!desktopTaskMode || desktopTaskMode === 'chat'}
          showCodeWorkspaceControls={desktopRuntime && desktopTaskMode === 'code'}
          onOpenCodeWorkspace={() => {
            setCodeWorkspaceView('empty');
            setIsCodeWorkspaceOpen(true);
          }}
        />

        <AppShellNavigationControls
          desktopRuntime={desktopRuntime}
          isMobileViewport={isMobileViewport}
          mode={desktopTaskMode}
          onModeChange={onDesktopTaskModeChange}
          showMobileHero={showMobileHero}
          onHamburgerClick={onHamburgerClick}
        />

        <div
          className={clsx(
            'main-content relative flex flex-1 justify-center px-4 pt-12 pb-14 transition duration-150 md:pr-8',
            isSidebarOpen ? 'md:pl-[20rem] lg:pl-[22rem]' : 'md:pl-32 lg:pl-40',
            isSidebarOpen && !desktopRuntime && 'md:brightness-[0.94]',
            shouldInsetDesktopContent && 'main-content--desktop-browser-inset'
          )}
        >
          <main
            className={clsx(
              'chat-container',
              (promptVariant === 'bottom' || isRealtimeVoiceActive) &&
                'chat-container--fixed-prompt',
              isRealtimeVoiceActive && 'chat-container--voice-active'
            )}
          >
            {shouldRenderChatView ? (
              <ChatView
                messages={messages}
                showMobileHero={showMobileHero}
                showPromptLogo={showPromptLogo}
                promptVariant={promptVariant}
                isPromptDisabled={isPromptDisabled}
                isAuthenticated={isAuthenticated}
                errorMessage={errorMessage}
                rateLimitResetTime={rateLimitResetTime}
                modelSelectorBootstrap={modelSelectorBootstrap}
                onHamburgerClick={onHamburgerClick}
                onSignIn={onSignIn}
                onSendMessage={onSendMessage}
                clearErrorMessage={clearErrorMessage}
                ensureConversationId={conversation.ensureActiveConversation}
                canShare={canShareConversation}
                onShare={onShare}
                isPrivateChat={isPrivateChat}
                hasMoreMessages={conversation.hasMoreMessages}
                isLoadingMore={conversation.isLoadingMore}
                onLoadMore={() => void conversation.loadMoreMessages()}
                executionPresentation={desktopTaskMode === 'code' ? 'code' : 'standard'}
              />
            ) : null}
            {shouldRenderCenteredPrompt ? (
              <AppPromptComposer
                {...promptComposerProps}
                desktopTaskMode={desktopTaskMode}
                desktopRightInset={desktopRightInset}
                onRealtimeVoiceActiveChange={setIsRealtimeVoiceActive}
                variant="centered"
              />
            ) : null}
          </main>
        </div>

        {conversation.isInitialized ? (
          <AppPromptComposer
            {...promptComposerProps}
            desktopTaskMode={desktopTaskMode}
            desktopRightInset={desktopRightInset}
            onRealtimeVoiceActiveChange={setIsRealtimeVoiceActive}
            variant="bottom"
          />
        ) : null}
        {desktopRuntime && desktopTaskMode === 'code' ? (
          <DesktopCodeWorkspaceSurface
            open={isCodeWorkspaceOpen}
            view={codeWorkspaceView}
            onOpenChange={setIsCodeWorkspaceOpen}
            onViewChange={setCodeWorkspaceView}
            onOpenTerminal={onShowTerminal}
            onOpenBrowser={() => onOpenBrowserPreview?.()}
            onOpenFiles={() => setIsFileTreeOpen(true)}
            onOpenSideTask={onAgentManagerClick}
          />
        ) : null}
        <DesktopBrowserPanel
          open={shouldRenderBrowserPanel}
          onClose={onCloseBrowserPreview}
          width={BROWSER_PANEL_WIDTH}
          developerModeEnabled={desktopRuntime && desktopTaskMode === 'code'}
        />
        <DesktopTerminalPanel open={isTerminalOpen} onClose={onCloseTerminal} />
        <DesktopCompanion pet={companionPet} />
      </div>
    </>
  );
}
