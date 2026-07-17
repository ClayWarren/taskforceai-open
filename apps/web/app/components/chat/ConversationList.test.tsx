import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import path from 'path';
import type { ComponentProps } from 'react';
import { localSearch } from '@taskforceai/client-runtime/local-search';

import '../../../../../tests/setup/dom';

const appPath = (p: string) => path.resolve(process.cwd(), 'apps/web/app', p);

// Common Mocks
vi.mock(appPath('lib/logger'), () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockStore = {
  ensureConversation: vi.fn().mockResolvedValue(undefined),
  listConversations: vi.fn().mockResolvedValue([]),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  upsertMessage: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockReturnValue(() => {}),
  renameConversation: vi.fn().mockResolvedValue({ ok: true }),
  archiveConversation: vi.fn().mockResolvedValue({ ok: true }),
  clearConversation: vi.fn().mockResolvedValue({ ok: true }),
};
let mockActiveProjectId: number | null = null;

vi.mock(appPath('lib/platform/PlatformProvider'), () => ({
  useConversationStore: vi.fn(() => mockStore),
  usePlatformRuntime: vi.fn(() => 'web'),
}));

vi.mock(appPath('lib/providers/AuthProvider'), () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true, isTokenReady: true })),
}));

const mockGetConversationsPage = vi.fn<() => Promise<any>>(async () => ({
  conversations: [],
  total: 0,
  limit: 20,
  offset: 0,
  has_more: false,
}));

vi.mock('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient: vi.fn(() => ({
    getConversationsPage: mockGetConversationsPage,
  })),
}));

let mockOptionalSync: null | {
  enabled: boolean;
  isOnline: boolean | null;
  sync: ReturnType<typeof vi.fn>;
  syncState: { lastSyncTime: number; isSyncing: boolean };
} = null;

vi.mock(appPath('lib/providers/SyncProvider'), () => ({
  useOptionalSync: vi.fn(() => mockOptionalSync),
}));

vi.mock(appPath('lib/projects/ProjectsContext'), () => ({
  useProjects: vi.fn(() => ({
    projects: [],
    activeProjectId: mockActiveProjectId,
    setActiveProjectId: vi.fn(),
    isLoading: false,
    isModalOpen: false,
    setModalOpen: vi.fn(),
    refreshProjects: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
  })),
}));

vi.mock(appPath('lib/platform/confirm-dialog'), () => ({
  confirmDialog: vi.fn().mockResolvedValue(true),
}));

const mockSearch = {
  addItem: vi.fn(),
  search: vi.fn((): Array<{ id: string; title: string; content: string; tags: string[] }> => []),
  removeItem: vi.fn(),
};

vi.mock(appPath('components/chat/ConversationItem'), () => ({
  __esModule: true,
  default: ({
    conversation,
    onClick,
    onArchive,
    onDelete,
    onPinToggle,
    onRenameRequest,
    isEditing,
    editValue,
    onEditChange,
    onEditSubmit,
    onEditCancel,
    hasUnread,
    isActive,
    isPinned,
  }: any) => (
    <div
      data-active={String(Boolean(isActive))}
      data-pinned={String(Boolean(isPinned))}
      data-testid="conversation-item"
      onClick={() => onClick(conversation.id)}
    >
      <span data-testid="title">{conversation.user_input || 'Untitled'}</span>
      {hasUnread ? <span data-testid="unread-marker">Unread</span> : null}
      {isEditing ? (
        <form
          data-testid="rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            onEditSubmit();
          }}
        >
          <input
            aria-label="Rename conversation"
            value={editValue}
            onChange={(event) => onEditChange(event.target.value)}
          />
          <button type="submit">Save rename</button>
          <button type="button" onClick={onEditCancel}>
            Cancel rename
          </button>
        </form>
      ) : null}
      <button
        data-testid="pin-btn"
        onClick={(e) => {
          e.stopPropagation();
          onPinToggle(conversation.id);
        }}
      >
        Pin
      </button>
      <button
        data-testid="archive-btn"
        onClick={(e) => {
          e.stopPropagation();
          onArchive(conversation.id);
        }}
      >
        Archive
      </button>
      <button
        data-testid="archive-btn-invalid-id"
        onClick={(e) => {
          e.stopPropagation();
          onArchive(Number.NaN);
        }}
      >
        Archive Invalid
      </button>
      <button
        data-testid="delete-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(conversation.id);
        }}
      >
        Delete
      </button>
      <button
        data-testid="delete-btn-invalid-id"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(Number.NaN);
        }}
      >
        Delete Invalid
      </button>
      <button
        data-testid="rename-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRenameRequest(conversation.id);
        }}
      >
        Rename
      </button>
    </div>
  ),
}));

