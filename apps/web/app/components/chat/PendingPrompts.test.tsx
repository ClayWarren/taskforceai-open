import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import type {
  ConversationStoreEvent,
  PendingPromptRecord,
} from '../../lib/platform/platform-interfaces';

import '../../../../../tests/setup/dom';

// Mocks
const mockListPendingPrompts = mock();
const mockRemovePrompt = mock();
const mockSubscribe = mock<(listener: (event: ConversationStoreEvent) => void) => () => void>(
  () => () => {}
);
const mockLoggerError = mock();
const mockLoggerWarn = mock();

const mockStore = {
  listPendingPrompts: mockListPendingPrompts,
  removePrompt: mockRemovePrompt,
  subscribe: mockSubscribe,
};

mock.module('../../lib/platform/PlatformProvider', () => ({
  useConversationStore: () => mockStore,
}));

mock.module('../../lib/logger', () => ({
  logger: {
    error: mockLoggerError,
    warn: mockLoggerWarn,
  },
}));

const { default: PendingPrompts } = await import('./PendingPrompts');

describe('PendingPrompts', () => {
  const mockPrompts: PendingPromptRecord[] = [
    {
      id: 1,
      prompt: 'Hello world',
      status: 'queued',
      conversationId: 'c1',
      createdAt: Date.now(),
    },
    {
      id: 2,
      prompt: 'Processing request',
      status: 'pending',
      conversationId: 'c1',
      createdAt: Date.now(),
    },
    {
      id: 3,
      prompt: 'Failed request',
      status: 'failed',
      conversationId: 'c1',
      createdAt: Date.now(),
    },
  ];

  beforeEach(() => {
    mockListPendingPrompts.mockClear();
    mockRemovePrompt.mockClear();
    mockSubscribe.mockClear();
    mockLoggerError.mockClear();
    mockLoggerWarn.mockClear();
    mockListPendingPrompts.mockResolvedValue(mockPrompts);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when no pending prompts', async () => {
    mockListPendingPrompts.mockResolvedValue([]);

    const { container } = render(<PendingPrompts />);

    await waitFor(() => {
      expect(mockListPendingPrompts).toHaveBeenCalled();
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('renders summary correctly', async () => {
    render(<PendingPrompts />);

    await waitFor(() => {
      expect(screen.getByText(/1 message queued/)).toBeTruthy();
      expect(screen.getByText(/, 1 processing/)).toBeTruthy();
    });
  });

  it('shows failed count message', async () => {
    render(<PendingPrompts />);

    await waitFor(() => {
      expect(screen.getByText(/1 message failed to send/)).toBeTruthy();
    });
  });

  it('expands list on click', async () => {
    render(<PendingPrompts />);

    await waitFor(() => expect(screen.getByText(/1 message queued/)).toBeTruthy());

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(screen.getByText('Hello world')).toBeTruthy();
    expect(screen.getByText('Processing request')).toBeTruthy();
    expect(screen.getByText('Failed request')).toBeTruthy();
  });

  it('deletes a prompt', async () => {
    render(<PendingPrompts />);

    await waitFor(() => expect(screen.getByText(/1 message queued/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button'));

    const deleteButtons = screen.getAllByRole('button', { name: /Delete/ });
    const firstDelete = deleteButtons[0];
    if (!firstDelete) {
      throw new Error('Expected delete button');
    }
    fireEvent.click(firstDelete);

    expect(mockRemovePrompt).toHaveBeenCalledWith(1);

    await waitFor(() => {
      expect(mockListPendingPrompts).toHaveBeenCalledTimes(2); // Initial + Refresh
    });
  });

  it('refreshes when store updates', async () => {
    let callback: (event: ConversationStoreEvent) => void = () => {};
    mockSubscribe.mockImplementation((cb: (event: ConversationStoreEvent) => void) => {
      callback = cb;
      return () => {};
    });

    render(<PendingPrompts />);

    await waitFor(() => expect(mockListPendingPrompts).toHaveBeenCalledTimes(1));

    act(() => {
      callback({ type: 'pending-prompts-changed' });
    });

    await waitFor(() => {
      expect(mockListPendingPrompts).toHaveBeenCalledTimes(2);
    });
  });
});
