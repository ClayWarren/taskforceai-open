import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { localSearch } from '@taskforceai/client-runtime/local-search';

import '../../../../../tests/setup/dom';

const removeSearchItemMock = vi.fn();
const confirmDialogMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('../../lib/platform/confirm-dialog', () => ({
  confirmDialog: confirmDialogMock,
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: loggerErrorMock,
    warn: loggerWarnMock,
  },
}));

import { useConversationDeleteHandler } from './useConversationDeleteHandler';

describe('useConversationDeleteHandler', () => {
  const conversationStore = {
    clearConversation: vi.fn(),
    getConversationMessages: vi.fn(),
  };
  const reloadConversations = vi.fn();
  const localConversationLookup = { current: new Map<number, string>() };
  const localConversationReverseLookup = { current: new Map<string, number>() };

  beforeEach(() => {
    vi.clearAllMocks();
    localSearch.removeItem = removeSearchItemMock as typeof localSearch.removeItem;
    conversationStore.clearConversation.mockResolvedValue(undefined);
    conversationStore.getConversationMessages.mockResolvedValue([
      { messageId: 'message-1' },
      { messageId: '' },
      { messageId: 'message-2' },
    ]);
    removeSearchItemMock.mockImplementation(() => {});
    confirmDialogMock.mockResolvedValue(true);
    reloadConversations.mockResolvedValue(undefined);
    localConversationLookup.current = new Map([[42, 'local-42']]);
    localConversationReverseLookup.current = new Map([['local-42', 42]]);
  });

  const renderDeleteHandler = () =>
    renderHook(() =>
      useConversationDeleteHandler({
        conversationStore,
        localConversationLookup,
        localConversationReverseLookup,
        reloadConversations,
      })
    );

  it('clears a confirmed local conversation and removes message search entries', async () => {
    const { result } = renderDeleteHandler();

    await act(async () => {
      await result.current(42);
    });

    expect(confirmDialogMock).toHaveBeenCalledWith(
      'Are you sure you want to delete this conversation?',
      { kind: 'warning', title: 'Delete Conversation' }
    );
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith('local-42');
    expect(conversationStore.clearConversation).toHaveBeenCalledWith('local-42');
    expect(removeSearchItemMock).toHaveBeenCalledWith('message-1');
    expect(removeSearchItemMock).toHaveBeenCalledWith('message-2');
    expect(localConversationReverseLookup.current?.has('local-42')).toBe(false);
    expect(reloadConversations).toHaveBeenCalled();
  });

  it('does nothing when the id is invalid, confirmation is canceled, or mapping is missing', async () => {
    const { result } = renderDeleteHandler();

    await act(async () => {
      await result.current(Number.NaN);
    });
    expect(confirmDialogMock).not.toHaveBeenCalled();

    confirmDialogMock.mockResolvedValueOnce(false);
    await act(async () => {
      await result.current(42);
    });
    expect(conversationStore.clearConversation).not.toHaveBeenCalled();

    confirmDialogMock.mockResolvedValueOnce(true);
    await act(async () => {
      await result.current(7);
    });
    expect(conversationStore.clearConversation).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalled();
  });

  it('keeps the mapping when clearing the conversation fails', async () => {
    conversationStore.clearConversation.mockRejectedValueOnce(new Error('clear failed'));
    const { result } = renderDeleteHandler();

    await act(async () => {
      await result.current(42);
    });

    expect(removeSearchItemMock).not.toHaveBeenCalled();
    expect(localConversationReverseLookup.current?.get('local-42')).toBe(42);
    expect(reloadConversations).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});
