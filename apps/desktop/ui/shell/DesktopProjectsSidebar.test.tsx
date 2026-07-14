import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@taskforceai/contracts/contracts';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const setActiveProjectId = mock();
const setDesktopAppServerProjectWorkspace = mock(async () => undefined);
const enableDesktopLocalCoding = mock(async () => ({ enabled: true }));
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
    deleteProject: mock(async () => true),
    renameProject: mock(async () => true),
  }),
}));

mock.module('@taskforceai/web/app/lib/platform/PlatformProvider', () => ({
  useConversationStore: () => ({
    listConversations: mock(async () => []),
    archiveConversation: mock(async () => undefined),
  }),
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
  createDesktopAppServerProject: mock(),
  createDesktopWorktree: mock(),
  enableDesktopLocalCoding,
  openDesktopWorkspaceIn: mock(),
  pickDesktopWorkspaceFolder: mock(),
  setDesktopAppServerProjectWorkspace,
}));

import { DesktopProjectsSidebar } from './DesktopProjectsSidebar';

describe('DesktopProjectsSidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActiveProjectId.mockClear();
    setDesktopAppServerProjectWorkspace.mockClear();
    setDesktopAppServerProjectWorkspace.mockResolvedValue(undefined);
    enableDesktopLocalCoding.mockClear();
    enableDesktopLocalCoding.mockResolvedValue({ enabled: true });
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
  });
});
