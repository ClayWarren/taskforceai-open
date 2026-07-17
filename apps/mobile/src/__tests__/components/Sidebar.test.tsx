import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { Sidebar } from '../../components/Sidebar';

const mockMutateAsync = jest.fn(async () => undefined);
const mockUseConversationsQuery = jest.fn();
const mockUseDeleteConversationMutation = jest.fn();
const mockUseProjectsQuery = jest.fn();
const mockListConversations = jest.fn();
const mockListArchivedConversations = jest.fn();
const mockGetConversationMessages = jest.fn();
const mockClearConversation = jest.fn(async () => undefined);
const mockArchiveConversation = jest.fn(async () => undefined);
const mockIngestRemoteConversationSummary = jest.fn(async () => undefined);
const mockOnClose = jest.fn();
const mockOnNewChat = jest.fn();
const mockOnConversationSelect = jest.fn();

let mockConversationData: any[] = [];
let latestSidebarViewProps: any;
let latestProjectsScreenProps: any;
let mockAuthUser: { email: string; full_name?: string | null } = {
  email: 'jane@example.com',
  full_name: 'Jane Doe',
};

const localConversation = (
  conversationId: string,
  overrides: Record<string, unknown> = {}
) => ({
  conversationId,
  title: 'Local title',
  updatedAt: 1700000000000,
  lastMessagePreview: 'preview text',
  ...overrides,
});

const renderSidebar = async (props: Partial<ComponentProps<typeof Sidebar>> = {}) =>
  await render(
    <Sidebar
      visible={true}
      onClose={mockOnClose}
      onNewChat={mockOnNewChat}
      onConversationSelect={mockOnConversationSelect}
      isAuthenticated={true}
      {...props}
    />
  );

const pressDeleteConfirmation = (alertSpy: jest.SpyInstance) => {
  expect(alertSpy).toHaveBeenCalled();
  const [, , buttons] = alertSpy.mock.calls[0] as [
    string,
    string | undefined,
    Array<{ text: string; onPress?: () => void }>,
  ];
  const deleteButton = buttons.find((button) => button.text === 'Delete');
  if (!deleteButton?.onPress) {
    throw new Error('Delete button handler is missing');
  }
  deleteButton.onPress();

  const latestCall = alertSpy.mock.calls[alertSpy.mock.calls.length - 1] as [
    string,
    string | undefined,
    Array<{ text: string; onPress?: () => void }>,
  ];
  const confirmationButton = latestCall[2].find((button) => button.text === 'Delete');
  if (!confirmationButton?.onPress) {
    throw new Error('Delete confirmation handler is missing');
  }
  confirmationButton.onPress();
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../utils/nativewind', () => ({
  styled: (component: unknown) => component,
}));

jest.mock('../../utils/glass', () => ({
  isGlassEffectSupported: () => false,
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthUser,
  }),
}));

jest.mock('../../hooks/api/conversations', () => ({
  useConversationsQuery: (...args: unknown[]) => mockUseConversationsQuery(...args),
  useDeleteConversationMutation: (...args: unknown[]) => mockUseDeleteConversationMutation(...args),
}));

jest.mock('../../hooks/api/projects', () => ({
  useProjectsQuery: (...args: unknown[]) => mockUseProjectsQuery(...args),
}));

jest.mock('../../storage/chat-local-mobile', () => ({
  archiveConversation: (...args: unknown[]) => mockArchiveConversation(...args),
  clearConversation: (...args: unknown[]) => mockClearConversation(...args),
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  ingestRemoteConversationSummary: (...args: unknown[]) => mockIngestRemoteConversationSummary(...args),
  listArchivedConversations: (...args: unknown[]) => mockListArchivedConversations(...args),
  listConversations: (...args: unknown[]) => mockListConversations(...args),
}));

jest.mock('../../components/Sidebar.view', () => ({
  SidebarView: (props: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    latestSidebarViewProps = props;
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `filtered:${props.filteredConversations.length}`),
      props.desktopSessionsSlot,
      react.createElement(
        TouchableOpacity,
        {
          testID: 'sidebar-view-select-first',
          onPress: () => {
            const first = props.filteredConversations[0];
            if (first) {
              props.handleConversationPress(first.id);
            }
          },
        },
        react.createElement(Text, null, 'select-first')
      ),
      react.createElement(
        TouchableOpacity,
        {
          testID: 'sidebar-view-delete-first',
          onPress: () => {
            const first = props.filteredConversations[0];
            if (first) {
              props.handleDeleteConversation(first.id, first.user_input);
            }
          },
        },
        react.createElement(Text, null, 'delete-first')
      ),
      react.createElement(
        TouchableOpacity,
        {
          testID: 'sidebar-view-manage-projects',
          onPress: props.onManageProjects,
        },
        react.createElement(Text, null, 'manage-projects')
      )
    );
  },
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const react = require('react');
    const { Text } = require('react-native');
    return react.createElement(Text, null, `icon:${name}`);
  },
}));

