import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import type { ComponentProps } from 'react';

import '../../../../../tests/setup/dom';
import { QuickSearchDialog } from './QuickSearchDialog';
import type { ConversationRecord } from '../../lib/platform/platform-interfaces';

// Mock conversation store
const mockListConversations = vi.fn<() => Promise<ConversationRecord[]>>(async () => []);
const mockUseConversationStore = vi.fn(() => ({
  listConversations: mockListConversations,
}));

vi.mock('../../lib/platform/PlatformProvider', () => ({
  useConversationStore: mockUseConversationStore,
}));

const mockRecords: ConversationRecord[] = [
  {
    conversationId: '1',
    title: 'Conversation 1',
    updatedAt: Date.now(),
    lastMessagePreview: 'Preview 1',
    createdAt: Date.now(),
  },
  {
    conversationId: '2',
    title: 'Conversation 2',
    updatedAt: Date.now() - 86400000,
    lastMessagePreview: 'Preview 2',
    createdAt: Date.now() - 86400000,
  },
];

describe('QuickSearchDialog', () => {
  beforeEach(() => {
    mockListConversations.mockClear();
    mockListConversations.mockResolvedValue(mockRecords);
  });

  afterEach(() => {
    cleanup();
  });

  const renderDialog = (props: Partial<ComponentProps<typeof QuickSearchDialog>> = {}) =>
    render(
      <QuickSearchDialog
        isOpen={true}
        isAuthenticated={true}
        onClose={() => {}}
        onNewChat={() => {}}
        onSelect={() => {}}
        {...props}
      />
    );

  test('renders nothing when closed', () => {
    renderDialog({ isOpen: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('renders dialog when open and loads conversations', async () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search conversations…')).toBeTruthy();

    // Initially loading
    expect(screen.getByText('Loading conversations…')).toBeTruthy();

    await waitFor(() => {
      expect(mockListConversations).toHaveBeenCalled();
      expect(screen.getByText('Conversation 1')).toBeTruthy();
    });
  });

  test('handles load failures without crashing', async () => {
    mockListConversations.mockRejectedValue(new Error('storage unavailable'));
    renderDialog();

    await waitFor(() => {
      expect(mockListConversations).toHaveBeenCalled();
      expect(screen.getByText('No matching conversations')).toBeTruthy();
    });
  });

  test('filters conversations based on query', async () => {
    const user = userEvent.setup();
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Conversation 1')).toBeTruthy();
    });

    const input = screen.getByPlaceholderText('Search conversations…');
    await user.type(input, 'Conversation 2');

    await waitFor(() => {
      expect(screen.queryByText('Conversation 1')).toBeNull();
      expect(screen.getByText('Conversation 2')).toBeTruthy();
    });
  });

  test('handles new chat action', async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    const onClose = vi.fn();

    renderDialog({ onClose, onNewChat });

    const button = screen.getByText('Create New Private Chat');
    await user.click(button);

    expect(onNewChat).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('handles conversation selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    renderDialog({ onSelect });

    await waitFor(() => {
      expect(screen.getByText('Conversation 1')).toBeTruthy();
    });

    await user.click(screen.getByText('Conversation 1'));

    expect(onSelect).toHaveBeenCalledWith(mockRecords[0]);
    // Also checks if preview section updates
    expect(screen.getByText('Conversation preview')).toBeTruthy();
  });

  test('closes on close button click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderDialog({ onClose });

    await user.click(screen.getByLabelText('Close search overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  test('closes on overlay click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog({ onClose });

    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  test('does not close on panel click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog({ onClose });

    // Click inside the panel (e.g. on input)
    await user.click(screen.getByPlaceholderText('Search conversations…'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
