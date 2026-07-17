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
  DesktopBrowserPanel,
  DesktopCodePinnedSummary,
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
import { WorkPinnedSummary } from './PinnedSummaryCard';
import { collectPinnedSummaryData } from './pinned-summary-data';
import { DesktopCommandPalette, type DesktopCommandPaletteItem } from './DesktopCommandPalette';
import { DesktopPlanPanel } from './DesktopPlanPanel';
import {
  DESKTOP_COMMANDS,
  DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT,
  desktopBindingMatches,
  readDesktopCommandBindings,
} from '../../lib/commands/desktop-command-bindings';
import type { ConversationActivity } from '../../components/chat/conversation-activity';
import { adjacentTask, type TaskNavigationDirection } from './desktop-task-navigation';
import { logger } from '../../lib/logger';

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
  agentStatuses?: readonly unknown[];
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
  activeConversationActivity?: ConversationActivity | null;
  isTerminalOpen?: boolean;
  isBrowserPreviewOpen?: boolean;
  enableWorkspaceFileTree?: boolean;
  userEmail?: string | null;
  userImpersonatorId?: string | null;
  onConversationSelect: NonNullable<React.ComponentProps<typeof Sidebar>['onConversationSelect']>;
  onPaletteTaskSelect?: (
    _record: import('../../lib/platform/platform-interfaces').ConversationRecord
  ) => void | Promise<void>;
  loadPaletteTasks?: () => Promise<
    import('../../lib/platform/platform-interfaces').ConversationRecord[]
  >;
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
  onRestoreMessage?: (_message: React.ComponentProps<typeof ChatView>['messages'][number]) => void;
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
const PINNED_SUMMARY_INSET = '24rem';
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
  agentStatuses = [],
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
  activeConversationActivity = null,
  isTerminalOpen: terminalOpen,
  isBrowserPreviewOpen: browserPreviewOpen,
  enableWorkspaceFileTree: workspaceFileTreeEnabled,
  userEmail,
  userImpersonatorId,
  onConversationSelect,
  onPaletteTaskSelect,
  loadPaletteTasks,
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
  onRestoreMessage,
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
  const [isPinnedSummaryOpen, setIsPinnedSummaryOpen] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandBindings, setCommandBindings] = useState(readDesktopCommandBindings);
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
  const rightWorkspacePaneActive = shouldRenderBrowserPanel || codeWorkspacePaneActive;
  const conversationStarted = conversation.isInitialized && messages.length > 0;
  const pinnedSummaryAvailable =
    conversationStarted &&
    (desktopTaskMode === 'work' || (desktopRuntime && desktopTaskMode === 'code'));
  const showPinnedSummary =
    pinnedSummaryAvailable && isPinnedSummaryOpen && !rightWorkspacePaneActive;
  const desktopRightInset = codeWorkspacePaneActive
    ? DESKTOP_CODE_WORKSPACE_PANE_WIDTH
    : (desktopBrowserRightInset ?? (showPinnedSummary ? PINNED_SUMMARY_INSET : undefined));
  const desktopShellStyle = desktopRightInset
    ? ({
        '--desktop-browser-panel-width': desktopRightInset,
      } as React.CSSProperties & Record<'--desktop-browser-panel-width', string>)
    : desktopBrowserShellStyle;
  const showWorkPinnedSummary = showPinnedSummary && desktopTaskMode === 'work';
  const showCodePinnedSummary = showPinnedSummary && desktopRuntime && desktopTaskMode === 'code';
  const pinnedSummaryData = React.useMemo(() => collectPinnedSummaryData(messages), [messages]);

  React.useEffect(() => {
    if (desktopTaskMode !== 'code') setIsCodeWorkspaceOpen(false);
  }, [desktopTaskMode]);

  const navigateTask = React.useCallback(
    async (direction: TaskNavigationDirection) => {
      if (!loadPaletteTasks || !onPaletteTaskSelect) return;
      try {
        const target = adjacentTask(
          await loadPaletteTasks(),
          conversation.conversationId,
          direction
        );
        if (target) await onPaletteTaskSelect(target);
      } catch (error) {
        logger.error('Failed to navigate desktop tasks', { direction, error });
      }
    },
    [conversation.conversationId, loadPaletteTasks, onPaletteTaskSelect]
  );

  const desktopCommands = React.useMemo<DesktopCommandPaletteItem[]>(() => {
    const actions = {
      'palette.open': () => setIsCommandPaletteOpen(true),
      'task.new': onNewChat,
      'task.search': onSearchClick,
      'task.previous': () => void navigateTask(-1),
      'task.next': () => void navigateTask(1),
      'settings.open': onOpenProfile,
      'sidebar.toggle': isSidebarOpen ? onSidebarClose : onOpenSidebar,
      'mode.chat': () => onDesktopTaskModeChange?.('chat'),
      'mode.work': () => onDesktopTaskModeChange?.('work'),
      'mode.code': () => onDesktopTaskModeChange?.('code'),
      'code.files': () => setIsFileTreeOpen(true),
      'code.terminal': () => (isTerminalOpen ? onCloseTerminal() : onShowTerminal?.()),
      'code.workspace': () => {
        setCodeWorkspaceView('empty');
        setIsCodeWorkspaceOpen(true);
      },
    } as const;
    return DESKTOP_COMMANDS.filter(
      (command) => command.scope === 'all' || desktopTaskMode === 'code'
    ).map((command) =>
      Object.assign({}, command, {
        binding: commandBindings[command.id],
        run: actions[command.id],
      })
    );
  }, [
    commandBindings,
    desktopTaskMode,
    isSidebarOpen,
    onDesktopTaskModeChange,
    onNewChat,
    navigateTask,
    isTerminalOpen,
    onCloseTerminal,
    onOpenProfile,
    onOpenSidebar,
    onSearchClick,
    onShowTerminal,
    onSidebarClose,
  ]);

  React.useEffect(() => {
    if (!desktopRuntime) return;
    const refresh = () => setCommandBindings(readDesktopCommandBindings());
    const handleKeyDown = (event: KeyboardEvent) => {
      const command = desktopCommands.find((candidate) =>
        desktopBindingMatches(candidate.binding, event)
      );
      if (!command) return;
      event.preventDefault();
      command.run();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT, refresh);
    };
  }, [desktopCommands, desktopRuntime]);

  return (
    <>
      {userImpersonatorId && (
        <div className="sticky top-0 z-[1000] bg-red-600 py-1 text-center text-xs font-bold tracking-widest text-white uppercase">
          Support Mode: Impersonating {userEmail}
        </div>
      )}
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
          onShowTerminal={desktopTaskMode === 'code' ? onShowTerminal : undefined}
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
          activeConversationActivity={activeConversationActivity}
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
          shouldInsetControls={rightWorkspacePaneActive}
          showPrivateChatToggle={!desktopTaskMode || desktopTaskMode === 'chat'}
          showCodeWorkspaceControls={desktopRuntime && desktopTaskMode === 'code'}
          onOpenCodeWorkspace={() => {
            setCodeWorkspaceView('empty');
            setIsCodeWorkspaceOpen(true);
          }}
          showPinnedSummaryToggle={pinnedSummaryAvailable && !rightWorkspacePaneActive}
          isPinnedSummaryOpen={isPinnedSummaryOpen}
          onTogglePinnedSummary={() => setIsPinnedSummaryOpen((open) => !open)}
          showSignIn={!isAuthenticated && !isAuthLoading && !isMobileViewport}
          onSignIn={onSignIn}
        />

        <AppShellNavigationControls
          desktopRuntime={desktopRuntime}
          isMobileViewport={isMobileViewport}
          mode={desktopTaskMode}
          onModeChange={onDesktopTaskModeChange}
          showMobileHero={showMobileHero}
          onHamburgerClick={onHamburgerClick}
        />

        {showWorkPinnedSummary ? (
          <WorkPinnedSummary
            data={pinnedSummaryData}
            onCreateOutput={() => {
              const current = promptComposerProps.promptValue?.trim() ?? '';
              promptComposerProps.onPromptValueChange?.(
                current ? `${current}\n\nCreate a file or site` : 'Create a file or site'
              );
            }}
          />
        ) : null}
        {showCodePinnedSummary ? (
          <DesktopCodePinnedSummary
            sources={pinnedSummaryData.sources}
            onOpenEnvironment={() => {
              setCodeWorkspaceView('empty');
              setIsCodeWorkspaceOpen(true);
            }}
            onReviewChanges={() => {
              setCodeWorkspaceView('review');
              setIsCodeWorkspaceOpen(true);
            }}
          />
        ) : null}
        {desktopRuntime && (desktopTaskMode === 'work' || desktopTaskMode === 'code') ? (
          <DesktopPlanPanel agentStatuses={agentStatuses} />
        ) : null}

        <div
          className={clsx(
            'main-content relative flex flex-1 justify-center px-4 pt-12 pb-14 transition duration-150 md:pr-8',
            isSidebarOpen ? 'md:pl-[20rem] lg:pl-[22rem]' : 'md:pl-32 lg:pl-40',
            isSidebarOpen && !desktopRuntime && 'md:brightness-[0.94]',
            rightWorkspacePaneActive && 'main-content--desktop-browser-inset',
            showPinnedSummary && 'main-content--pinned-summary-inset'
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
                onRestoreMessage={
                  desktopRuntime &&
                  (desktopTaskMode === 'work' || desktopTaskMode === 'code') &&
                  !isPrivateChat
                    ? onRestoreMessage
                    : undefined
                }
              />
            ) : null}
            {shouldRenderCenteredPrompt ? (
              <AppPromptComposer
                {...promptComposerProps}
                desktopTaskMode={desktopTaskMode}
                desktopRightInset={desktopRightInset}
                desktopPinnedSummaryInset={showPinnedSummary}
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
            desktopPinnedSummaryInset={showPinnedSummary}
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
        <DesktopTerminalPanel
          open={isTerminalOpen && desktopTaskMode === 'code'}
          onClose={onCloseTerminal}
          scopeKey={
            conversation.conversationId ? `task:${conversation.conversationId}` : 'task:draft'
          }
          scopeLabel={conversation.conversationId ? 'Task terminal' : 'New task terminal'}
        />
        <DesktopCompanion pet={companionPet} />
        {desktopRuntime ? (
          <DesktopCommandPalette
            open={isCommandPaletteOpen}
            commands={desktopCommands}
            includeFiles={desktopTaskMode === 'code'}
            loadTasks={loadPaletteTasks}
            onTaskSelect={onPaletteTaskSelect ?? (() => undefined)}
            onFileSelect={(path) => {
              setIsFileTreeOpen(true);
              const current = promptComposerProps.promptValue ?? '';
              promptComposerProps.onPromptValueChange?.(
                current.trim() ? `${current.trimEnd()}\n@${path}` : `@${path}`
              );
            }}
            onClose={() => setIsCommandPaletteOpen(false)}
          />
        ) : null}
      </div>
    </>
  );
}
