'use client';

import type { Project } from '@taskforceai/contracts/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taskforceai/ui-kit/dropdown-menu';
import clsx from 'clsx';
import {
  Archive,
  Check,
  Folder,
  FolderOpen,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import {
  createDesktopAppServerProject,
  createDesktopWorktree,
  enableDesktopLocalCoding,
  openDesktopWorkspaceIn,
  pickDesktopWorkspaceFolder,
  setDesktopAppServerProjectWorkspace,
} from '../platform/app-server';
import { useProjects } from '@taskforceai/web/app/lib/projects/ProjectsContext';
import {
  persistDesktopCodeWorkspace,
  persistDesktopCodeWorkspaceRoots,
  persistDesktopProjectWorkspace,
  readDesktopCodeWorkspaceRoots,
  readDesktopProjectWorkspace,
  readDesktopProjectWorkspaceMap,
} from '@taskforceai/web/app/lib/desktop/task-mode';
import { logger } from '@taskforceai/web/app/lib/logger';
import { useConversationStore } from '@taskforceai/web/app/lib/platform/PlatformProvider';
import ConversationList from '@taskforceai/web/app/components/chat/ConversationList';

const ORGANIZE_KEY = 'taskforceai.desktop.projects.organize.v1';
const SORT_KEY = 'taskforceai.desktop.projects.sort.v1';
const PINNED_KEY = 'taskforceai.desktop.projects.pinned.v1';
const MANUAL_ORDER_KEY = 'taskforceai.desktop.projects.manual-order.v1';

type OrganizeMode = 'project' | 'list';
type SortMode = 'priority' | 'updated' | 'manual';

const rowClassName =
  'group flex min-h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[15px] text-slate-200 transition hover:bg-white/[0.07]';

const readString = <T extends string>(key: string, fallback: T, values: readonly T[]): T => {
  if (typeof window === 'undefined') return fallback;
  const value = window.localStorage.getItem(key);
  return values.includes(value as T) ? (value as T) : fallback;
};

const readPinned = (): Set<number> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(PINNED_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter(Number.isSafeInteger) : []);
  } catch {
    return new Set();
  }
};

const readManualOrder = (): number[] => {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(MANUAL_ORDER_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(Number.isSafeInteger) : [];
  } catch {
    return [];
  }
};

const normalizeManualOrder = (order: number[], projects: Project[]): number[] => {
  const currentIds = new Set(projects.map((project) => project.id));
  const existing = order.filter((id) => currentIds.has(id));
  const existingIds = new Set(existing);
  return [
    ...existing,
    ...projects.map((project) => project.id).filter((id) => !existingIds.has(id)),
  ];
};

const basename = (root: string): string =>
  root
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? '';

const findProjectRoot = (project: Project): string | null => {
  const mapped = readDesktopProjectWorkspace(project.id);
  if (mapped) return mapped;
  const inferred = readDesktopCodeWorkspaceRoots().find(
    (root) => basename(root).toLocaleLowerCase() === project.name.trim().toLocaleLowerCase()
  );
  if (!inferred) return null;
  persistDesktopProjectWorkspace(project.id, inferred);
  return inferred;
};

