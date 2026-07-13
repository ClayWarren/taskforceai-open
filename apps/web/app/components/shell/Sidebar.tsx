'use client';

import clsx from 'clsx';
import {
  BadgeDollarSign,
  Clock3,
  Folder,
  GitPullRequest,
  LayoutPanelTop,
  MessageCircle,
  Plug,
  RefreshCw,
  Search,
  SquarePen,
} from 'lucide-react';
import React, { useState } from 'react';

import { useProfileModal } from '../../lib/profile/ProfileModalContext';
import { useProjects } from '../../lib/projects/ProjectsContext';
import { useAuth } from '../../lib/providers/AuthProvider';
import ConversationList from '../chat/ConversationList';
import { useRouter } from '../routing';
import { Image } from '../shared/Image';
import { SidebarProfileMenu } from './SidebarProfileMenu';
import { DesktopTaskModeSwitcher } from './DesktopTaskModeSwitcher';
import type { DesktopUpdateAction } from '../../app-shell/useDesktopShellActions';
import type { DesktopTaskMode } from '../../lib/desktop/task-mode';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onOpenChangelog?: () => void;
  onOpenReportIssue?: () => void;
  onCheckForUpdates?: () => void;
  onAgentManagerClick?: () => void;
  desktopUpdateVersion?: string | null;
  desktopUpdateAction?: DesktopUpdateAction;
  desktopUpdateMessage?: string | null;
  onConversationSelect?: React.ComponentProps<typeof ConversationList>['onConversationSelect'];
  activeConversationId?: string | null;
  desktopTaskMode?: DesktopTaskMode;
  onDesktopTaskModeChange?: (_mode: DesktopTaskMode) => void;
  desktopRuntime?: boolean;
}

const desktopTaskNavRow =
  'flex min-h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[15px] text-slate-200 transition hover:bg-white/[0.07]';

function DesktopTaskSidebarContent(props: {
  mode: 'work' | 'code';
  searchQuery: string;
  activeConversationId?: string | null;
  onConversationSelect?: React.ComponentProps<typeof ConversationList>['onConversationSelect'];
  onClose: () => void;
  onNewTask: () => void;
  onScheduled: () => void;
  onPlugins: () => void;
  onArtifacts: () => void;
  onPullRequests?: () => void;
  onSwitchToChat: () => void;
}) {
  const { projects, activeProjectId, setActiveProjectId } = useProjects();
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  return (
    <>
      <nav
        className="space-y-0.5"
        aria-label={`${props.mode === 'code' ? 'Code' : 'Work'} navigation`}
      >
        <button type="button" className={desktopTaskNavRow} onClick={props.onNewTask}>
          <SquarePen aria-hidden="true" size={18} />
          New task
        </button>
        <button type="button" className={desktopTaskNavRow} onClick={props.onScheduled}>
          <Clock3 aria-hidden="true" size={18} />
          Scheduled
        </button>
        <button type="button" className={desktopTaskNavRow} onClick={props.onPlugins}>
          <Plug aria-hidden="true" size={18} />
          Plugins
        </button>
        <button type="button" className={desktopTaskNavRow} onClick={props.onArtifacts}>
          <LayoutPanelTop aria-hidden="true" size={18} />
          Artifacts
        </button>
        {props.mode === 'code' && props.onPullRequests ? (
          <button type="button" className={desktopTaskNavRow} onClick={props.onPullRequests}>
            <GitPullRequest aria-hidden="true" size={18} />
            Pull requests
          </button>
        ) : null}
        <button type="button" className={desktopTaskNavRow} onClick={props.onSwitchToChat}>
          <MessageCircle aria-hidden="true" size={18} />
          Chat
        </button>
      </nav>

      <section className="mt-7" aria-label="Projects">
        <div className="mb-2 px-2.5 text-sm font-medium text-slate-500">Projects</div>
        <div className="space-y-0.5">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={clsx(
                desktopTaskNavRow,
                activeProjectId === project.id && 'bg-white/[0.09] text-white'
              )}
              onClick={() => setActiveProjectId(project.id)}
            >
              <Folder aria-hidden="true" size={17} />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
          <button
            type="button"
            aria-label="Don't work in a project"
            className={clsx(
              desktopTaskNavRow,
              activeProjectId === null && 'bg-white/[0.09] text-white'
            )}
            onClick={() => setActiveProjectId(null)}
          >
            <span className="text-lg leading-none">×</span>
            Don&apos;t work in a project
          </button>
        </div>
      </section>

      <section className="mt-5 min-h-0 flex-1 overflow-y-auto" aria-label="Tasks">
        <div className="mb-2 flex items-center gap-1 px-2.5 text-sm font-medium text-slate-500">
          <span>{activeProject?.name ?? 'Tasks'}</span>
        </div>
        <ConversationList
          onConversationClick={props.onClose}
          showSearch={false}
          searchQuery={props.searchQuery}
          activeConversationId={props.activeConversationId}
          {...(props.onConversationSelect
            ? { onConversationSelect: props.onConversationSelect }
            : {})}
        />
      </section>
    </>
  );
}