jest.mock('../../screens/ProjectsScreen', () => ({
  ProjectsScreen: (props: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    latestProjectsScreenProps = props;
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `projects-visible:${String(props.visible)}`),
      react.createElement(
        TouchableOpacity,
        {
          testID: 'projects-screen-select',
          onPress: () => props.onSelectProject(10),
        },
        react.createElement(Text, null, 'select-project')
      )
    );
  },
}));

beforeEach(() => {
  jest.resetAllMocks();
  mockConversationData = [];
  latestSidebarViewProps = undefined;
  latestProjectsScreenProps = undefined;
  mockAuthUser = {
    email: 'jane@example.com',
    full_name: 'Jane Doe',
  };

  mockUseConversationsQuery.mockImplementation(() => ({
    data: { pages: [mockConversationData] },
  }));
  mockUseDeleteConversationMutation.mockImplementation(() => ({
    mutateAsync: mockMutateAsync,
  }));
  mockUseProjectsQuery.mockImplementation(() => ({
    data: [],
  }));
  mockListConversations.mockResolvedValue({
    ok: true,
    value: [],
  });
  mockListArchivedConversations.mockResolvedValue({
    ok: true,
    value: [],
  });
  mockGetConversationMessages.mockResolvedValue({
    ok: true,
    value: [],
  });
});

