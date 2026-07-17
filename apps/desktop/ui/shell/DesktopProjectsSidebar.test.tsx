import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@taskforceai/contracts/contracts';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ReactNode } from 'react';

import '../../../../tests/setup/dom';

const setActiveProjectId = mock();
const setDesktopAppServerProjectWorkspace = mock(async () => undefined);
const enableDesktopLocalCoding = mock(async () => ({ enabled: true }));
const createDesktopAppServerProject = mock(async () => ({
  project: {
    id: 3,
    name: 'gamma',
    createdAt: '2026-07-14T06:00:00Z',
    updatedAt: '2026-07-14T06:00:00Z',
  },
}));
const pickDesktopWorkspaceFolder = mock(async () => '/workspace/gamma');
const upsertProject = mock();
const listConversations = mock(async () => [
  { conversationId: 'alpha-task', projectId: 1 },
  { conversationId: 'beta-task', projectId: 2 },
]);
const archiveConversation = mock(async () => undefined);
const openDesktopWorkspaceIn = mock(async () => undefined);
const readDesktopProjectWorkspace = mock((projectId: number) =>
  projectId === 2 ? '/workspace/beta' : null
);

const projects = [
  { id: 1, name: 'Alpha', created_at: '2026-01-01T00:00:00Z' },
  { id: 2, name: 'Beta', created_at: '2026-01-02T00:00:00Z' },
] as Project[];

mock.module('@taskforceai/web/app/lib/projects/ProjectsContext', () => ({
  useProjects: () => ({
    projects,
    activeProjectId: 1,
    setActiveProjectId,
    setModalOpen: mock(),
    refreshProjects: mock(async () => undefined),
    upsertProject,
    deleteProject: mock(async () => true),
    renameProject: mock(async () => true),
  }),
}));

mock.module('@taskforceai/web/app/lib/platform/PlatformProvider', () => ({
  useConversationStore: () => ({
    listConversations,
    archiveConversation,
  }),
}));

mock.module('@taskforceai/ui-kit/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuRadioGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuRadioItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
}));

mock.module('@taskforceai/web/app/components/chat/ConversationList', () => ({
  default: () => null,
}));

mock.module('@taskforceai/web/app/lib/desktop/task-mode', () => ({
  persistDesktopCodeWorkspace: mock(),
  persistDesktopCodeWorkspaceRoots: mock(),
  persistDesktopProjectWorkspace: mock(),
  readDesktopCodeWorkspaceRoots: mock(() => []),
  readDesktopProjectWorkspace,
  readDesktopProjectWorkspaceMap: mock(() => ({ 2: '/workspace/beta' })),
}));

mock.module('../platform/app-server', () => ({
  createDesktopAppServerProject,
  createDesktopWorktree: mock(),
  enableDesktopLocalCoding,
  openDesktopWorkspaceIn,
  pickDesktopWorkspaceFolder,
  setDesktopAppServerProjectWorkspace,
}));

import { DesktopProjectsSidebar } from './DesktopProjectsSidebar';

describe('DesktopProjectsSidebar', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setActiveProjectId.mockClear();
    setDesktopAppServerProjectWorkspace.mockClear();
    setDesktopAppServerProjectWorkspace.mockResolvedValue(undefined);
    enableDesktopLocalCoding.mockClear();
    enableDesktopLocalCoding.mockResolvedValue({ enabled: true });
    createDesktopAppServerProject.mockClear();
    pickDesktopWorkspaceFolder.mockClear();
    upsertProject.mockClear();
    listConversations.mockClear();
    archiveConversation.mockClear();
    openDesktopWorkspaceIn.mockClear();
  });

  it('keeps the current project selected until Code workspace activation succeeds', async () => {
    enableDesktopLocalCoding.mockRejectedValueOnce(new Error('activation failed'));
    render(<DesktopProjectsSidebar mode="code" searchQuery="" onClose={mock()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(
      await screen.findByText('The local workspace for this project could not be activated.')
    ).toBeTruthy();
    expect(setActiveProjectId).not.toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    await waitFor(() => expect(setActiveProjectId).toHaveBeenCalledWith(2));
    expect(setDesktopAppServerProjectWorkspace).toHaveBeenLastCalledWith({
      projectId: 2,
      workspaceRoots: ['/workspace/beta'],
    });
    expect(enableDesktopLocalCoding).toHaveBeenLastCalledWith({ workspace: '/workspace/beta' });

    const revealInFinder = screen
      .getAllByRole('button', { name: 'Reveal in Finder' })
      .find((button) => !button.hasAttribute('disabled'))!;
    fireEvent.click(revealInFinder);
    expect(openDesktopWorkspaceIn).toHaveBeenCalledWith({
      root: '/workspace/beta',
      target: 'finder',
    });

    fireEvent.click(screen.getAllByText('Archive tasks')[0]!);
    await waitFor(() => expect(archiveConversation).toHaveBeenCalledWith('beta-task'));
  });

  it('creates a project when adding a folder whose name is not already present', async () => {
    render(<DesktopProjectsSidebar mode="code" searchQuery="" onClose={mock()} />);

    fireEvent.click(screen.getByText('Use an existing folder'));

    await waitFor(() =>
      expect(createDesktopAppServerProject).toHaveBeenCalledWith({
        name: 'gamma',
        workspaceRoots: ['/workspace/gamma'],
      })
    );
    expect(setActiveProjectId).toHaveBeenCalledWith(3);
    expect(upsertProject).toHaveBeenCalledWith({
      id: 3,
      name: 'gamma',
      description: null,
      custom_instructions: null,
      created_at: '2026-07-14T06:00:00Z',
      updated_at: '2026-07-14T06:00:00Z',
    });
  });
});