const desktopUpdateLabels = (
  action: DesktopUpdateAction,
  version: string | null | undefined
): { label: string; ariaLabel: string } => {
  if (action === 'installing') {
    return {
      label: 'Installing...',
      ariaLabel: `Installing TaskForceAI ${version ?? 'update'}`,
    };
  }
  if (action === 'checking') {
    return { label: 'Checking...', ariaLabel: 'Checking for updates' };
  }
  return version
    ? {
        label: `Update ${version}`,
        ariaLabel: `Install TaskForceAI ${version}`,
      }
    : { label: 'Check updates', ariaLabel: 'Check for updates' };
};

const productShortcutClassName =
  'sidebar-shortcut inline-flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]';

function SidebarProductShortcuts(props: {
  isAuthenticated: boolean;
  onArtifacts: () => void;
  onFinance: () => void;
  onNewChat: () => void;
  onPlugins: () => void;
  onProjects: () => void;
  onScheduled: () => void;
}) {
  return (
    <div className="sidebar-shortcuts flex flex-col gap-2">
      <button
        type="button"
        className="sidebar-shortcut inline-flex w-full items-center gap-2 rounded-xl border border-dashed border-white/20 bg-blue-500/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-white/30"
        onClick={props.onNewChat}
        aria-label="Start new chat"
      >
        <span>＋</span>
        <span>Chat</span>
      </button>
      {props.isAuthenticated ? (
        <button
          type="button"
          className={productShortcutClassName}
          onClick={props.onPlugins}
          aria-label="Open plugins"
        >
          <Plug aria-hidden="true" size={16} strokeWidth={2} />
          <span>Plugins</span>
        </button>
      ) : null}
      {props.isAuthenticated ? (
        <button
          type="button"
          className={productShortcutClassName}
          onClick={props.onProjects}
          aria-label="Open projects"
        >
          <Folder aria-hidden="true" size={16} strokeWidth={2} />
          <span>Projects</span>
        </button>
      ) : null}
      {props.isAuthenticated ? (
        <button
          type="button"
          className={productShortcutClassName}
          onClick={props.onScheduled}
          aria-label="Open scheduled tasks"
        >
          <Clock3 aria-hidden="true" size={16} strokeWidth={2} />
          <span>Scheduled</span>
        </button>
      ) : null}
      <button
        type="button"
        className={productShortcutClassName}
        onClick={props.onArtifacts}
        aria-label="Open artifacts"
      >
        <LayoutPanelTop aria-hidden="true" size={16} strokeWidth={2} />
        <span>Artifacts</span>
      </button>
      {props.isAuthenticated ? (
        <button
          type="button"
          className={productShortcutClassName}
          onClick={props.onFinance}
          aria-label="Open finance"
        >
          <BadgeDollarSign aria-hidden="true" size={16} strokeWidth={2} />
          <span>Finance</span>
        </button>
      ) : null}
    </div>
  );
}

