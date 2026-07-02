'use client';

import clsx from 'clsx';
import React, { useState } from 'react';

import Sidebar from '../components/shell/Sidebar';
import type { AppServerPetState } from '../lib/platform/desktop/app-server';
import { AppPromptComposer } from './AppPromptComposer';
import { ChatView } from './ChatView';
import { CollapsedSidebar } from './CollapsedSidebar';
import { DesktopCompanion } from './DesktopCompanion';
import { DesktopAuthButtons } from './DesktopAuthButtons';
import { DesktopTerminalPanel } from './DesktopTerminalPanel';
import { MobileHamburgerIcon } from './icons';
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
  isTerminalOpen?: boolean;
  enableWorkspaceFileTree?: boolean;
  userEmail?: string | null;
  userImpersonatorId?: string | null;
  onConversationSelect: NonNullable<React.ComponentProps<typeof Sidebar>['onConversationSelect']>;
  onHamburgerClick: () => void;
  onLogoClick: () => void;
  onNewChat: () => void;
  onOpenChangelog: () => void;
  onOpenProfile: () => void;
  onOpenReportIssue: () => void;
  onOpenSidebar: () => void;
  onSearchClick: () => void;
  onAgentManagerClick?: () => void;
  onSendMessage: (content: string) => void;
  onShare: () => void;
  onShowTerminal?: () => void;
  onCloseTerminal?: () => void;
  onCheckForUpdates?: () => void;
  onSidebarClose: () => void;
  onSignIn: () => void;
  clearErrorMessage: () => void;
}

export function AppShellFrame({
  canShareConversation,
  conversation,
  errorMessage,
  isAuthLoading,
  isAuthenticated,
  isMobileViewport,
  isPromptDisabled,
  isSidebarOpen,
  companionPet,
  messages,
  modelSelectorBootstrap,
  promptComposerProps,
  promptVariant,
  rateLimitResetTime,
  shouldShowNewChatShortcut,
  showMobileHero,
  showPromptLogo,
  desktopUpdateVersion,
  isTerminalOpen = false,
  enableWorkspaceFileTree = false,
  userEmail,
  userImpersonatorId,
  onConversationSelect,
  onHamburgerClick,
  onLogoClick,
  onNewChat,
  onOpenChangelog,
  onOpenProfile,
  onOpenReportIssue,
  onOpenSidebar,
  onSearchClick,
  onAgentManagerClick,
  onSendMessage,
  onShare,
  onShowTerminal,
  onCloseTerminal,
  onCheckForUpdates,
  onSidebarClose,
  onSignIn,
  clearErrorMessage,
}: AppShellFrameProps) {
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(false);
  const [isRealtimeVoiceActive, setIsRealtimeVoiceActive] = useState(false);
  const shouldRenderCenteredPrompt = conversation.isInitialized || promptVariant === 'centered';
  const shouldRenderChatView =
    conversation.isInitialized &&
    (messages.length > 0 ||
      showMobileHero ||
      Boolean(errorMessage) ||
      Boolean(conversation.hasMoreMessages));

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
          onShowTerminal={onShowTerminal}
          onCheckForUpdates={onCheckForUpdates}
        />

        <Sidebar
          isOpen={isSidebarOpen}
          onClose={onSidebarClose}
          onNewChat={onNewChat}
          onOpenChangelog={onOpenChangelog}
          onOpenReportIssue={onOpenReportIssue}
          onCheckForUpdates={onCheckForUpdates}
          desktopUpdateVersion={desktopUpdateVersion}
          activeConversationId={conversation.conversationId ?? null}
          onConversationSelect={onConversationSelect}
        />

        <WorkspaceFileTreePanel
          isOpen={enableWorkspaceFileTree && isFileTreeOpen}
          onClose={() => setIsFileTreeOpen(false)}
        />

        {desktopUpdateVersion && onCheckForUpdates ? (
          <button
            type="button"
            className={clsx(
              'fixed top-5 right-5 z-[260] hidden items-center gap-2 rounded-full border border-blue-300/50',
              'bg-blue-400/15 px-4 py-2 text-sm font-semibold text-blue-100 shadow-[0_18px_42px_rgba(37,99,235,0.24)]',
              'backdrop-blur-xl transition hover:border-blue-200/70 hover:bg-blue-400/20 lg:inline-flex'
            )}
            onClick={onCheckForUpdates}
            aria-label={`Install TaskForceAI ${desktopUpdateVersion}`}
          >
            <span className="h-2 w-2 rounded-full bg-blue-200 shadow-[0_0_14px_rgba(191,219,254,0.9)]" />
            <span>Update {desktopUpdateVersion}</span>
          </button>
        ) : null}

        {!showMobileHero && isMobileViewport && (
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
        )}

        <div
          className={clsx(
            'main-content relative flex flex-1 justify-center px-4 pt-12 pb-14 transition duration-150 md:pr-8',
            isSidebarOpen ? 'md:pl-[20rem] lg:pl-[22rem]' : 'md:pl-32 lg:pl-40',
            isSidebarOpen && 'md:brightness-[0.94]'
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
                modelSelectorBootstrap={modelSelectorBootstrap ?? null}
                onHamburgerClick={onHamburgerClick}
                onSignIn={onSignIn}
                onSendMessage={onSendMessage}
                clearErrorMessage={clearErrorMessage}
                ensureConversationId={conversation.ensureActiveConversation}
                canShare={canShareConversation}
                onShare={onShare}
                hasMoreMessages={conversation.hasMoreMessages}
                isLoadingMore={conversation.isLoadingMore}
                onLoadMore={() => void conversation.loadMoreMessages()}
              />
            ) : null}
            {shouldRenderCenteredPrompt ? (
              <AppPromptComposer
                {...promptComposerProps}
                onRealtimeVoiceActiveChange={setIsRealtimeVoiceActive}
                variant="centered"
              />
            ) : null}
          </main>
        </div>

        {conversation.isInitialized ? (
          <AppPromptComposer
            {...promptComposerProps}
            onRealtimeVoiceActiveChange={setIsRealtimeVoiceActive}
            variant="bottom"
          />
        ) : null}
        <DesktopTerminalPanel open={isTerminalOpen} onClose={onCloseTerminal ?? (() => {})} />
        <DesktopCompanion pet={companionPet} />
      </div>
    </>
  );
}
