'use client';

import clsx from 'clsx';
import { Shield, ShieldCheck } from 'lucide-react';
import React, { useState } from 'react';

import { DesktopTaskModeSwitcher } from '../components/shell/DesktopTaskModeSwitcher';
import Sidebar from '../components/shell/Sidebar';
import type { AppServerPetState } from '../lib/platform/desktop/app-server';
import { AppPromptComposer } from './AppPromptComposer';
import { ChatView } from './ChatView';
import { CollapsedSidebar } from './CollapsedSidebar';
import { DesktopCompanion } from './DesktopCompanion';
import { DesktopAuthButtons } from './DesktopAuthButtons';
import { DesktopBrowserPanel } from './DesktopBrowserPanel';
import { DesktopTerminalPanel } from './DesktopTerminalPanel';
import { MobileHamburgerIcon } from './icons';
import type { DesktopUpdateAction } from './useDesktopShellActions';
import type { DesktopTaskMode } from '../lib/desktop/task-mode';
import { WorkspaceFileTreePanel } from './WorkspaceFileTreePanel';

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

const DesktopUpdateButton = ({
  desktopUpdateVersion,
  desktopUpdateAction,
  onCheckForUpdates,
}: {
  desktopUpdateVersion: string;
  desktopUpdateAction: DesktopUpdateAction;
  onCheckForUpdates: () => void;
}) => {
  const isDesktopUpdateBusy = desktopUpdateAction !== 'idle';
  const desktopUpdateButtonLabel =
    desktopUpdateAction === 'installing'
      ? 'Installing...'
      : desktopUpdateAction === 'checking'
        ? 'Checking...'
        : desktopUpdateVersion
          ? `Update ${desktopUpdateVersion}`
          : 'Check updates';

  return (
    <button
      type="button"
      className={clsx(
        'hidden items-center gap-2 rounded-full border border-blue-300/50',
        'bg-blue-400/15 px-4 py-2 text-sm font-semibold text-blue-100 shadow-[0_18px_42px_rgba(37,99,235,0.24)]',
        'backdrop-blur-xl transition hover:border-blue-200/70 hover:bg-blue-400/20 lg:inline-flex'
      )}
      onClick={onCheckForUpdates}
      disabled={isDesktopUpdateBusy}
      aria-busy={isDesktopUpdateBusy || undefined}
      aria-label={
        desktopUpdateAction === 'installing'
          ? `Installing TaskForceAI ${desktopUpdateVersion}`
          : `Install TaskForceAI ${desktopUpdateVersion}`
      }
    >
      <span
        className={clsx(
          'h-2 w-2 rounded-full bg-blue-200 shadow-[0_0_14px_rgba(191,219,254,0.9)]',
          isDesktopUpdateBusy && 'animate-pulse'
        )}
      />
      <span>{desktopUpdateButtonLabel}</span>
    </button>
  );
};

const PrivateChatToggle = ({
  isPrivateChat,
  isPrivateChatToggleDisabled,
  onTogglePrivateChat,
}: {
  isPrivateChat: boolean;
  isPrivateChatToggleDisabled: boolean;
  onTogglePrivateChat: () => void;
}) => {
  const PrivateChatIcon = isPrivateChat ? ShieldCheck : Shield;

  return (
    <button
      type="button"
      aria-label={isPrivateChat ? 'Turn off Private Chat' : 'Start Private Chat'}
      aria-pressed={isPrivateChat}
      className={clsx(
        'inline-flex h-11 w-11 items-center justify-center rounded-full border shadow-[0_18px_42px_rgba(2,6,23,0.28)]',
        'backdrop-blur-xl transition focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:outline-none',
        isPrivateChat
          ? 'border-emerald-300/55 bg-emerald-400/18 text-emerald-100 hover:border-emerald-200/75 hover:bg-emerald-400/24'
          : 'border-white/12 bg-white/[0.07] text-slate-200 hover:border-white/24 hover:bg-white/[0.12]',
        isPrivateChatToggleDisabled && 'cursor-not-allowed opacity-50'
      )}
      disabled={isPrivateChatToggleDisabled}
      onClick={onTogglePrivateChat}
      title={
        isPrivateChatToggleDisabled
          ? 'Private Chat is unavailable while a response is streaming'
          : isPrivateChat
            ? 'Private Chat is on'
            : 'Start Private Chat'
      }
    >
      <PrivateChatIcon aria-hidden="true" size={19} strokeWidth={2.1} />
      <span className="sr-only">{isPrivateChat ? 'Private Chat on' : 'Private Chat off'}</span>
    </button>
  );
};

