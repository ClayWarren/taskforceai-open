import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';
import path from 'path';
import '../../../../../tests/setup/dom';

const appPath = (p: string) => path.resolve(process.cwd(), 'apps/web/app', p);

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
let mockProjects: Array<{ id: number; name: string }> = [];
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
vi.mock(appPath('lib/profile/ProfileModalContext'), () => ({
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
    refreshProjects: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
  })),
}));

// Mock ConversationList
vi.mock(appPath('components/chat/ConversationList'), () => ({
  __esModule: true,
  default: (props: any) => mockConversationList(props),
}));

// Mock UI Kit Components
vi.mock('@taskforceai/ui-kit', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div data-testid="dropdown-content">{children}</div>,
  DropdownMenuItem: ({ onSelect, children }: any) => (
    <button
      onClick={(_e) => {
        if (onSelect) onSelect({ preventDefault: () => {} } as any);
      }}
    >
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
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
    (useAuth as any).mockReturnValue({
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
    (useAuth as any).mockReturnValue({ user: null });
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    expect(screen.queryByLabelText('Open profile menu')).toBeNull();
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

  it('handles project selection and project modal actions', () => {
    mockProjects = [
      { id: 1, name: 'Launch' },
      { id: 2, name: 'Research' },
    ];
    mockActiveProjectId = 1;

    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByText('General'));
    fireEvent.click(screen.getByText('Research'));
    fireEvent.click(screen.getByText('Manage projects'));

    expect(mockSetActiveProjectId).toHaveBeenCalledWith(null);
    expect(mockSetActiveProjectId).toHaveBeenCalledWith(2);
    expect(mockSetProjectModalOpen).toHaveBeenCalledWith(true);
  });

  it('displays user email when username is available', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    expect(screen.getByText('T')).toBeTruthy(); // First letter of email
    expect(screen.getByText('testuser')).toBeTruthy(); // Derived from email
  });

  it('uses full name for profile display and avatar when present', () => {
    (useAuth as any).mockReturnValue({
      user: { email: 'ada@example.com', full_name: 'Ada Lovelace' },
    });

    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    render(<Sidebar isOpen={true} onClose={onClose} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByLabelText('Close sidebar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('applies closed styles when isOpen is false', () => {
    const { container } = render(
      <Sidebar isOpen={false} onClose={onClose} onNewChat={onNewChat} />
    );

    const sidebar = container.querySelector('.sidebar');
    expect(sidebar?.className).toContain('-translate-x-full');
  });
});
