'use client';

import clsx from 'clsx';
import { LayoutPanelTop, RefreshCw } from 'lucide-react';
import React, { useState } from 'react';

import { useProfileModal } from '../../lib/profile/ProfileModalContext';
import { useProjects } from '../../lib/projects/ProjectsContext';
import { useAuth } from '../../lib/providers/AuthProvider';
import ConversationList from '../chat/ConversationList';
import { useRouter } from '../routing';
import { Image } from '../shared/Image';
import { SidebarProfileMenu } from './SidebarProfileMenu';
import { SidebarProjects } from './SidebarProjects';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onOpenChangelog?: () => void;
  onOpenReportIssue?: () => void;
  onCheckForUpdates?: () => void;
  desktopUpdateVersion?: string | null;
  onConversationSelect?: React.ComponentProps<typeof ConversationList>['onConversationSelect'];
  activeConversationId?: string | null;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  onNewChat,
  onOpenChangelog,
  onOpenReportIssue,
  onCheckForUpdates,
  desktopUpdateVersion,
  onConversationSelect,
  activeConversationId,
}) => {
  const router = useRouter();
  const { open: openProfileModal } = useProfileModal();
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    setModalOpen: setProjectModalOpen,
  } = useProjects();
  const { isAuthenticated, user } = useAuth();

  const handleNewChat = () => {
    onNewChat();
    onClose();
  };

  const handleLogoClick = () => {
    void router.navigate({ to: '/' });
    onClose();
  };

  const handleArtifactsClick = () => {
    void router.navigate({ to: '/artifacts' });
    onClose();
  };

  const hasHelpMenu = Boolean(onOpenReportIssue || onOpenChangelog);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const shouldMountConversationList = isOpen || isAuthenticated;

  return (
    <>
      <div
        className={clsx(
          'sidebar-overlay fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
        aria-hidden="true"
      ></div>
      <aside
        className={clsx(
          'sidebar fixed top-0 left-0 z-50 h-full w-72 transform transition-transform duration-200',
          'border-r border-blue-500/30 bg-[#060a14]/95 text-slate-100',
          'shadow-[20px_0_70px_rgba(2,6,23,0.55),0_0_32px_rgba(59,130,246,0.16)] backdrop-blur-xl',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="sidebar-shell flex h-full flex-col gap-4 px-4 py-5">
          <div className="sidebar-logo-bar flex items-center gap-3">
            <button
              type="button"
              className="sidebar-logo-button relative -ml-1 inline-flex h-14 w-14 items-center justify-center border-none bg-transparent shadow-none"
              onClick={handleLogoClick}
              aria-label="Go home"
            >
              <Image
                src="/icon.png"
                alt="TaskForceAI"
                fill
                sizes="56px"
                priority
                loading="eager"
                className="object-contain"
              />
            </button>
            <div className="sidebar-search flex-1">
              <input
                type="search"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Search ⌘K"
                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-300/70 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/40 focus:outline-none"
              />
            </div>
          </div>
          <div className="sidebar-shortcuts flex flex-col gap-2">
            <button
              type="button"
              className="sidebar-shortcut inline-flex w-full items-center gap-2 rounded-xl border border-dashed border-white/20 bg-blue-500/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-white/30"
              onClick={handleNewChat}
              aria-label="Start new chat"
            >
              <span>＋</span>
              <span>Chat</span>
            </button>
            <button
              type="button"
              className="sidebar-shortcut inline-flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
              onClick={handleArtifactsClick}
              aria-label="Open artifacts"
            >
              <LayoutPanelTop aria-hidden="true" size={16} strokeWidth={2} />
              <span>Artifacts</span>
            </button>
          </div>

          <div className="sidebar-content flex-1 overflow-y-auto pr-1">
            <SidebarProjects
              activeProjectId={activeProjectId}
              projects={projects}
              onManageProjects={() => setProjectModalOpen(true)}
              onSelectProject={setActiveProjectId}
            />

            <div className="sidebar-section-heading mb-2 text-[11px] font-semibold tracking-[0.15em] text-slate-400 uppercase">
              Conversations
            </div>
            {shouldMountConversationList ? (
              <ConversationList
                key={user?.id ?? 'anonymous'}
                onConversationClick={onClose}
                showSearch={false}
                searchQuery={sidebarSearch}
                activeConversationId={activeConversationId}
                {...(onConversationSelect ? { onConversationSelect } : {})}
              />
            ) : null}
          </div>
          <div className="sidebar-footer border-t border-white/10 pt-3">
            {onCheckForUpdates ? (
              <button
                type="button"
                className={clsx(
                  'mb-3 inline-flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition',
                  desktopUpdateVersion
                    ? 'border-blue-300/50 bg-blue-400/15 text-blue-100 hover:border-blue-200/70 hover:bg-blue-400/20'
                    : 'border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.08]'
                )}
                onClick={onCheckForUpdates}
                aria-label={
                  desktopUpdateVersion
                    ? `Install TaskForceAI ${desktopUpdateVersion}`
                    : 'Check for updates'
                }
              >
                <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
                <span>
                  {desktopUpdateVersion ? `Update ${desktopUpdateVersion}` : 'Check updates'}
                </span>
              </button>
            ) : null}
            <SidebarProfileMenu
              hasHelpMenu={hasHelpMenu}
              onClose={onClose}
              onOpenChangelog={onOpenChangelog}
              onOpenProfile={() => openProfileModal({ onOpen: onClose })}
              onOpenReportIssue={onOpenReportIssue}
              user={user}
            />
            <button
              type="button"
              className="sidebar-collapse"
              aria-label="Close sidebar"
              onClick={onClose}
            >
              ≪
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
