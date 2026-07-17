import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';
import path from 'path';
import '../../../../../tests/setup/dom';

const appPath = (p: string) => path.resolve(process.cwd(), 'apps/web/app', p);
const desktopPath = (p: string) => path.resolve(process.cwd(), 'apps/desktop/ui', p);

// Local mock spies
const mockNavigate = vi.fn();
const mockRouterImpl = {
  useNavigate: () => mockNavigate,
  useRouter: () => ({ navigate: mockNavigate }),
  navigate: mockNavigate,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
};

vi.mock(appPath('components/routing'), () => mockRouterImpl);

const mockOpenProfileModal = vi.fn();
const mockSetActiveProjectId = vi.fn();
const mockSetProjectModalOpen = vi.fn();
const mockRenameProject = vi.fn(async () => true);
const mockDeleteProject = vi.fn(async () => true);
const mockCreateProject = vi.fn();
const mockRefreshProjects = vi.fn(async () => undefined);
const mockUpsertProject = vi.fn();
const mockCreateDesktopAppServerProject = vi.fn();
const mockSetDesktopAppServerProjectWorkspace = vi.fn(async () => ({
  projectId: 1,
  workspaceRoots: ['/tmp/project'],
}));
const mockEnableDesktopLocalCoding = vi.fn(async () => ({
  enabled: true,
  workspace: '/tmp/project',
}));
const mockOpenDesktopWorkspaceIn = vi.fn(async () => undefined);
const mockPickDesktopWorkspaceFolder = vi.fn();
const mockCreateDesktopWorktree = vi.fn();
const mockArchiveConversation = vi.fn(async () => undefined);
let mockArchiveConversationAvailable = true;
const mockListConversations = vi.fn(
  async (): Promise<Array<{ conversationId: string; projectId: number | null }>> => []
);
let mockProjects: Array<{
  id: number;
  name: string;
  created_at?: string;
  updated_at?: string;
}> = [];
let mockActiveProjectId: number | null = null;
const mockConversationList = vi.fn((props: any) => (
  <div
    data-active-conversation-id={props.activeConversationId ?? ''}
    data-search-query={props.searchQuery}
    data-testid="conversation-list"
  />
));

// Mock AuthProvider
vi.mock(appPath('lib/providers/AuthProvider'), () => ({
  useAuth: vi.fn(),
}));

// Mock ProfileModalContext
vi.mock(appPath('lib/profile/modal/ProfileModalContext'), () => ({
  useProfileModal: () => ({ open: mockOpenProfileModal }),
}));

// Mock ProjectsContext
vi.mock(appPath('lib/projects/ProjectsContext'), () => ({
  useProjects: vi.fn(() => ({
    projects: mockProjects,
    activeProjectId: mockActiveProjectId,
    setActiveProjectId: mockSetActiveProjectId,
    isLoading: false,
    isModalOpen: false,
    setModalOpen: mockSetProjectModalOpen,
    refreshProjects: mockRefreshProjects,
    upsertProject: mockUpsertProject,
    createProject: mockCreateProject,
    deleteProject: mockDeleteProject,
    renameProject: mockRenameProject,
  })),
}));

vi.mock('../../lib/platform/desktop-api', () => ({
  createDesktopAppServerProject: mockCreateDesktopAppServerProject,
  createDesktopWorktree: mockCreateDesktopWorktree,
  enableDesktopLocalCoding: mockEnableDesktopLocalCoding,
  openDesktopWorkspaceIn: mockOpenDesktopWorkspaceIn,
  pickDesktopWorkspaceFolder: mockPickDesktopWorkspaceFolder,
  setDesktopAppServerProjectWorkspace: mockSetDesktopAppServerProjectWorkspace,
}));

