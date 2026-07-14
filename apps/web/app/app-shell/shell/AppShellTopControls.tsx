import clsx from 'clsx';
import { PanelRightOpen } from 'lucide-react';

import {
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
}: AppShellTopControlsProps) {
  const showUpdateButton = Boolean(desktopUpdateVersion && onCheckForUpdates);
  if (
    (!isAuthenticated || !showPrivateChatToggle) &&
    !showUpdateButton &&
    !showCodeWorkspaceControls
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
      {showCodeWorkspaceControls ? <DesktopCodeOpenInMenu /> : null}
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