type DesktopTaskShellMode = Exclude<DesktopTaskMode, 'chat'>;

function SidebarHeader(props: {
  desktopRuntime: boolean;
  desktopSearchOpen: boolean;
  desktopTaskMode: DesktopTaskShellMode | null;
  onDesktopSearchToggle: () => void;
  onDesktopTaskModeChange?: (_mode: DesktopTaskMode) => void;
  onLogoClick: () => void;
  onSearchChange: (_value: string) => void;
  searchQuery: string;
  selectedTaskMode?: DesktopTaskMode;
}) {
  const desktopTaskShell = props.desktopTaskMode !== null;
  return (
    <>
      <div className="sidebar-logo-bar flex items-center gap-3">
        {desktopTaskShell ? (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-1 py-2">
            {props.selectedTaskMode && props.onDesktopTaskModeChange ? (
              <DesktopTaskModeSwitcher
                mode={props.selectedTaskMode}
                desktopRuntime={props.desktopRuntime}
                onModeChange={props.onDesktopTaskModeChange}
                variant="sidebar-header"
              />
            ) : (
              <span className="truncate text-lg font-semibold text-slate-100">
                {props.desktopTaskMode === 'code' ? 'Code' : 'Work'}
              </span>
            )}
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
              aria-label="Search tasks"
              aria-expanded={props.desktopSearchOpen}
              onClick={props.onDesktopSearchToggle}
            >
              <Search aria-hidden="true" size={19} />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="sidebar-logo-button relative -ml-1 inline-flex h-14 w-14 items-center justify-center border-none bg-transparent shadow-none"
              onClick={props.onLogoClick}
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
                value={props.searchQuery}
                onChange={(event) => props.onSearchChange(event.currentTarget.value)}
                placeholder="Search ⌘K"
                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-300/70 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/40 focus:outline-none"
              />
            </div>
          </>
        )}
      </div>
      {desktopTaskShell && props.desktopSearchOpen ? (
        <input
          autoFocus
          type="search"
          value={props.searchQuery}
          onChange={(event) => props.onSearchChange(event.currentTarget.value)}
          placeholder="Search tasks"
          className="mx-1 mb-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
        />
      ) : null}
      {!desktopTaskShell && props.selectedTaskMode && props.onDesktopTaskModeChange ? (
        <DesktopTaskModeSwitcher
          mode={props.selectedTaskMode}
          desktopRuntime={props.desktopRuntime}
          onModeChange={props.onDesktopTaskModeChange}
        />
      ) : null}
    </>
  );
}