export function DesktopProjectsSidebar(props: {
  mode: 'work' | 'code';
  searchQuery: string;
  activeConversationId?: string | null;
  onConversationSelect?: React.ComponentProps<typeof ConversationList>['onConversationSelect'];
  onClose: () => void;
}) {
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    setModalOpen,
    refreshProjects,
    deleteProject,
    renameProject,
  } = useProjects();
  const [organize, setOrganize] = useState<OrganizeMode>('project');
  const [sort, setSort] = useState<SortMode>('priority');
  const [pinned, setPinned] = useState<Set<number>>(new Set());
  const [manualOrder, setManualOrder] = useState<number[]>([]);
  const [draggedProjectId, setDraggedProjectId] = useState<number | null>(null);
  const [archivingProjectId, setArchivingProjectId] = useState<number | null>(null);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isAddingExistingFolder, setIsAddingExistingFolder] = useState(false);
  const conversationStore = useConversationStore();

  useEffect(() => {
    setOrganize(readString<OrganizeMode>(ORGANIZE_KEY, 'project', ['project', 'list']));
    setSort(readString<SortMode>(SORT_KEY, 'priority', ['priority', 'updated', 'manual']));
    setPinned(readPinned());
    setManualOrder(readManualOrder());
  }, []);

  useEffect(() => {
    setManualOrder((current) => normalizeManualOrder(current, projects));
  }, [projects]);

  useEffect(() => {
    if (props.mode !== 'code') return;
    const projectIds = new Set(projects.map((project) => project.id));
    const workspaces = Object.entries(readDesktopProjectWorkspaceMap()).filter(([projectId]) =>
      projectIds.has(Number(projectId))
    );
    void Promise.all(
      workspaces.map(([projectId, workspace]) =>
        setDesktopAppServerProjectWorkspace({
          projectId: Number(projectId),
          workspaceRoots: [workspace],
        })
      )
    ).catch((error) => logger.error('Failed to sync Code project workspaces', { error }));
  }, [projects, props.mode]);

  const orderedProjects = useMemo(() => {
    if (sort === 'manual') {
      const order = normalizeManualOrder(manualOrder, projects);
      const rank = new Map(order.map((id, index) => [id, index]));
      return projects.toSorted(
        (left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0)
      );
    }
    return projects.toSorted((left, right) => {
      if (sort === 'priority') {
        const pinDifference = Number(pinned.has(right.id)) - Number(pinned.has(left.id));
        if (pinDifference) return pinDifference;
      }
      const rightUpdatedAt = Date.parse(right.updated_at ?? right.created_at);
      const leftUpdatedAt = Date.parse(left.updated_at ?? left.created_at);
      return rightUpdatedAt - leftUpdatedAt;
    });
  }, [manualOrder, pinned, projects, sort]);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

  const setOrganizeMode = (value: string) => {
    const next = value as OrganizeMode;
    setOrganize(next);
    window.localStorage.setItem(ORGANIZE_KEY, next);
    if (next === 'list') setActiveProjectId(null);
  };

  const setSortMode = (value: string) => {
    const next = value as SortMode;
    setSort(next);
    window.localStorage.setItem(SORT_KEY, next);
    if (next === 'manual') {
      const normalized = normalizeManualOrder(manualOrder, projects);
      setManualOrder(normalized);
      window.localStorage.setItem(MANUAL_ORDER_KEY, JSON.stringify(normalized));
    }
  };

  const moveProject = (projectId: number, beforeProjectId: number) => {
    if (projectId === beforeProjectId) return;
    setManualOrder((current) => {
      const next = normalizeManualOrder(current, projects).filter((id) => id !== projectId);
      const targetIndex = next.indexOf(beforeProjectId);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, projectId);
      window.localStorage.setItem(MANUAL_ORDER_KEY, JSON.stringify(next));
      return next;
    });
  };

  const archiveProjectTasks = async (project: Project) => {
    if (!conversationStore.archiveConversation) return;
    setActionError(null);
    setArchivingProjectId(project.id);
    try {
      const conversations = await conversationStore.listConversations(Number.MAX_SAFE_INTEGER, 0);
      const projectConversations = conversations.filter(
        (conversation) => conversation.projectId === project.id
      );
      await Promise.all(
        projectConversations.map((conversation) =>
          conversationStore.archiveConversation!(conversation.conversationId)
        )
      );
    } catch (error) {
      logger.error('Failed to archive project tasks', { error, projectId: project.id });
      setActionError('The tasks in this project could not be archived.');
    } finally {
      setArchivingProjectId(null);
    }
  };

  const activateProject = async (project: Project) => {
    setActionError(null);
    if (props.mode !== 'code') {
      setActiveProjectId(project.id);
      return;
    }
    const root = findProjectRoot(project);
    if (!root) {
      setActionError('Add a local workspace before opening this Code project.');
      return;
    }
    try {
      await setDesktopAppServerProjectWorkspace({
        projectId: project.id,
        workspaceRoots: [root],
      });
      await enableDesktopLocalCoding({ workspace: root });
      persistDesktopCodeWorkspace(root);
      setActiveProjectId(project.id);
    } catch (error) {
      logger.error('Failed to activate Code project workspace', { error, projectId: project.id });
      setActionError('The local workspace for this project could not be activated.');
    }
  };

  const togglePinned = (projectId: number) => {
    setPinned((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      window.localStorage.setItem(PINNED_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const commitRename = async (project: Project) => {
    const name = renameValue.trim();
    if (!name || name === project.name) {
      setRenameId(null);
      return;
    }
    if (!(await renameProject(project.id, name))) {
      setActionError('The project could not be renamed.');
      return;
    }
    setRenameId(null);
  };

  const projectRoot = (project: Project) =>
    props.mode === 'code' ? findProjectRoot(project) : null;

  const addExistingFolder = async () => {
    setActionError(null);
    setIsAddingExistingFolder(true);
    try {
      const root = await pickDesktopWorkspaceFolder();
      if (!root) return;
      const name = basename(root).trim();
      if (!name) {
        setActionError('The selected folder does not have a usable project name.');
        return;
      }

      const existing = projects.find(
        (project) => project.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
      );
      const projectId = existing
        ? existing.id
        : (
            await createDesktopAppServerProject({
              name,
              workspaceRoots: [root],
            })
          ).project.id;

      persistDesktopProjectWorkspace(projectId, root);
      await setDesktopAppServerProjectWorkspace({
        projectId,
        workspaceRoots: [root],
      });
      persistDesktopCodeWorkspaceRoots([...readDesktopCodeWorkspaceRoots(), root]);
      persistDesktopCodeWorkspace(root);
      await enableDesktopLocalCoding({ workspace: root });
      setActiveProjectId(projectId);
      if (!existing) await refreshProjects();
    } catch (error) {
      logger.error('Failed to add an existing project folder', { error });
      setActionError('The selected folder could not be added as a project.');
    } finally {
      setIsAddingExistingFolder(false);
    }
  };

  return (
    <>
      <section className="mt-7" aria-label="Projects">
        <div className="mb-2 flex items-center justify-between px-2.5 text-sm font-medium text-slate-500">
          <span>Projects</span>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Organize projects"
                  className="rounded-md p-1 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
                >
                  <MoreHorizontal aria-hidden="true" size={17} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-52 border-white/15 bg-[#272727] text-slate-100"
              >
                <DropdownMenuLabel className="font-normal text-slate-400">
                  Organize
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={organize} onValueChange={setOrganizeMode}>
                  <DropdownMenuRadioItem value="project">By project</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="list">In one list</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuLabel className="font-normal text-slate-400">
                  Sort by
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sort} onValueChange={setSortMode}>
                  <DropdownMenuRadioItem value="priority">Priority</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="updated">Last updated</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="manual">Manual order</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {props.mode === 'code' ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="New project"
                    className="rounded-md p-1 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
                  >
                    <Plus aria-hidden="true" size={17} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-64 border-white/15 bg-[#272727] text-slate-100"
                >
                  <DropdownMenuItem onSelect={() => setModalOpen(true)}>
                    <Plus />
                    Start from scratch
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isAddingExistingFolder}
                    onSelect={() => void addExistingFolder()}
                  >
                    <FolderOpen />
                    {isAddingExistingFolder ? 'Opening folder…' : 'Use an existing folder'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                type="button"
                aria-label="New project"
                className="rounded-md p-1 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
                onClick={() => setModalOpen(true)}
              >
                <Plus aria-hidden="true" size={17} />
              </button>
            )}
          </div>
        </div>

        {organize === 'project' ? (
          <div className="space-y-0.5">
            {orderedProjects.map((project) => {
              const root = projectRoot(project);
              const isPinned = pinned.has(project.id);
              return (
                <div
                  key={project.id}
                  className="group relative"
                  draggable={sort === 'manual'}
                  onDragStart={() => setDraggedProjectId(project.id)}
                  onDragEnd={() => setDraggedProjectId(null)}
                  onDragOver={(event) => {
                    if (sort === 'manual') event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedProjectId !== null) moveProject(draggedProjectId, project.id);
                    setDraggedProjectId(null);
                  }}
                >
                  {renameId === project.id ? (
                    <form
                      className="px-2.5 py-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void commitRename(project);
                      }}
                    >
                      <input
                        autoFocus
                        aria-label={`Rename ${project.name}`}
                        value={renameValue}
                        maxLength={100}
                        onChange={(event) => setRenameValue(event.currentTarget.value)}
                        onBlur={() => void commitRename(project)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setRenameId(null);
                        }}
                        className="w-full rounded-md border border-white/20 bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-white/40"
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      className={clsx(
                        rowClassName,
                        activeProjectId === project.id && 'bg-white/[0.09] text-white'
                      )}
                      onClick={() => void activateProject(project)}
                    >
                      {sort === 'manual' ? (
                        <GripVertical aria-label="Drag to reorder" size={14} />
                      ) : null}
                      <Folder aria-hidden="true" size={17} />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      {isPinned ? <Pin aria-label="Pinned" size={13} /> : null}
                    </button>
                  )}
                  {renameId !== project.id ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${project.name} project actions`}
                          className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-white focus:opacity-100"
                        >
                          <MoreHorizontal aria-hidden="true" size={16} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-64 border-white/15 bg-[#272727] text-slate-100"
                      >
                        <DropdownMenuItem onSelect={() => togglePinned(project.id)}>
                          {isPinned ? <PinOff /> : <Pin />}
                          {isPinned ? 'Unpin project' : 'Pin project'}
                        </DropdownMenuItem>
                        {props.mode === 'code' ? (
                          <>
                            <DropdownMenuItem
                              disabled={!root}
                              onSelect={() => {
                                if (root) void openDesktopWorkspaceIn({ root, target: 'finder' });
                              }}
                            >
                              <FolderOpen />
                              Reveal in Finder
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!root}
                              onSelect={() => {
                                if (!root) return;
                                void createDesktopWorktree({
                                  repository: root,
                                  branch: null,
                                  baseRef: null,
                                  path: null,
                                })
                                  .then((result) =>
                                    enableDesktopLocalCoding({ workspace: result.worktree.path })
                                  )
                                  .catch((error) => {
                                    logger.error('Failed to create project worktree', {
                                      error,
                                      projectId: project.id,
                                    });
                                    setActionError('A permanent worktree could not be created.');
                                  });
                              }}
                            >
                              <Workflow />
                              Create permanent worktree
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenameValue(project.name);
                            setRenameId(project.id);
                          }}
                        >
                          <Pencil />
                          Rename project
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={
                            !conversationStore.archiveConversation ||
                            archivingProjectId === project.id
                          }
                          onSelect={() => void archiveProjectTasks(project)}
                        >
                          <Archive />
                          {archivingProjectId === project.id ? 'Archiving tasks…' : 'Archive tasks'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-white/10" />
                        <DropdownMenuItem
                          className="text-red-300 focus:bg-red-500/15 focus:text-red-200"
                          onSelect={() => void deleteProject(project.id)}
                        >
                          <Trash2 />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              );
            })}
            {props.mode === 'work' ? (
              <button
                type="button"
                aria-label="Don't work in a project"
                className={clsx(
                  rowClassName,
                  activeProjectId === null && 'bg-white/[0.09] text-white'
                )}
                onClick={() => setActiveProjectId(null)}
              >
                <span className="text-lg leading-none">×</span>
                Don&apos;t work in a project
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className={clsx(rowClassName, activeProjectId === null && 'bg-white/[0.09] text-white')}
            onClick={() => setActiveProjectId(null)}
          >
            <Check aria-hidden="true" size={17} />
            All project tasks
          </button>
        )}
        {actionError ? (
          <button
            type="button"
            className="mt-2 px-2.5 text-left text-xs leading-5 text-red-300"
            onClick={() => setActionError(null)}
          >
            {actionError}
          </button>
        ) : null}
      </section>

      <section className="mt-5 min-h-0 flex-1 overflow-y-auto" aria-label="Tasks">
        <div className="mb-2 flex items-center gap-1 px-2.5 text-sm font-medium text-slate-500">
          <span>{organize === 'list' ? 'Tasks' : (activeProject?.name ?? 'Tasks')}</span>
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
