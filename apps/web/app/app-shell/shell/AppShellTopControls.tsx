import clsx from 'clsx';
import { PanelRightOpen, Pin, PinOff } from 'lucide-react';

import {
  DesktopAuthButtons,
  DesktopCodeOpenInMenu,
  DesktopUpdateButton,
  type DesktopUpdateAction,
} from '../../lib/platform/desktop-ui';
import { PrivateChatToggle } from './PrivateChatToggle';

interface AppShellTopControlsProps {
  isAuthenticated: boolean;
  desktopUpdateVersion?: string | null;
  desktopUpdateAction: DesktopUpdateAction;
  onCheckForUpdates?: () => void;
  isPrivateChat: boolean;
  isPrivateChatToggleDisabled: boolean;
  onTogglePrivateChat: () => void;
  shouldInsetControls: boolean;
  showPrivateChatToggle: boolean;
  showCodeWorkspaceControls: boolean;
  onOpenCodeWorkspace: () => void;
  showPinnedSummaryToggle: boolean;
  isPinnedSummaryOpen: boolean;
  onTogglePinnedSummary: () => void;
  showSignIn: boolean;
  onSignIn: () => void;
}

export function AppShellTopControls({
  isAuthenticated,
  desktopUpdateVersion,
  desktopUpdateAction,
  onCheckForUpdates,
  isPrivateChat,
  isPrivateChatToggleDisabled,
  onTogglePrivateChat,
  shouldInsetControls,
  showPrivateChatToggle,
  showCodeWorkspaceControls,
  onOpenCodeWorkspace,
  showPinnedSummaryToggle,
  isPinnedSummaryOpen,
  onTogglePinnedSummary,
  showSignIn,
  onSignIn,
}: AppShellTopControlsProps) {
  const showUpdateButton = Boolean(desktopUpdateVersion && onCheckForUpdates);
  if (
    (!isAuthenticated || !showPrivateChatToggle) &&
    !showUpdateButton &&
    !showCodeWorkspaceControls &&
    !showPinnedSummaryToggle &&
    !showSignIn
  ) {
    return null;
  }

  return (
    <div
      className={clsx(
        'fixed top-4 right-4 z-[260] flex items-center gap-2 sm:top-5 sm:right-5',
        shouldInsetControls && 'desktop-browser-inset-controls'
      )}
    >
      {showSignIn ? <DesktopAuthButtons onSignIn={onSignIn} /> : null}
      {showCodeWorkspaceControls ? <DesktopCodeOpenInMenu /> : null}
      {showPinnedSummaryToggle ? (
        <button
          type="button"
          className={clsx(
            'inline-flex h-10 w-10 items-center justify-center rounded-lg border shadow-lg transition',
            isPinnedSummaryOpen
              ? 'border-blue-400/30 bg-blue-500/10 text-blue-200 hover:border-blue-300/45 hover:bg-blue-500/15 hover:text-blue-100'
              : 'border-white/10 bg-[#242424] text-slate-300 hover:bg-[#2d2d2d] hover:text-white'
          )}
          onClick={onTogglePinnedSummary}
          aria-controls="pinned-summary-panel"
          aria-expanded={isPinnedSummaryOpen}
          aria-pressed={isPinnedSummaryOpen}
          aria-label={isPinnedSummaryOpen ? 'Collapse pinned summary' : 'Expand pinned summary'}
        >
          {isPinnedSummaryOpen ? (
            <PinOff aria-hidden="true" size={17} />
          ) : (
            <Pin aria-hidden="true" size={17} />
          )}
        </button>
      ) : null}
      {showCodeWorkspaceControls ? (
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#242424] text-slate-300 shadow-lg transition hover:bg-[#2d2d2d] hover:text-white"
          onClick={onOpenCodeWorkspace}
          aria-label="Open Code workspace tools"
        >
          <PanelRightOpen aria-hidden="true" size={18} />
        </button>
      ) : null}
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
}