const WebTaskModeNavigation = ({
  desktopRuntime,
  isMobileViewport,
  mode,
  onModeChange,
}: {
  desktopRuntime: boolean;
  isMobileViewport: boolean;
  mode?: DesktopTaskMode;
  onModeChange?: (_mode: DesktopTaskMode) => void;
}) => {
  if (desktopRuntime || isMobileViewport || !mode || !onModeChange) return null;

  return (
    <div className="fixed top-4 left-1/2 z-[260] -translate-x-1/2 sm:top-5">
      <DesktopTaskModeSwitcher mode={mode} desktopRuntime={false} onModeChange={onModeChange} />
    </div>
  );
};

const TopRightControls = ({
  isAuthenticated,
  desktopUpdateVersion,
  desktopUpdateAction,
  onCheckForUpdates,
  isPrivateChat,
  isPrivateChatToggleDisabled,
  onTogglePrivateChat,
  shouldRenderBrowserPanel,
  showPrivateChatToggle,
}: {
  isAuthenticated: boolean;
  desktopUpdateVersion?: string | null;
  desktopUpdateAction: DesktopUpdateAction;
  onCheckForUpdates?: () => void;
  isPrivateChat: boolean;
  isPrivateChatToggleDisabled: boolean;
  onTogglePrivateChat: () => void;
  shouldRenderBrowserPanel: boolean;
  showPrivateChatToggle: boolean;
}) => {
  const showUpdateButton = Boolean(desktopUpdateVersion && onCheckForUpdates);
  if ((!isAuthenticated || !showPrivateChatToggle) && !showUpdateButton) {
    return null;
  }

  return (
    <div
      className={clsx(
        'fixed top-4 right-4 z-[260] flex items-center gap-2 sm:top-5 sm:right-5',
        shouldRenderBrowserPanel && 'desktop-browser-inset-controls'
      )}
    >
      {desktopUpdateVersion && onCheckForUpdates ? (
        <DesktopUpdateButton
          desktopUpdateVersion={desktopUpdateVersion}
          desktopUpdateAction={desktopUpdateAction}
          onCheckForUpdates={onCheckForUpdates}
        />
      ) : null}
      {isAuthenticated && showPrivateChatToggle ? (
        <PrivateChatToggle
          isPrivateChat={isPrivateChat}
          isPrivateChatToggleDisabled={isPrivateChatToggleDisabled}
          onTogglePrivateChat={onTogglePrivateChat}
        />
      ) : null}
    </div>
  );
};

const MobileHamburger = ({
  showMobileHero,
  isMobileViewport,
  onHamburgerClick,
}: {
  showMobileHero: boolean;
  isMobileViewport: boolean;
  onHamburgerClick: () => void;
}) => {
  if (showMobileHero || !isMobileViewport) {
    return null;
  }

  return (
    <div className="fixed top-4 left-4 z-[250] md:hidden">
      <button
        type="button"
        className="mobile-hero__hamburger"
        onClick={onHamburgerClick}
        aria-label="Open sidebar"
      >
        <MobileHamburgerIcon />
      </button>
    </div>
  );
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
        style={desktopBrowserShellStyle}
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

        <TopRightControls
          isAuthenticated={isAuthenticated}
          desktopUpdateVersion={desktopUpdateVersion}
          desktopUpdateAction={desktopUpdateAction}
          onCheckForUpdates={onCheckForUpdates}
          isPrivateChat={isPrivateChat}
          isPrivateChatToggleDisabled={isPrivateChatToggleDisabled}
          onTogglePrivateChat={onTogglePrivateChat}
          shouldRenderBrowserPanel={shouldRenderBrowserPanel}
          showPrivateChatToggle={!desktopTaskMode || desktopTaskMode === 'chat'}
        />

        <WebTaskModeNavigation
          desktopRuntime={desktopRuntime}
          isMobileViewport={isMobileViewport}
          mode={desktopTaskMode}
          onModeChange={onDesktopTaskModeChange}
        />

        <MobileHamburger
          showMobileHero={showMobileHero}
          isMobileViewport={isMobileViewport}
          onHamburgerClick={onHamburgerClick}
        />

        <div
          className={clsx(
            'main-content relative flex flex-1 justify-center px-4 pt-12 pb-14 transition duration-150 md:pr-8',
            isSidebarOpen ? 'md:pl-[20rem] lg:pl-[22rem]' : 'md:pl-32 lg:pl-40',
            isSidebarOpen && 'md:brightness-[0.94]',
            shouldRenderBrowserPanel && 'main-content--desktop-browser-inset'
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
              />
            ) : null}
            {shouldRenderCenteredPrompt ? (
              <AppPromptComposer
                {...promptComposerProps}
                desktopTaskMode={desktopTaskMode}
                desktopRightInset={desktopBrowserRightInset}
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
            desktopRightInset={desktopBrowserRightInset}
            onRealtimeVoiceActiveChange={setIsRealtimeVoiceActive}
            variant="bottom"
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