vi.mock(desktopPath('platform/app-server'), () => ({
  createDesktopAppServerProject: mockCreateDesktopAppServerProject,
  createDesktopWorktree: mockCreateDesktopWorktree,
  enableDesktopLocalCoding: mockEnableDesktopLocalCoding,
  openDesktopWorkspaceIn: mockOpenDesktopWorkspaceIn,
  pickDesktopWorkspaceFolder: mockPickDesktopWorkspaceFolder,
  setDesktopAppServerProjectWorkspace: mockSetDesktopAppServerProjectWorkspace,
}));

vi.mock('../../lib/platform/desktop-ui', () => ({
  DesktopProjectsSidebar: (props: Record<string, unknown>) => {
    const { DesktopProjectsSidebar } = require(desktopPath('shell/DesktopProjectsSidebar')) as {
      DesktopProjectsSidebar: React.ComponentType<Record<string, unknown>>;
    };
    return <DesktopProjectsSidebar {...props} />;
  },
}));

vi.mock(appPath('lib/platform/PlatformProvider'), () => ({
  useConversationStore: () => ({
    archiveConversation: mockArchiveConversationAvailable ? mockArchiveConversation : undefined,
    listConversations: mockListConversations,
  }),
}));

// Mock ConversationList
vi.mock(appPath('components/chat/ConversationList'), () => ({
  __esModule: true,
  default: (props: any) => mockConversationList(props),
}));

// Mock UI Kit Components
vi.mock('@taskforceai/ui-kit/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div data-testid="dropdown-content">{children}</div>,
  DropdownMenuItem: ({ onSelect, children, disabled }: any) => (
    <button
      disabled={disabled}
      onClick={(_e) => {
        if (onSelect) onSelect({ preventDefault: () => {} } as any);
      }}
    >
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuRadioGroup: ({ children, onValueChange }: any) => (
    <div>
      {React.Children.map(children, (child: any) =>
        React.cloneElement(child, {
          onSelect: () => onValueChange?.(child.props.value),
        })
      )}
    </div>
  ),
  DropdownMenuRadioItem: ({ onSelect, children, value }: any) => (
    <button data-value={value} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuSub: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: any) => <button>{children}</button>,
  DropdownMenuSubContent: ({ children }: any) => <div>{children}</div>,
}));

import { useAuth } from '../../lib/providers/AuthProvider';
import Sidebar from './Sidebar';