describe('Sidebar', () => {
  it('does not expose the account email when a display name is unavailable', async () => {
    mockAuthUser = { email: 'private@example.com', full_name: 'private@example.com' };

    await renderSidebar();

    expect(latestSidebarViewProps.userName).toBe('Account');
    expect(latestSidebarViewProps.userInitials).toBe('TF');
    expect(latestSidebarViewProps.userName).not.toContain(mockAuthUser.email);
  });

  it('shows guest-owned local conversations but not account or remote conversations while signed out', async () => {
    mockConversationData = [
      {
        id: 7,
        timestamp: '2026-01-01T00:00:00.000Z',
        user_input: 'Remote title',
        result: 'Remote result',
      },
    ];
    mockListConversations.mockResolvedValueOnce({
      ok: true,
      value: [localConversation('guest-local-1'), localConversation('local-account-1')],
    });

    const { getByText, queryByText } = await renderSidebar({ isAuthenticated: false });

    await waitFor(() => {
      expect(getByText('filtered:1')).toBeTruthy();
    });
    expect(mockListConversations).toHaveBeenCalled();
    expect(latestSidebarViewProps.filteredConversations[0]).toEqual(
      expect.objectContaining({ model: 'guest-local-1' })
    );
    expect(queryByText('Desktop')).toBeNull();
  });

  it('does not mix guest-owned conversations into an authenticated sidebar', async () => {
    mockListConversations.mockResolvedValueOnce({
      ok: true,
      value: [localConversation('guest-local-1'), localConversation('local-account-1')],
    });

    await renderSidebar({ isAuthenticated: true });

    await waitFor(() => {
      expect(latestSidebarViewProps.filteredConversations).toHaveLength(1);
    });
    expect(latestSidebarViewProps.filteredConversations[0]).toEqual(
      expect.objectContaining({ model: 'local-account-1' })
    );
  });

  it('shows authenticated product sidebar rows', async () => {
    const onDesktopSessionsPress = jest.fn();
    const onArtifactsPress = jest.fn();
    const onScheduledPress = jest.fn();
    const onPluginsPress = jest.fn();
    const { getByLabelText, getByText } = await renderSidebar({
      onDesktopSessionsPress,
      onArtifactsPress,
      onScheduledPress,
      onPluginsPress,
    });

    await waitFor(() => {
      expect(getByText('Remote')).toBeTruthy();
      expect(getByText('Artifacts')).toBeTruthy();
      expect(getByText('Scheduled')).toBeTruthy();
      expect(getByText('Plugins')).toBeTruthy();
    });
    await fireEvent.press(getByLabelText('Open Scheduled'));
    await fireEvent.press(getByLabelText('Open Plugins'));
    await fireEvent.press(getByLabelText('Open Artifacts'));
    await fireEvent.press(getByLabelText('Open Remote'));
    expect(onArtifactsPress).toHaveBeenCalledTimes(1);
    expect(onDesktopSessionsPress).toHaveBeenCalledTimes(1);
    expect(onScheduledPress).toHaveBeenCalledTimes(1);
    expect(onPluginsPress).toHaveBeenCalledTimes(1);
  });

  it('loads local conversations when visible and maps them with synthetic ids', async () => {
    mockListConversations.mockResolvedValueOnce({
      ok: true,
      value: [localConversation('local-conv-1')],
    });
    mockGetConversationMessages.mockResolvedValueOnce({
      ok: true,
      value: [{ content: 'message one' }, { content: 'message two' }],
    });

    const { getByText } = await renderSidebar();

    await waitFor(() => {
      expect(getByText('filtered:1')).toBeTruthy();
    });

    expect(latestSidebarViewProps.filteredConversations[0]).toEqual(
      expect.objectContaining({
        id: -1,
        model: 'local-conv-1',
        user_input: 'Local title',
      })
    );
  });

  it('deduplicates local conversations that correspond to an already-fetched remote conversation', async () => {
    mockConversationData = [
      {
        id: 7,
        timestamp: '2026-01-01T00:00:00.000Z',
        user_input: 'Remote title',
        result: 'Remote result',
      },
    ];
    mockListConversations.mockResolvedValueOnce({
      ok: true,
      value: [localConversation('remote-7', { title: 'Local mirror', lastMessagePreview: 'local preview' })],
    });
    mockGetConversationMessages.mockResolvedValueOnce({
      ok: true,
      value: [{ content: 'local message' }],
    });

    await renderSidebar({ isAuthenticated: true });

    await waitFor(() => {
      expect(latestSidebarViewProps.filteredConversations).toHaveLength(1);
    });

    expect(mockGetConversationMessages).not.toHaveBeenCalled();
    expect(latestSidebarViewProps.filteredConversations).toHaveLength(1);
    expect(latestSidebarViewProps.filteredConversations[0]).toEqual(
      expect.objectContaining({ id: 7, user_input: 'Remote title' })
    );
  });

  it('defers local message search text loading until sidebar search is active', async () => {
    mockListConversations.mockResolvedValueOnce({
      ok: true,
      value: [localConversation('local-conv-1')],
    });
    mockGetConversationMessages.mockResolvedValueOnce({
      ok: true,
      value: [{ content: 'deep searchable message' }],
    });

    const { getByText } = await renderSidebar();

    await waitFor(() => {
      expect(getByText('filtered:1')).toBeTruthy();
    });
    expect(mockGetConversationMessages).not.toHaveBeenCalled();

    await act(async () => {
      latestSidebarViewProps.setSearchQuery('Local');
    });

    await waitFor(() => {
      expect(mockGetConversationMessages).toHaveBeenCalledWith('local-conv-1');
      expect(latestSidebarViewProps.filteredConversations[0]).toEqual(
        expect.objectContaining({
          searchable: expect.stringContaining('deep searchable message'),
          hasFullSearchText: true,
        })
      );
    });
  });

  it('filters archived mirrored remote conversations from the active list', async () => {
    mockConversationData = [
      {
        id: 7,
        timestamp: '2026-01-01T00:00:00.000Z',
        user_input: 'Archived remote',
        result: 'Remote result',
      },
    ];
    mockListArchivedConversations.mockResolvedValueOnce({
      ok: true,
      value: [localConversation('remote-7', { title: 'Archived remote', isArchived: true })],
    });

    const { getByText } = await renderSidebar({ isAuthenticated: true });

    await waitFor(() => {
      expect(getByText('filtered:0')).toBeTruthy();
    });
  });

  it('maps negative local ids back to local conversation id when selecting', async () => {
    mockListConversations.mockResolvedValueOnce({
      ok: true,
      value: [localConversation('local-conv-42', { title: 'Local select', lastMessagePreview: 'preview' })],
    });
    mockGetConversationMessages.mockResolvedValueOnce({ ok: true, value: [] });

    const { getByTestId, getByText } = await renderSidebar();

    await waitFor(() => {
      expect(getByText('filtered:1')).toBeTruthy();
    });

    await fireEvent.press(getByTestId('sidebar-view-select-first'));

    expect(mockOnConversationSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: -1,
        model: 'local-conv-42',
      })
    );
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('ingests remote summaries only when timestamps change', async () => {
    mockConversationData = [
      {
        id: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        user_input: 'remote one',
        result: 'result one',
      },
      {
        id: 2,
        timestamp: '2026-01-01T00:00:00.000Z',
        user_input: 'remote two',
        result: 'result two',
      },
    ];

    const { rerender } = await renderSidebar({ isAuthenticated: true });

    await waitFor(() => {
      expect(mockIngestRemoteConversationSummary).toHaveBeenCalledTimes(2);
    });

    mockConversationData = [
      {
        id: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        user_input: 'remote one',
        result: 'result one',
      },
      {
        id: 2,
        timestamp: '2026-01-01T00:00:01.000Z',
        user_input: 'remote two',
        result: 'result two',
      },
    ];

    rerender(
      <Sidebar
        visible={true}
        onClose={mockOnClose}
        onNewChat={mockOnNewChat}
        onConversationSelect={mockOnConversationSelect}
        isAuthenticated={true}
      />
    );

    await waitFor(() => {
      expect(mockIngestRemoteConversationSummary).toHaveBeenCalledTimes(3);
    });
  });

  it('deletes local conversations via confirmation dialog', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    mockListConversations.mockResolvedValue({
      ok: true,
      value: [localConversation('local-to-delete', { title: 'Delete me', lastMessagePreview: 'preview' })],
    });
    mockGetConversationMessages.mockResolvedValue({ ok: true, value: [] });

    const { getByTestId, getByText } = await renderSidebar();

    await waitFor(() => {
      expect(getByText('filtered:1')).toBeTruthy();
    });

    await fireEvent.press(getByTestId('sidebar-view-delete-first'));

    pressDeleteConfirmation(alertSpy);

    await waitFor(() => {
      expect(mockClearConversation).toHaveBeenCalledWith('local-to-delete');
    });
  });

  it('deletes mirrored local remote conversation after remote delete succeeds', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    mockConversationData = [
      {
        id: 7,
        timestamp: '2026-01-01T00:00:00.000Z',
        user_input: 'Remote title',
        result: 'Remote result',
      },
    ];
    mockListConversations.mockResolvedValueOnce({
      ok: true,
      value: [localConversation('remote-7', { title: 'Remote mirror', lastMessagePreview: 'mirror preview' })],
    });
    mockGetConversationMessages.mockResolvedValue({ ok: true, value: [] });

    const { getByTestId, getByText } = await renderSidebar({ isAuthenticated: true });

    await waitFor(() => {
      expect(getByText('filtered:1')).toBeTruthy();
    });

    await fireEvent.press(getByTestId('sidebar-view-delete-first'));

    pressDeleteConfirmation(alertSpy);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(7);
      expect(mockClearConversation).toHaveBeenCalledWith('remote-7');
    });

    alertSpy.mockRestore();
  });

  it('archives local conversations from the long-press actions menu', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    mockListConversations.mockResolvedValue({
      ok: true,
      value: [localConversation('local-to-archive', { title: 'Archive me', lastMessagePreview: 'preview' })],
    });
    mockGetConversationMessages.mockResolvedValue({ ok: true, value: [] });

    const { getByTestId, getByText } = await renderSidebar();

    await waitFor(() => {
      expect(getByText('filtered:1')).toBeTruthy();
    });

    await fireEvent.press(getByTestId('sidebar-view-delete-first'));

    const [, , buttons] = alertSpy.mock.calls[0] as [
      string,
      string | undefined,
      Array<{ text: string; onPress?: () => void }>,
    ];
    buttons.find((button) => button.text === 'Archive')?.onPress?.();
    const [, , confirmationButtons] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1] as [
      string,
      string | undefined,
      Array<{ text: string; onPress?: () => void }>,
    ];
    confirmationButtons.find((button) => button.text === 'Archive')?.onPress?.();

    await waitFor(() => {
      expect(mockArchiveConversation).toHaveBeenCalledWith('local-to-archive');
    });

    alertSpy.mockRestore();
  });

  it('loads projects when authenticated and visible, and opens projects modal on manage action', async () => {
    mockUseProjectsQuery.mockImplementation(() => ({
      data: [
        { id: 10, name: 'Project A' },
        { id: 11, name: 'Project B' },
      ],
    }));

    const { getByTestId, getByText } = await renderSidebar({ isAuthenticated: true });

    await fireEvent.press(getByTestId('sidebar-view-manage-projects'));

    await waitFor(() => {
      expect(getByText('projects-visible:true')).toBeTruthy();
    });
    expect(latestProjectsScreenProps.projects).toHaveLength(2);
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    await fireEvent.press(getByTestId('projects-screen-select'));

    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(latestProjectsScreenProps.visible).toBe(false);
  });

  it('does not ingest cached remote summaries while signed out', async () => {
    mockConversationData = [
      {
        id: 9,
        timestamp: '2026-01-01T00:00:00.000Z',
        user_input: 'Cached remote title',
        result: 'Cached remote result',
      },
    ];

    await renderSidebar({ isAuthenticated: false });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(mockIngestRemoteConversationSummary).not.toHaveBeenCalled();
  });
});