function SidebarBody(props: {
  activeConversationId?: string | null;
  desktopTaskMode: DesktopTaskShellMode | null;
  isAuthenticated: boolean;
  onArtifacts: () => void;
  onClose: () => void;
  onConversationSelect?: React.ComponentProps<typeof ConversationList>['onConversationSelect'];
  onDesktopTaskModeChange?: (_mode: DesktopTaskMode) => void;
  onFinance: () => void;
  onNewChat: () => void;
  onOpenPullRequests?: () => void;
  onPlugins: () => void;
  onProjects: () => void;
  onScheduled: () => void;
  searchQuery: string;
  shouldMountConversationList: boolean;
  userKey: React.Key;
}) {
  const desktopTaskShell = props.desktopTaskMode !== null;
  return (
    <>
      {!desktopTaskShell ? (
        <SidebarProductShortcuts
          isAuthenticated={props.isAuthenticated}
          onArtifacts={props.onArtifacts}
          onFinance={props.onFinance}
          onNewChat={props.onNewChat}
          onPlugins={props.onPlugins}
          onProjects={props.onProjects}
          onScheduled={props.onScheduled}
        />
      ) : null}
      {props.desktopTaskMode && props.onDesktopTaskModeChange ? (
        <DesktopTaskSidebarContent
          mode={props.desktopTaskMode}
          searchQuery={props.searchQuery}
          activeConversationId={props.activeConversationId}
          onConversationSelect={props.onConversationSelect}
          onClose={props.onClose}
          onNewTask={props.onNewChat}
          onScheduled={props.onScheduled}
          onPlugins={props.onPlugins}
          onArtifacts={props.onArtifacts}
          onPullRequests={props.desktopTaskMode === 'code' ? props.onOpenPullRequests : undefined}
          onSwitchToChat={() => {
            props.onDesktopTaskModeChange?.('chat');
            props.onNewChat();
          }}
        />
      ) : (
        <div className="sidebar-content flex-1 overflow-y-auto pr-1">
          <div className="sidebar-section-heading mb-2 text-[11px] font-semibold tracking-[0.15em] text-slate-400 uppercase">
            Conversations
          </div>
          {props.shouldMountConversationList ? (
            <ConversationList
              key={props.userKey}
              onConversationClick={props.onClose}
              showSearch={false}
              searchQuery={props.searchQuery}
              activeConversationId={props.activeConversationId}
              {...(props.onConversationSelect
                ? { onConversationSelect: props.onConversationSelect }
                : {})}
            />
          ) : null}
        </div>
      )}
    </>
  );
}

