'use client';

import clsx from 'clsx';
import { Bot, FolderTree, Globe, RefreshCw, Terminal } from 'lucide-react';
import React from 'react';

import { Image } from '../components/shared/Image';
import {
  SidebarIconPlus,
  SidebarIconProfile,
  SidebarIconSearch,
  SidebarIconSidebar,
} from './icons';
import type { DesktopUpdateAction } from './useDesktopShellActions';

interface CollapsedSidebarProps {
  isSidebarOpen: boolean;
  isAuthenticated: boolean;
  shouldShowNewChatShortcut: boolean;
  onLogoClick: () => void;
  onNewChat: () => void;
  onSearchClick: () => void;
  onAgentManagerClick?: () => void;
  onFileTreeClick?: () => void;
  onOpenSidebar: () => void;
  onOpenProfile: () => void;
  onOpenBrowserPreview?: () => void;
  onShowTerminal?: () => void;
  onCheckForUpdates?: () => void;
  desktopUpdateAction?: DesktopUpdateAction;
}

const raisedButtonClassName = clsx(
  'collapsed-sidebar__button inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10',
  'bg-white/5 text-slate-100 shadow-[0_10px_22px_rgba(0,0,0,0.35)] transition duration-150',
  'hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/10 hover:shadow-[0_14px_28px_rgba(2,6,23,0.55),0_0_18px_rgba(59,130,246,0.35)]'
);

const bareButtonClassName = clsx(
  'collapsed-sidebar__button collapsed-sidebar__button--bare inline-flex h-12 w-12 items-center justify-center rounded-full border border-transparent',
  'bg-transparent text-slate-100 shadow-none transition duration-150',
  'hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/10 hover:shadow-[0_14px_28px_rgba(2,6,23,0.55),0_0_18px_rgba(59,130,246,0.35)]',
  'focus-visible:border-white/25 focus-visible:bg-white/10 focus-visible:shadow-[0_14px_28px_rgba(2,6,23,0.55),0_0_18px_rgba(59,130,246,0.35)] focus-visible:outline-none',
  'disabled:translate-y-0 disabled:border-transparent disabled:bg-transparent disabled:shadow-none'
);

export const CollapsedSidebar: React.FC<CollapsedSidebarProps> = ({
  isSidebarOpen,
  isAuthenticated,
  shouldShowNewChatShortcut,
  onLogoClick,
  onNewChat,
  onSearchClick,
  onAgentManagerClick,
  onFileTreeClick,
  onOpenSidebar,
  onOpenProfile,
  onOpenBrowserPreview,
  onShowTerminal,
  onCheckForUpdates,
  desktopUpdateAction = 'idle',
}) => {
  const isDesktopUpdateBusy = desktopUpdateAction !== 'idle';
  const updateButtonAriaLabel =
    desktopUpdateAction === 'installing'
      ? 'Installing update'
      : desktopUpdateAction === 'checking'
        ? 'Checking for updates'
        : 'Check for updates';

  return (
    <nav
      className={clsx(
        'collapsed-sidebar fixed top-1/2 left-6 z-[250] hidden w-[78px] -translate-y-1/2 flex-col gap-3 px-3.5 py-3 md:flex',
        'rounded-full border border-blue-500/30',
        'bg-[radial-gradient(circle_at_50%_24%,rgba(59,130,246,0.28),rgba(14,165,233,0.12)_44%,transparent_70%),rgba(8,12,24,0.85)]',
        'shadow-[0_18px_48px_rgba(2,6,23,0.55),0_0_26px_rgba(59,130,246,0.32),inset_0_0_0_1px_rgba(255,255,255,0.04)]',
        'backdrop-blur-xl transition duration-150',
        isSidebarOpen && 'pointer-events-none -translate-x-3 opacity-0'
      )}
      aria-label="Quick navigation"
    >
      <div className="flex w-full items-center justify-center">
        <button
          type="button"
          className="collapsed-sidebar__button--logo relative inline-flex h-14 w-14 items-center justify-center border-none bg-transparent shadow-none transition duration-150 hover:-translate-y-0.5"
          onClick={onLogoClick}
          aria-label="Go to home"
        >
          <Image
            src="/icon.png"
            alt="TaskForceAI"
            fill
            sizes="56px"
            priority
            loading="eager"
            className="collapsed-sidebar__logo object-contain"
          />
        </button>
      </div>
      {shouldShowNewChatShortcut ? (
        <button
          type="button"
          className={bareButtonClassName}
          onClick={onNewChat}
          aria-label="Start new chat"
        >
          <SidebarIconPlus />
        </button>
      ) : null}
      <button
        type="button"
        className={bareButtonClassName}
        onClick={onSearchClick}
        aria-label="Search"
      >
        <SidebarIconSearch />
      </button>
      {onOpenBrowserPreview ? (
        <button
          type="button"
          className={raisedButtonClassName}
          onClick={onOpenBrowserPreview}
          aria-label="Open browser preview"
        >
          <Globe aria-hidden="true" size={20} strokeWidth={2} />
        </button>
      ) : null}
      {onShowTerminal ? (
        <button
          type="button"
          className={raisedButtonClassName}
          onClick={onShowTerminal}
          aria-label="Toggle terminal"
        >
          <Terminal aria-hidden="true" size={20} strokeWidth={2} />
        </button>
      ) : null}
      {onAgentManagerClick ? (
        <button
          type="button"
          className={raisedButtonClassName}
          onClick={onAgentManagerClick}
          aria-label="Open agent manager"
        >
          <Bot aria-hidden="true" size={20} strokeWidth={2} />
        </button>
      ) : null}
      {onFileTreeClick ? (
        <button
          type="button"
          className={raisedButtonClassName}
          onClick={onFileTreeClick}
          aria-label="Toggle files"
        >
          <FolderTree aria-hidden="true" size={20} strokeWidth={2} />
        </button>
      ) : null}
      {onCheckForUpdates ? (
        <button
          type="button"
          className={clsx(raisedButtonClassName, isDesktopUpdateBusy && 'cursor-wait opacity-80')}
          disabled={isDesktopUpdateBusy}
          onClick={onCheckForUpdates}
          aria-busy={isDesktopUpdateBusy || undefined}
          aria-label={updateButtonAriaLabel}
        >
          <RefreshCw
            aria-hidden="true"
            className={clsx(isDesktopUpdateBusy && 'animate-spin')}
            size={20}
            strokeWidth={2}
          />
        </button>
      ) : null}
      <button
        type="button"
        className={bareButtonClassName}
        onClick={onOpenSidebar}
        aria-label="Open sidebar"
      >
        <SidebarIconSidebar />
      </button>
      <button
        type="button"
        className={clsx(
          bareButtonClassName,
          'collapsed-sidebar__profile',
          !isAuthenticated && 'cursor-not-allowed opacity-55'
        )}
        onClick={onOpenProfile}
        aria-label="Open profile"
        disabled={!isAuthenticated}
      >
        <SidebarIconProfile />
      </button>
    </nav>
  );
};