describe('Sidebar', () => {
  const navigate = mockNavigate;
  const onClose = vi.fn();
  const onNewChat = vi.fn();

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockProjects = [];
    mockActiveProjectId = null;
    mockArchiveConversationAvailable = true;
    mockRenameProject.mockReset();
    mockRenameProject.mockResolvedValue(true);
    mockDeleteProject.mockReset();
    mockDeleteProject.mockResolvedValue(true);
    mockRefreshProjects.mockReset();
    mockRefreshProjects.mockResolvedValue(undefined);
    mockUpsertProject.mockReset();
    mockEnableDesktopLocalCoding.mockReset();
    mockEnableDesktopLocalCoding.mockResolvedValue({
      enabled: true,
      workspace: '/tmp/project',
    });
    mockPickDesktopWorkspaceFolder.mockReset();
    mockPickDesktopWorkspaceFolder.mockResolvedValue(null);
    mockCreateDesktopAppServerProject.mockReset();
    mockSetDesktopAppServerProjectWorkspace.mockReset();
    mockSetDesktopAppServerProjectWorkspace.mockResolvedValue({
      projectId: 1,
      workspaceRoots: ['/tmp/project'],
    });
    mockCreateDesktopWorktree.mockReset();
    mockArchiveConversation.mockReset();
    mockArchiveConversation.mockResolvedValue(undefined);
    mockListConversations.mockReset();
    mockListConversations.mockResolvedValue([]);
    window.localStorage.clear();
    (useAuth as any).mockReturnValue({
      isAuthenticated: true,
      user: { email: 'testuser@example.com' },
    });
  });

  it('opens profile modal when upgrade plan is clicked', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByText('Settings'));
    expect(mockOpenProfileModal).toHaveBeenCalledWith({ onOpen: onClose });
    mockOpenProfileModal.mockClear();

    fireEvent.click(screen.getByText('Upgrade plan'));
    expect(mockOpenProfileModal).toHaveBeenCalledWith({ onOpen: onClose });
  });

  it('starts a new chat and closes the sidebar', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }));

    expect(onNewChat).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('opens artifacts and closes the sidebar', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open artifacts' }));

    expect(navigate).toHaveBeenCalledWith({ to: '/artifacts' });
    expect(onClose).toHaveBeenCalled();
  });

  it('opens scheduled tasks and closes the sidebar', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open scheduled tasks' }));

    expect(navigate).toHaveBeenCalledWith({ to: '/scheduled' });
    expect(onClose).toHaveBeenCalled();
  });

  it('opens plugins and closes the sidebar', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open plugins' }));

    expect(navigate).toHaveBeenCalledWith({ to: '/plugins' });
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates home and closes when logo clicked', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);
    fireEvent.click(screen.getByLabelText('Go home'));
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay clicked', () => {
    const { container } = render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);
    const overlay = container.querySelector('.sidebar-overlay');
    if (overlay) fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onOpenReportIssue when clicked', () => {
    const onOpenReportIssue = vi.fn();
    render(
      <Sidebar
        isOpen={true}
        onClose={onClose}
        onNewChat={onNewChat}
        onOpenReportIssue={onOpenReportIssue}
      />
    );

    const reportBtn = screen.getByText('Report issue');
    fireEvent.click(reportBtn);
    expect(onOpenReportIssue).toHaveBeenCalled();
  });

  it('does not render profile menu when user is null', () => {
    (useAuth as any).mockReturnValue({ isAuthenticated: false, user: null });
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    expect(screen.queryByLabelText('Open profile menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open scheduled tasks' })).toBeNull();
  });

  it('renders with onOpenChangelog callback', () => {
    const onOpenChangelog = vi.fn();
    render(
      <Sidebar
        isOpen={true}
        onClose={onClose}
        onNewChat={onNewChat}
        onOpenChangelog={onOpenChangelog}
      />
    );

    expect(screen.getByText('Changelog')).toBeTruthy();
    fireEvent.click(screen.getByText('Changelog'));
    expect(onOpenChangelog).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders with both help menu callbacks', () => {
    const onOpenReportIssue = vi.fn();
    const onOpenChangelog = vi.fn();
    render(
      <Sidebar
        isOpen={true}
        onClose={onClose}
        onNewChat={onNewChat}
        onOpenReportIssue={onOpenReportIssue}
        onOpenChangelog={onOpenChangelog}
      />
    );

    expect(screen.getByText('Report issue')).toBeTruthy();
    expect(screen.getByText('Changelog')).toBeTruthy();
  });

  it('shows desktop update action when provided', () => {
    const onCheckForUpdates = vi.fn();
    render(
      <Sidebar
        isOpen={true}
        onClose={onClose}
        onNewChat={onNewChat}
        onCheckForUpdates={onCheckForUpdates}
        desktopUpdateVersion="0.4.9"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Install TaskForceAI 0.4.9' }));
    expect(onCheckForUpdates).toHaveBeenCalled();
  });

  it('renders with onConversationSelect callback', () => {
    const onConversationSelect = vi.fn();
    render(
      <Sidebar
        isOpen={true}
        onClose={onClose}
        onNewChat={onNewChat}
        onConversationSelect={onConversationSelect}
      />
    );

    expect(screen.getByTestId('conversation-list')).toBeTruthy();
    expect(mockConversationList).toHaveBeenCalledWith(
      expect.objectContaining({ onConversationSelect })
    );
  });

  it('passes active conversation id to the conversation list', () => {
    render(
      <Sidebar
        isOpen={true}
        onClose={onClose}
        onNewChat={onNewChat}
        activeConversationId="local-active"
      />
    );

    expect(
      screen.getByTestId('conversation-list').getAttribute('data-active-conversation-id')
    ).toBe('local-active');
    expect(mockConversationList).toHaveBeenCalledWith(
      expect.objectContaining({ activeConversationId: 'local-active' })
    );
  });

  it('navigates to projects from a single sidebar row', () => {
    mockProjects = [
      { id: 1, name: 'Launch' },
      { id: 2, name: 'Research' },
    ];
    mockActiveProjectId = 1;

    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    expect(screen.queryByText('General')).toBeNull();
    expect(screen.queryByText('Research')).toBeNull();
    expect(screen.queryByText('Manage projects')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open projects' }));

    expect(mockSetActiveProjectId).not.toHaveBeenCalled();
    expect(mockSetProjectModalOpen).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '/projects' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates to finance from the sidebar', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open finance' }));

    expect(navigate).toHaveBeenCalledWith({ to: '/finance' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not expose the account email when a display name is unavailable', () => {
    (useAuth as any).mockReturnValue({
      isAuthenticated: true,
      user: { email: 'testuser@example.com', full_name: 'testuser@example.com' },
    });

    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    expect(screen.getByText('TF')).toBeTruthy();
    expect(screen.getAllByText('Account')).toHaveLength(2);
    expect(screen.queryByText('testuser')).toBeNull();
    expect(screen.queryByText('testuser@example.com')).toBeNull();
  });

  it('uses full name for profile display and avatar when present', () => {
    (useAuth as any).mockReturnValue({
      isAuthenticated: true,
      user: { email: 'ada@example.com', full_name: 'Ada Lovelace' },
    });

    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    expect(screen.getByText('AL')).toBeTruthy();
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(2);
  });

  it('calls onClose when close button is clicked', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByLabelText('Close sidebar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the close control in the desktop task header', () => {
    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="code"
        onDesktopTaskModeChange={vi.fn()}
      />
    );

    const closeButton = screen.getByRole('button', { name: 'Close sidebar' });
    expect(closeButton.closest('.sidebar-logo-bar')).toBeTruthy();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies closed styles when isOpen is false', () => {
    const { container } = render(
      <Sidebar isOpen={false} onClose={onClose} onNewChat={onNewChat} />
    );

    const sidebar = container.querySelector('.sidebar');
    expect(sidebar?.className).toContain('-translate-x-full');
    expect(screen.getByTestId('conversation-list')).toBeTruthy();
    expect(mockConversationList).toHaveBeenCalled();
  });

  it('defers the closed conversation list for anonymous users', () => {
    (useAuth as any).mockReturnValue({ isAuthenticated: false, user: null });

    render(<Sidebar isOpen={false} onClose={onClose} onNewChat={onNewChat} />);

    expect(screen.queryByTestId('conversation-list')).toBeNull();
    expect(mockConversationList).not.toHaveBeenCalled();
  });

  it('shows Code-only repository navigation and optional projects in the desktop task shell', () => {
    mockProjects = [{ id: 1, name: 'taskforceai', created_at: '2026-07-13T12:00:00Z' }];
    mockActiveProjectId = 1;
    const onAgentManagerClick = vi.fn();

    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="code"
        onDesktopTaskModeChange={vi.fn()}
        onAgentManagerClick={onAgentManagerClick}
      />
    );

    expect(screen.getByRole('button', { name: 'Code mode selector' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pull requests' }));
    expect(onAgentManagerClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: "Don't work in a project" })).toBeNull();
  });

  it('offers Code project organization and workspace actions', async () => {
    mockProjects = [{ id: 1, name: 'taskforceai', created_at: '2026-07-13T12:00:00Z' }];
    mockActiveProjectId = 1;
    window.localStorage.setItem(
      'taskforceai.desktop.code-workspace-roots.v2',
      JSON.stringify(['/Users/test/Developer/taskforceai'])
    );

    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="code"
        onDesktopTaskModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('By project')).toBeTruthy();
    expect(screen.getByText('In one list')).toBeTruthy();
    expect(screen.getByText('Priority')).toBeTruthy();
    expect(screen.getByText('Last updated')).toBeTruthy();
    expect(screen.getByText('Manual order')).toBeTruthy();

    expect(screen.getByText('Start from scratch')).toBeTruthy();
    expect(screen.getByText('Use an existing folder')).toBeTruthy();
    fireEvent.click(screen.getByText('Start from scratch'));
    expect(mockSetProjectModalOpen).toHaveBeenCalledWith(true);

    mockPickDesktopWorkspaceFolder.mockResolvedValue('/Users/test/Developer/existing-project');
    mockCreateDesktopAppServerProject.mockResolvedValue({
      project: {
        id: 2,
        name: 'existing-project',
        createdAt: '2026-07-13T12:00:00Z',
      },
    });
    fireEvent.click(screen.getByText('Use an existing folder'));
    await waitFor(() => {
      expect(mockCreateDesktopAppServerProject).toHaveBeenCalledWith({
        name: 'existing-project',
        workspaceRoots: ['/Users/test/Developer/existing-project'],
      });
      expect(mockEnableDesktopLocalCoding).toHaveBeenCalledWith({
        workspace: '/Users/test/Developer/existing-project',
      });
      expect(mockSetActiveProjectId).toHaveBeenCalledWith(2);
      expect(mockUpsertProject).toHaveBeenCalledWith({
        id: 2,
        name: 'existing-project',
        description: null,
        custom_instructions: null,
        created_at: '2026-07-13T12:00:00Z',
        updated_at: '2026-07-13T12:00:00Z',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'taskforceai' }));
    await waitFor(() => {
      expect(mockSetActiveProjectId).toHaveBeenCalledWith(1);
      expect(mockEnableDesktopLocalCoding).toHaveBeenCalledWith({
        workspace: '/Users/test/Developer/taskforceai',
      });
    });

    fireEvent.click(screen.getByText('Reveal in Finder'));
    expect(mockOpenDesktopWorkspaceIn).toHaveBeenCalledWith({
      root: '/Users/test/Developer/taskforceai',
      target: 'finder',
    });

    fireEvent.click(screen.getByText('Rename project'));
    const renameInput = screen.getByRole('textbox', { name: 'Rename taskforceai' });
    expect((renameInput as HTMLInputElement).value).toBe('taskforceai');
    fireEvent.keyDown(renameInput, { key: 'Escape' });

    mockListConversations.mockResolvedValue([
      { conversationId: 'project-task', projectId: 1 },
      { conversationId: 'other-task', projectId: 2 },
    ]);
    fireEvent.click(screen.getByText('Archive tasks'));
    await waitFor(() => {
      expect(mockArchiveConversation).toHaveBeenCalledWith('project-task');
    });
    expect(mockArchiveConversation).not.toHaveBeenCalledWith('other-task');

    fireEvent.click(screen.getByText('Remove'));
    expect(mockDeleteProject).toHaveBeenCalledWith(1);
  });

  it('sorts projects by their real update time and restores manual order', async () => {
    mockProjects = [
      {
        id: 1,
        name: 'older-update',
        created_at: '2026-07-13T13:00:00Z',
        updated_at: '2026-07-13T14:00:00Z',
      },
      {
        id: 2,
        name: 'newer-update',
        created_at: '2026-07-13T12:00:00Z',
        updated_at: '2026-07-13T15:00:00Z',
      },
    ];
    window.localStorage.setItem('taskforceai.desktop.projects.sort.v1', 'updated');

    const view = render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="code"
        onDesktopTaskModeChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText('newer-update').compareDocumentPosition(screen.getByText('older-update')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    view.unmount();
    window.localStorage.setItem('taskforceai.desktop.projects.sort.v1', 'manual');
    window.localStorage.setItem('taskforceai.desktop.projects.manual-order.v1', '[1,2]');
    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="code"
        onDesktopTaskModeChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText('older-update').compareDocumentPosition(screen.getByText('newer-update')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });
  });

  it('persists project organization, pinning, and manual drag order', async () => {
    mockProjects = [
      { id: 1, name: 'first', created_at: '2026-07-13T12:00:00Z' },
      { id: 2, name: 'second', created_at: '2026-07-13T13:00:00Z' },
    ];
    window.localStorage.setItem('taskforceai.desktop.projects.pinned.v1', '{invalid');
    window.localStorage.setItem('taskforceai.desktop.projects.manual-order.v1', '{invalid');

    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="code"
        onDesktopTaskModeChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('In one list'));
    expect(mockSetActiveProjectId).toHaveBeenCalledWith(null);
    expect(window.localStorage.getItem('taskforceai.desktop.projects.organize.v1')).toBe('list');
    fireEvent.click(screen.getByText('All project tasks'));

    fireEvent.click(screen.getByText('By project'));
    fireEvent.click(screen.getAllByText('Pin project')[0]!);
    await waitFor(() => expect(screen.getByText('Unpin project')).toBeTruthy());
    fireEvent.click(screen.getByText('Unpin project'));

    fireEvent.click(screen.getByText('Manual order'));
    expect(window.localStorage.getItem('taskforceai.desktop.projects.manual-order.v1')).toBe(
      '[1,2]'
    );

    let firstRow = screen.getByText('first').closest('[draggable="true"]');
    let secondRow = screen.getByText('second').closest('[draggable="true"]');
    expect(firstRow).toBeTruthy();
    expect(secondRow).toBeTruthy();
    fireEvent.dragStart(secondRow!);
    firstRow = screen.getByText('first').closest('[draggable="true"]');
    fireEvent.dragOver(firstRow!);
    fireEvent.drop(firstRow!);
    fireEvent.dragEnd(secondRow!);
    expect(window.localStorage.getItem('taskforceai.desktop.projects.manual-order.v1')).toBe(
      '[2,1]'
    );

    secondRow = screen.getByText('second').closest('[draggable="true"]');
    fireEvent.dragStart(secondRow!);
    secondRow = screen.getByText('second').closest('[draggable="true"]');
    fireEvent.drop(secondRow!);
  });

  it('reports project activation and archive failures', async () => {
    mockProjects = [{ id: 1, name: 'taskforceai', created_at: '2026-07-13T12:00:00Z' }];
    window.localStorage.setItem(
      'taskforceai.desktop.code-workspace-roots.v2',
      JSON.stringify(['/Users/test/Developer/taskforceai'])
    );
    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="code"
        onDesktopTaskModeChange={vi.fn()}
      />
    );

    mockEnableDesktopLocalCoding.mockRejectedValue(new Error('activation failed'));
    fireEvent.click(screen.getByRole('button', { name: 'taskforceai' }));
    await waitFor(() =>
      expect(
        screen.getByText('The local workspace for this project could not be activated.')
      ).toBeTruthy()
    );
    fireEvent.click(
      screen.getByText('The local workspace for this project could not be activated.')
    );

    mockListConversations.mockRejectedValueOnce(new Error('archive failed'));
    fireEvent.click(screen.getByText('Archive tasks'));
    await waitFor(() =>
      expect(screen.getByText('The tasks in this project could not be archived.')).toBeTruthy()
    );
  });

  it('commits project renames and keeps the editor open on failure', async () => {
    const user = userEvent.setup({ document });
    mockProjects = [{ id: 1, name: 'taskforceai', created_at: '2026-07-13T12:00:00Z' }];
    mockRenameProject.mockResolvedValue(false);

    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="work"
        onDesktopTaskModeChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Rename project'));
    let renameInput = screen.getByRole('textbox', { name: 'Rename taskforceai' });
    await user.clear(renameInput);
    await user.type(renameInput, 'Renamed once');
    expect((renameInput as HTMLInputElement).value).toBe('Renamed once');
    await user.type(renameInput, '{Enter}');

    await waitFor(() => expect(mockRenameProject).toHaveBeenCalledWith(1, 'Renamed once'));
    expect(screen.getByText('The project could not be renamed.')).toBeTruthy();

    mockRenameProject.mockResolvedValue(true);
    renameInput = screen.getByRole('textbox', { name: 'Rename taskforceai' });
    await user.clear(renameInput);
    await user.type(renameInput, 'Renamed twice{Enter}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());

    fireEvent.click(screen.getByText('Rename project'));
    renameInput = screen.getByRole('textbox', { name: 'Rename taskforceai' });
    await user.type(renameInput, '{Enter}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(mockRenameProject).toHaveBeenCalledTimes(2);
  });

  it('handles Code folder and worktree edge cases', async () => {
    mockProjects = [{ id: 1, name: 'existing', created_at: '2026-07-13T12:00:00Z' }];
    mockPickDesktopWorkspaceFolder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('/')
      .mockResolvedValueOnce('/Users/test/Developer/existing')
      .mockRejectedValueOnce(new Error('dialog failed'));
    mockCreateDesktopWorktree
      .mockResolvedValueOnce({ worktree: { path: '/tmp/worktree' } })
      .mockRejectedValueOnce(new Error('worktree failed'));
    window.localStorage.setItem(
      'taskforceai.desktop.code-workspace-roots.v2',
      JSON.stringify(['/Users/test/Developer/existing'])
    );

    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="code"
        onDesktopTaskModeChange={vi.fn()}
      />
    );

    const addFolder = () => fireEvent.click(screen.getByText('Use an existing folder'));
    addFolder();
    await waitFor(() => expect(mockPickDesktopWorkspaceFolder).toHaveBeenCalledTimes(1));
    addFolder();
    await waitFor(() =>
      expect(
        screen.getByText('The selected folder does not have a usable project name.')
      ).toBeTruthy()
    );
    addFolder();
    await waitFor(() => {
      expect(mockCreateDesktopAppServerProject).not.toHaveBeenCalled();
      expect(mockSetActiveProjectId).toHaveBeenCalledWith(1);
    });
    addFolder();
    await waitFor(() =>
      expect(screen.getByText('The selected folder could not be added as a project.')).toBeTruthy()
    );

    fireEvent.click(screen.getByText('Create permanent worktree'));
    await waitFor(() =>
      expect(mockEnableDesktopLocalCoding).toHaveBeenCalledWith({ workspace: '/tmp/worktree' })
    );
    fireEvent.click(screen.getByText('Create permanent worktree'));
    await waitFor(() =>
      expect(screen.getByText('A permanent worktree could not be created.')).toBeTruthy()
    );
  });

  it('disables task archiving when the store does not support it', () => {
    mockProjects = [{ id: 1, name: 'taskforceai', created_at: '2026-07-13T12:00:00Z' }];
    mockArchiveConversationAvailable = false;

    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="work"
        onDesktopTaskModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Archive tasks').closest('button')?.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: "Don't work in a project" }));
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(mockSetActiveProjectId).toHaveBeenCalledWith(null);
    expect(mockSetProjectModalOpen).toHaveBeenCalledWith(true);
  });

  it('keeps repository navigation out of the desktop Work shell', () => {
    const onDesktopTaskModeChange = vi.fn();
    render(
      <Sidebar
        isOpen
        onClose={onClose}
        onNewChat={onNewChat}
        desktopRuntime
        desktopTaskMode="work"
        onDesktopTaskModeChange={onDesktopTaskModeChange}
        onAgentManagerClick={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Work mode selector' }));
    expect(screen.getByRole('button', { name: 'Chat mode: Quick answers' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Work mode: Create, learn, and explore' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Code mode: Build, debug, and ship' }));
    expect(onDesktopTaskModeChange).toHaveBeenCalledWith('code');
    expect(screen.queryByRole('button', { name: 'Pull requests' })).toBeNull();
    expect(screen.getByRole('button', { name: "Don't work in a project" })).toBeTruthy();
  });
});