import { usePlatformRuntime } from '../../lib/platform/PlatformProvider';
import { useAuth } from '../../lib/providers/AuthProvider';
import { logger } from '../../lib/logger';
import { confirmDialog } from '../../lib/platform/confirm-dialog';
import ConversationList from './ConversationList';

const localConversation = (overrides: Record<string, unknown> = {}) => ({
  conversationId: 'local-guid-1',
  title: 'Local conversation',
  updatedAt: Date.now(),
  ...overrides,
});

const renderWithConversations = async (
  conversations: Array<Record<string, unknown>>,
  props: ComponentProps<typeof ConversationList> = {}
) => {
  mockStore.listConversations.mockResolvedValue(conversations);
  render(<ConversationList {...props} />);
  await waitFor(() => expect(screen.getAllByTestId('conversation-item').length).toBeGreaterThan(0));
};

describe('ConversationList', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
    mockActiveProjectId = null;
    (useAuth as any).mockReturnValue({ isAuthenticated: true, isTokenReady: true });
    (usePlatformRuntime as any).mockReturnValue('web');
    mockOptionalSync = null;
    mockGetConversationsPage.mockResolvedValue({
      conversations: [],
      total: 0,
      limit: 20,
      offset: 0,
      has_more: false,
    });
    mockStore.ensureConversation.mockResolvedValue(undefined);
    mockStore.listConversations.mockResolvedValue([]);
    mockStore.getConversationMessages.mockResolvedValue([]);
    mockStore.upsertMessage.mockResolvedValue(undefined);
    mockStore.subscribe.mockReturnValue(() => {});
    mockStore.renameConversation.mockResolvedValue({ ok: true });
    mockStore.archiveConversation.mockResolvedValue({ ok: true });
    mockStore.clearConversation.mockResolvedValue({ ok: true });
    localSearch.addItem = mockSearch.addItem as typeof localSearch.addItem;
    localSearch.search = mockSearch.search as typeof localSearch.search;
    localSearch.removeItem = mockSearch.removeItem as typeof localSearch.removeItem;
    mockSearch.addItem.mockImplementation(() => {});
    mockSearch.search.mockReturnValue([]);
    mockSearch.removeItem.mockImplementation(() => {});
    (confirmDialog as any).mockResolvedValue(true);
  });

  it('renders empty state when no conversations', async () => {
    render(<ConversationList />);
    await waitFor(() => {
      expect(screen.getByText('No conversations yet')).toBeTruthy();
    });
  });

  it('renders conversations and allows selection', async () => {
    const onSelect = vi.fn();
    const localConvs = [{ conversationId: 'conv-1', title: 'Test Chat', updatedAt: Date.now() }];
    mockStore.listConversations.mockResolvedValue(localConvs);

    render(<ConversationList onConversationSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Test Chat')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('conversation-item'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ user_input: 'Test Chat' }));
  });

  it('marks the active conversation row from the current conversation id', async () => {
    mockStore.listConversations.mockResolvedValue([
      { conversationId: 'conv-active', title: 'Active Chat', updatedAt: Date.now() },
      { conversationId: 'conv-other', title: 'Other Chat', updatedAt: Date.now() },
    ]);

    render(<ConversationList activeConversationId="conv-active" />);

    await waitFor(() => {
      expect(screen.getByText('Active Chat')).toBeTruthy();
      expect(screen.getByText('Other Chat')).toBeTruthy();
    });

    expect(
      screen
        .getByText('Active Chat')
        .closest('[data-testid="conversation-item"]')
        ?.getAttribute('data-active')
    ).toBe('true');
    expect(
      screen
        .getByText('Other Chat')
        .closest('[data-testid="conversation-item"]')
        ?.getAttribute('data-active')
    ).toBe('false');
  });

  it('pins a conversation above newer chats and persists the preference', async () => {
    await renderWithConversations([
      { conversationId: 'newer', title: 'Newer Chat', updatedAt: 2 },
      { conversationId: 'older', title: 'Older Chat', updatedAt: 1 },
    ]);

    const olderRow = screen.getByText('Older Chat').closest('[data-testid="conversation-item"]');
    if (!olderRow) throw new Error('Expected older conversation row');
    const pinButton = olderRow.querySelector('[data-testid="pin-btn"]');
    if (!pinButton) throw new Error('Expected pin button');
    fireEvent.click(pinButton);

    const titles = screen.getAllByTestId('title').map((element) => element.textContent);
    expect(titles).toEqual(['Older Chat', 'Newer Chat']);
    expect(olderRow.getAttribute('data-pinned')).toBe('true');
    expect(localStorage.getItem('taskforceai:pinned-conversations')).toBe('["older"]');
  });

  it('does not hide unhydrated conversations when a project is selected', async () => {
    mockActiveProjectId = 7;
    const localConvs = [
      { conversationId: 'conv-unhydrated', title: 'No Project Metadata', updatedAt: Date.now() },
    ];
    mockStore.listConversations.mockResolvedValue(localConvs);

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('No Project Metadata')).toBeTruthy();
    });
  });

  it('filters conversations by hydrated project id when available', async () => {
    mockActiveProjectId = 7;
    const localConvs = [
      {
        conversationId: 'conv-project-7',
        title: 'Project Seven',
        updatedAt: Date.now(),
        projectId: 7,
      },
      {
        conversationId: 'conv-project-9',
        title: 'Project Nine',
        updatedAt: Date.now(),
        projectId: 9,
      },
    ];
    mockStore.listConversations.mockResolvedValue(localConvs);

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Project Seven')).toBeTruthy();
    });
    expect(screen.queryByText('Project Nine')).toBeNull();
  });

  it('handles confirmed delete success and store failures', async () => {
    await renderWithConversations([localConversation({ title: 'To Delete' })]);
    fireEvent.click(screen.getByTestId('delete-btn'));
    await waitFor(() => expect(mockStore.clearConversation).toHaveBeenCalledWith('local-guid-1'));

    cleanup();
    vi.clearAllMocks();
    mockStore.subscribe.mockReturnValue(() => {});
    mockStore.clearConversation.mockRejectedValue(new Error('Delete failed'));
    await renderWithConversations([localConversation({ title: 'Delete Failure' })]);
    fireEvent.click(screen.getByTestId('delete-btn'));
    await waitFor(() => expect((logger.error as any).mock.calls.length).toBeGreaterThan(0));
  });

  it('archives conversations and refreshes the list', async () => {
    await renderWithConversations([localConversation({ title: 'To Archive' })]);

    fireEvent.click(screen.getByTestId('archive-btn'));

    await waitFor(() => expect(mockStore.archiveConversation).toHaveBeenCalledWith('local-guid-1'));
    await waitFor(() => expect(mockStore.listConversations).toHaveBeenCalledTimes(2));
    expect(mockStore.clearConversation).not.toHaveBeenCalled();
  });

  it('logs archive validation and store failures', async () => {
    await renderWithConversations([localConversation({ title: 'Bad Archive Id' })]);

    fireEvent.click(screen.getByTestId('archive-btn-invalid-id'));

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        'Archive conversation aborted: invalid conversation id',
        expect.objectContaining({ id: Number.NaN })
      );
    });
    expect(mockStore.archiveConversation).not.toHaveBeenCalled();

    cleanup();
    vi.clearAllMocks();
    mockStore.subscribe.mockReturnValue(() => {});
    mockStore.archiveConversation.mockRejectedValue(new Error('Archive failed'));
    await renderWithConversations([localConversation({ title: 'Archive Failure' })]);

    fireEvent.click(screen.getByTestId('archive-btn'));

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to archive local conversation',
        expect.objectContaining({
          id: -1,
          localId: 'local-guid-1',
          error: expect.any(Error),
        })
      )
    );
  });

  it('does not delete when user cancels confirmation', async () => {
    (confirmDialog as any).mockResolvedValue(false);
    await renderWithConversations([localConversation({ title: 'To Keep' })]);

    fireEvent.click(screen.getByTestId('delete-btn'));

    await waitFor(() => {
      expect(confirmDialog).toHaveBeenCalled();
    });
    expect(mockStore.getConversationMessages).not.toHaveBeenCalled();
    expect(mockStore.clearConversation).not.toHaveBeenCalled();
  });

  it('aborts delete when id validation fails', async () => {
    await renderWithConversations([localConversation({ title: 'Bad Delete Id' })]);

    fireEvent.click(screen.getByTestId('delete-btn-invalid-id'));

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        'Delete conversation aborted: invalid conversation id',
        expect.objectContaining({ id: Number.NaN })
      );
    });
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(mockStore.clearConversation).not.toHaveBeenCalled();
  });

  it('logs confirmation failures and aborts delete flow', async () => {
    (confirmDialog as any).mockRejectedValue(new Error('Dialog failed'));
    await renderWithConversations([localConversation({ title: 'Confirm Failure' })]);

    fireEvent.click(screen.getByTestId('delete-btn'));

    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Delete conversation confirmation failed',
        expect.objectContaining({ id: -1, error: expect.any(Error) })
      );
    });
    expect(mockStore.clearConversation).not.toHaveBeenCalled();
  });

  it('continues delete when message lookup fails', async () => {
    mockStore.getConversationMessages.mockRejectedValueOnce(new Error('Lookup failed'));
    await renderWithConversations([localConversation({ title: 'Delete with Lookup Failure' })]);

    fireEvent.click(screen.getByTestId('delete-btn'));

    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to load messages before deleting local conversation',
        expect.objectContaining({ id: -1, localId: 'local-guid-1', error: expect.any(Error) })
      );
    });
    await waitFor(() => {
      expect(mockStore.clearConversation).toHaveBeenCalledWith('local-guid-1');
    });
  });

  it('logs search cleanup errors and still refreshes after delete', async () => {
    mockStore.getConversationMessages.mockResolvedValueOnce([
      {
        messageId: 'message-1',
        conversationId: 'local-guid-1',
        role: 'user',
        content: 'hello',
        isStreaming: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    mockSearch.removeItem.mockImplementationOnce(() => {
      throw new Error('Cleanup failed');
    });

    await renderWithConversations([localConversation({ title: 'Cleanup Error' })]);

    fireEvent.click(screen.getByTestId('delete-btn'));

    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to remove message from search index after conversation delete',
        expect.objectContaining({
          id: -1,
          localId: 'local-guid-1',
          messageId: 'message-1',
          error: expect.any(Error),
        })
      );
    });
    await waitFor(() => {
      expect(mockStore.listConversations).toHaveBeenCalledTimes(2);
    });
  });

  it('renames conversations successfully', async () => {
    await renderWithConversations([localConversation({ title: 'Old Title' })]);

    fireEvent.click(screen.getByTestId('rename-btn'));
    fireEvent.change(screen.getByLabelText('Rename conversation'), {
      target: { value: 'New Title' },
    });
    fireEvent.click(screen.getByText('Save rename'));

    await waitFor(() => {
      expect(mockStore.renameConversation).toHaveBeenCalledWith('local-guid-1', 'Old Title');
    });
    await waitFor(() => expect(mockStore.listConversations).toHaveBeenCalledTimes(2));
  });

  it('cancels rename without writing changes', async () => {
    await renderWithConversations([localConversation({ title: '' })]);

    fireEvent.click(screen.getByTestId('rename-btn'));
    expect(screen.getByDisplayValue('Local conversation')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel rename'));

    expect(screen.queryByTestId('rename-form')).toBeNull();
    expect(mockStore.renameConversation).not.toHaveBeenCalled();
  });

  it('loads additional local conversations when more pages are available', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      conversationId: `conv-${index}`,
      title: `Conversation ${index}`,
      updatedAt: Date.now() - index,
      lastMessagePreview: `Preview ${index}`,
    }));
    mockStore.listConversations.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([
      {
        conversationId: 'conv-20',
        title: 'Conversation 20',
        updatedAt: Date.now() - 20,
        lastMessagePreview: 'Preview 20',
      },
    ]);
    mockGetConversationsPage
      .mockResolvedValueOnce({
        conversations: [],
        total: 21,
        limit: 20,
        offset: 0,
        has_more: true,
      })
      .mockResolvedValueOnce({
        conversations: [],
        total: 21,
        limit: 20,
        offset: 20,
        has_more: false,
      });

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Conversation 0')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(mockStore.listConversations).toHaveBeenLastCalledWith(20, 20);
      expect(screen.getByText('Conversation 20')).toBeTruthy();
    });
    expect(mockSearch.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-20', content: 'Preview 20' })
    );
  });

  it('keeps local pagination available when remote history reports no more pages', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      conversationId: `local-${index}`,
      title: `Local Conversation ${index}`,
      updatedAt: Date.now() - index,
      lastMessagePreview: `Local Preview ${index}`,
    }));
    mockStore.listConversations.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([
      {
        conversationId: 'local-20',
        title: 'Local Conversation 20',
        updatedAt: Date.now() - 20,
        lastMessagePreview: 'Local Preview 20',
      },
    ]);
    mockGetConversationsPage
      .mockResolvedValueOnce({
        conversations: [],
        total: 20,
        limit: 20,
        offset: 0,
        has_more: false,
      })
      .mockResolvedValueOnce({
        conversations: [],
        total: 20,
        limit: 20,
        offset: 20,
        has_more: false,
      });

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Local Conversation 0')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(mockStore.listConversations).toHaveBeenLastCalledWith(20, 20);
      expect(screen.getByText('Local Conversation 20')).toBeTruthy();
    });
  });

  it('repairs an empty first local page with one sync and then rereads local history', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    mockOptionalSync = {
      enabled: true,
      isOnline: true,
      sync,
      syncState: { lastSyncTime: 0, isSyncing: false },
    };
    mockStore.listConversations.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        conversationId: 'remote-42',
        title: 'Recovered History',
        updatedAt: Date.now(),
        lastMessagePreview: 'Recovered from sync',
      },
    ]);

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Recovered History')).toBeTruthy();
    });
    expect(sync).toHaveBeenCalledWith({ throwOnError: true });
    expect(mockStore.listConversations).toHaveBeenNthCalledWith(1, 20, 0);
    expect(mockStore.listConversations).toHaveBeenNthCalledWith(2, 20, 0);
  });

  it('backfills old remote conversations into local storage when sync still leaves cache empty', async () => {
    mockGetConversationsPage.mockResolvedValue({
      conversations: [
        {
          id: 99,
          timestamp: '2026-01-02T03:04:05.000Z',
          user_input: 'Old cloud prompt',
          result: 'Old cloud answer',
          execution_time: 2.4,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      has_more: false,
    });
    mockStore.listConversations.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        conversationId: 'remote-99',
        title: 'Old cloud prompt',
        updatedAt: Date.parse('2026-01-02T03:04:05.000Z'),
        lastMessagePreview: 'Old cloud answer',
      },
    ]);

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Old cloud prompt')).toBeTruthy();
    });
    expect(mockGetConversationsPage).toHaveBeenCalledWith(20, 0);
    expect(mockStore.ensureConversation).toHaveBeenCalledWith('remote-99', 'Old cloud prompt');
    expect(mockStore.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'remote-99',
        messageId: 'remote-99-user',
        role: 'user',
        content: 'Old cloud prompt',
      })
    );
    expect(mockStore.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'remote-99',
        messageId: 'remote-99-assistant',
        role: 'assistant',
        content: 'Old cloud answer',
      })
    );
  });

  it('does not backfill remote conversations before the auth token is ready', async () => {
    (useAuth as any).mockReturnValue({ isAuthenticated: true, isTokenReady: false });
    mockGetConversationsPage.mockResolvedValue({
      conversations: [],
      total: 0,
      limit: 20,
      offset: 0,
      has_more: false,
    });
    mockStore.listConversations.mockResolvedValue([]);

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('No conversations yet')).toBeTruthy();
    });
    expect(mockGetConversationsPage).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalledWith(
      'Failed to backfill local conversation cache from API',
      expect.anything()
    );
  });

  it('retries a remote page after a transient backfill failure', async () => {
    mockStore.listConversations.mockResolvedValue([]);
    mockGetConversationsPage
      .mockRejectedValueOnce(new Error('temporary API failure'))
      .mockResolvedValue({
        conversations: [],
        total: 0,
        limit: 20,
        offset: 0,
        has_more: false,
      });

    const view = render(<ConversationList />);

    await waitFor(() => expect(mockGetConversationsPage).toHaveBeenCalledTimes(1));
    (useAuth as any).mockReturnValue({ isAuthenticated: true, isTokenReady: false });
    view.rerender(<ConversationList />);
    (useAuth as any).mockReturnValue({ isAuthenticated: true, isTokenReady: true });
    view.rerender(<ConversationList />);

    await waitFor(() => expect(mockGetConversationsPage).toHaveBeenCalledTimes(2));
  });

  it('backfills remote history even when local storage already has recent conversations', async () => {
    mockGetConversationsPage.mockResolvedValue({
      conversations: [
        {
          id: 99,
          timestamp: '2026-01-02T03:04:05.000Z',
          user_input: 'Old cloud prompt',
          result: 'Old cloud answer',
          execution_time: 2.4,
        },
      ],
      total: 2,
      limit: 20,
      offset: 0,
      has_more: false,
    });
    mockStore.listConversations
      .mockResolvedValueOnce([
        {
          conversationId: 'local-recent',
          title: 'Recent local prompt',
          updatedAt: Date.parse('2026-06-01T00:00:00.000Z'),
          lastMessagePreview: 'Recent local answer',
        },
      ])
      .mockResolvedValueOnce([
        {
          conversationId: 'local-recent',
          title: 'Recent local prompt',
          updatedAt: Date.parse('2026-06-01T00:00:00.000Z'),
          lastMessagePreview: 'Recent local answer',
        },
        {
          conversationId: 'remote-99',
          title: 'Old cloud prompt',
          updatedAt: Date.parse('2026-01-02T03:04:05.000Z'),
          lastMessagePreview: 'Old cloud answer',
        },
      ]);

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Recent local prompt')).toBeTruthy();
      expect(screen.getByText('Old cloud prompt')).toBeTruthy();
    });
    expect(mockGetConversationsPage).toHaveBeenCalledWith(20, 0);
    expect(mockStore.ensureConversation).toHaveBeenCalledWith('remote-99', 'Old cloud prompt');
  });

  it('reloads local history after sync writes directly to storage', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    mockOptionalSync = {
      enabled: true,
      isOnline: true,
      sync,
      syncState: { lastSyncTime: 0, isSyncing: false },
    };
    mockStore.listConversations.mockResolvedValueOnce([
      {
        conversationId: 'local-before-sync',
        title: 'Before Sync',
        updatedAt: Date.now(),
      },
    ]);

    const { rerender } = render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Before Sync')).toBeTruthy();
    });

    mockOptionalSync = {
      enabled: true,
      isOnline: true,
      sync,
      syncState: { lastSyncTime: Date.now(), isSyncing: false },
    };
    mockStore.listConversations.mockResolvedValueOnce([
      {
        conversationId: 'remote-after-sync',
        title: 'After Sync',
        updatedAt: Date.now(),
      },
    ]);

    rerender(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('After Sync')).toBeTruthy();
    });
  });

  it('preserves the loaded conversation range after deleting from a loaded page', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      conversationId: `conv-${index}`,
      title: `Conversation ${index}`,
      updatedAt: Date.now() - index,
      lastMessagePreview: `Preview ${index}`,
    }));
    const loadedConversation = {
      conversationId: 'conv-20',
      title: 'Conversation 20',
      updatedAt: Date.now() - 20,
      lastMessagePreview: 'Preview 20',
    };
    const nextConversation = {
      conversationId: 'conv-21',
      title: 'Conversation 21',
      updatedAt: Date.now() - 21,
      lastMessagePreview: 'Preview 21',
    };
    mockStore.listConversations
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([loadedConversation])
      .mockResolvedValueOnce([...firstPage, nextConversation]);
    mockGetConversationsPage
      .mockResolvedValueOnce({
        conversations: [],
        total: 21,
        limit: 20,
        offset: 0,
        has_more: true,
      })
      .mockResolvedValueOnce({
        conversations: [],
        total: 21,
        limit: 20,
        offset: 20,
        has_more: false,
      });

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(screen.getByText('Conversation 20')).toBeTruthy();
    });

    const loadedItem = screen
      .getByText('Conversation 20')
      .closest('[data-testid="conversation-item"]');
    const deleteButton = loadedItem?.querySelector('[data-testid="delete-btn"]');
    if (!(deleteButton instanceof HTMLElement)) {
      throw new Error('Expected delete button for loaded conversation');
    }

    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockStore.clearConversation).toHaveBeenCalledWith('conv-20');
      expect(mockStore.listConversations).toHaveBeenLastCalledWith(21, 0);
      expect(screen.getByText('Conversation 21')).toBeTruthy();
    });
    expect(screen.queryByText('Conversation 20')).toBeNull();
  });

  it('resolves internal and external search results through local conversation tags', async () => {
    const localConvs = [
      { conversationId: 'conv-search', title: 'Search Target', updatedAt: Date.now() },
      { conversationId: 'conv-hidden', title: 'Hidden Target', updatedAt: Date.now() },
    ];
    mockStore.listConversations.mockResolvedValue(localConvs);
    mockSearch.search.mockReturnValue([
      { id: 'message-1', title: 'match', content: 'body', tags: ['missing', 'conv-search'] },
      { id: 'message-2', title: 'dupe', content: 'body', tags: ['conv-search'] },
    ]);

    render(<ConversationList searchQuery="target" />);

    await waitFor(() => {
      expect(mockSearch.search).toHaveBeenCalledWith('target');
      expect(screen.getByText('Search Target')).toBeTruthy();
    });
    expect(screen.queryByText('Hidden Target')).toBeNull();
  });

  it('tracks unread messages until the conversation is selected', async () => {
    let subscriber: any;
    const onSelect = vi.fn();
    mockStore.subscribe.mockImplementation((cb: any) => {
      subscriber = cb;
      return () => {};
    });
    mockStore.listConversations.mockResolvedValue([
      { conversationId: 'conv-active', title: 'Active Chat', updatedAt: Date.now() },
      { conversationId: 'conv-unread', title: 'Unread Chat', updatedAt: Date.now() },
    ]);

    render(<ConversationList onConversationSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Unread Chat')).toBeTruthy();
    });

    act(() => {
      subscriber({ type: 'messages-changed', conversationId: 'conv-unread' });
    });

    await waitFor(() => expect(screen.getByTestId('unread-marker')).toBeTruthy());

    fireEvent.click(screen.getAllByTestId('conversation-item')[1] as HTMLElement);

    await waitFor(() => expect(screen.queryByTestId('unread-marker')).toBeNull());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ model: 'conv-unread' }));
  });

  it('reloads conversations when store emits changes', async () => {
    let subscriber: any;
    mockStore.subscribe.mockImplementation((cb: any) => {
      subscriber = cb;
      return () => {};
    });

    render(<ConversationList />);

    await waitFor(() => {
      expect(mockStore.listConversations).toHaveBeenCalledTimes(1);
    });

    act(() => {
      subscriber({ type: 'conversations-changed' });
    });

    await waitFor(() => {
      expect(mockStore.listConversations).toHaveBeenCalledTimes(2);
    });
  });

  it('handles unauthenticated state', async () => {
    (useAuth as any).mockReturnValue({ isAuthenticated: false });
    render(<ConversationList />);
    await waitFor(() => {
      expect(screen.getByText('No conversations yet')).toBeTruthy();
    });
    expect(mockStore.listConversations).not.toHaveBeenCalled();
  });

  it('handles errors during load', async () => {
    mockStore.listConversations.mockRejectedValue(new Error('DB Error'));
    render(<ConversationList />);
    // Should not crash
    await waitFor(() => expect(screen.getByText('No conversations yet')).toBeTruthy());
  });
});