function SidebarFooter(props: {
  desktopUpdateAction: DesktopUpdateAction;
  desktopUpdateMessage?: string | null;
  desktopUpdateVersion?: string | null;
  hasHelpMenu: boolean;
  onCheckForUpdates?: () => void;
  onClose: () => void;
  onOpenChangelog?: () => void;
  onOpenProfile: () => void;
  onOpenReportIssue?: () => void;
  user: React.ComponentProps<typeof SidebarProfileMenu>['user'];
}) {
  const isDesktopUpdateBusy = props.desktopUpdateAction !== 'idle';
  const { label, ariaLabel } = desktopUpdateLabels(
    props.desktopUpdateAction,
    props.desktopUpdateVersion
  );
  return (
    <div className="sidebar-footer border-t border-white/10 pt-3">
      {props.onCheckForUpdates ? (
        <div className="mb-3">
          <button
            type="button"
            className={clsx(
              'inline-flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition',
              props.desktopUpdateVersion
                ? 'border-blue-300/50 bg-blue-400/15 text-blue-100 hover:border-blue-200/70 hover:bg-blue-400/20'
                : 'border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.08]',
              isDesktopUpdateBusy && 'cursor-wait opacity-80'
            )}
            disabled={isDesktopUpdateBusy}
            onClick={props.onCheckForUpdates}
            aria-busy={isDesktopUpdateBusy || undefined}
            aria-label={ariaLabel}
          >
            <RefreshCw
              aria-hidden="true"
              className={clsx(isDesktopUpdateBusy && 'animate-spin')}
              size={16}
              strokeWidth={2}
            />
            <span>{label}</span>
          </button>
          {props.desktopUpdateMessage ? (
            <p className="mt-2 text-xs leading-5 text-slate-300">{props.desktopUpdateMessage}</p>
          ) : null}
        </div>
      ) : null}
      <SidebarProfileMenu
        hasHelpMenu={props.hasHelpMenu}
        onClose={props.onClose}
        onOpenChangelog={props.onOpenChangelog}
        onOpenProfile={props.onOpenProfile}
        onOpenReportIssue={props.onOpenReportIssue}
        user={props.user}
      />
      <button
        type="button"
        className="sidebar-collapse"
        aria-label="Close sidebar"
        onClick={props.onClose}
      >
        ≪
      </button>
    </div>
  );
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  onNewChat,
  onOpenChangelog,
  onOpenReportIssue,
  onCheckForUpdates,
  onAgentManagerClick,
  desktopUpdateVersion,
  desktopUpdateAction = 'idle',
  desktopUpdateMessage,
  onConversationSelect,
  activeConversationId,
  desktopTaskMode,
  onDesktopTaskModeChange,
  desktopRuntime = false,
}) => {
  const router = useRouter();
  const { open: openProfileModal } = useProfileModal();
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

  const handleScheduledClick = () => {
    void router.navigate({ to: '/scheduled' });
    onClose();
  };

  const handleProjectsClick = () => {
    void router.navigate({ to: '/projects' });
    onClose();
  };

  const handleFinanceClick = () => {
    void router.navigate({ to: '/finance' });
    onClose();
  };

  const handlePluginsClick = () => {
    void router.navigate({ to: '/plugins' });
    onClose();
  };

  const desktopTaskShellMode =
    desktopRuntime && (desktopTaskMode === 'code' || desktopTaskMode === 'work')
      ? desktopTaskMode
      : null;

  const hasHelpMenu = Boolean(onOpenReportIssue || onOpenChangelog);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false);
  const shouldMountConversationList = isOpen || isAuthenticated;

  return (
    <>
      <div
        className={clsx(
          'sidebar-overlay fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200',
          desktopRuntime && 'hidden',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
        aria-hidden="true"
      ></div>
      <aside
        className={clsx(
          'sidebar fixed top-0 left-0 z-50 h-full w-72 transform transition-transform duration-200',
          desktopTaskShellMode
            ? 'border-r border-white/10 bg-[#191919] text-slate-100 shadow-none'
            : 'border-r border-blue-500/30 bg-[#060a14]/95 text-slate-100 shadow-[20px_0_70px_rgba(2,6,23,0.55),0_0_32px_rgba(59,130,246,0.16)] backdrop-blur-xl',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div
          className={clsx(
            'sidebar-shell flex h-full flex-col px-4 py-5',
            desktopTaskShellMode ? 'gap-2' : 'gap-4'
          )}
        >
          <SidebarHeader
            desktopRuntime={desktopRuntime}
            desktopSearchOpen={desktopSearchOpen}
            desktopTaskMode={desktopTaskShellMode}
            onDesktopSearchToggle={() => setDesktopSearchOpen((open) => !open)}
            onDesktopTaskModeChange={onDesktopTaskModeChange}
            onLogoClick={handleLogoClick}
            onSearchChange={setSidebarSearch}
            searchQuery={sidebarSearch}
            selectedTaskMode={desktopTaskMode}
          />
          <SidebarBody
            activeConversationId={activeConversationId}
            desktopTaskMode={desktopTaskShellMode}
            isAuthenticated={isAuthenticated}
            onArtifacts={handleArtifactsClick}
            onClose={onClose}
            onConversationSelect={onConversationSelect}
            onDesktopTaskModeChange={onDesktopTaskModeChange}
            onFinance={handleFinanceClick}
            onNewChat={handleNewChat}
            onOpenPullRequests={onAgentManagerClick}
            onPlugins={handlePluginsClick}
            onProjects={handleProjectsClick}
            onScheduled={handleScheduledClick}
            searchQuery={sidebarSearch}
            shouldMountConversationList={shouldMountConversationList}
            userKey={user?.id ?? 'anonymous'}
          />
          <SidebarFooter
            desktopUpdateAction={desktopUpdateAction}
            desktopUpdateMessage={desktopUpdateMessage}
            desktopUpdateVersion={desktopUpdateVersion}
            hasHelpMenu={hasHelpMenu}
            onCheckForUpdates={onCheckForUpdates}
            onClose={onClose}
            onOpenChangelog={onOpenChangelog}
            onOpenProfile={() => openProfileModal({ onOpen: onClose })}
            onOpenReportIssue={onOpenReportIssue}
            user={user}
          />
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
