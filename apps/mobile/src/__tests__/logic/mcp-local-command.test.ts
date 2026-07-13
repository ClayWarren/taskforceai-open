import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const mockLoadStoredMobileMcpServers = mock(async () => [
  { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
]);
const mockUpsertMessage = mock(async () => {});

mock.module('../../mcp/store', () => ({
  loadStoredMobileMcpServers: mockLoadStoredMobileMcpServers,
}));

mock.module('../../storage/chat-local-mobile', () => ({
  upsertMessage: mockUpsertMessage,
}));

let handleMobileLocalMcpCommand: typeof import('../../mcp/local-command').handleMobileLocalMcpCommand;

describe('mobile local mcp command', () => {
  beforeAll(async () => {
    ({ handleMobileLocalMcpCommand } = await import('../../mcp/local-command'));
  });

  beforeEach(() => {
    mockLoadStoredMobileMcpServers.mockClear();
    mockUpsertMessage.mockClear();
  });

  it('returns false for non-mcp prompts', async () => {
    const handled = await handleMobileLocalMcpCommand({
      prompt: 'hello',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages: mock(() => {}),
    });

    expect(handled).toBe(false);
  });

  it('calls the configured mcp server and appends a local response', async () => {
    const callTool = mock(async () => ({
      content: [{ type: 'text', text: 'mobile result' }],
    }));
    const setMessages = mock((updater: (previous: unknown[]) => unknown[]) => updater([]));

    const handled = await handleMobileLocalMcpCommand({
      prompt: '/mcp call docs search {"query":"bun"}',
      manager: { callTool } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
    });

    expect(handled).toBe(true);
    expect(callTool).toHaveBeenCalledWith(
      { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
      'search',
      { query: 'bun' }
    );
    expect(setMessages).toHaveBeenCalled();
    expect(mockUpsertMessage).toHaveBeenCalled();
  });

  it('can append a private local response without durable persistence', async () => {
    const callTool = mock(async () => ({
      content: [{ type: 'text', text: 'private mobile result' }],
    }));
    const setMessages = mock((updater: (previous: unknown[]) => unknown[]) => updater([]));

    const handled = await handleMobileLocalMcpCommand({
      prompt: '/mcp call docs search {"query":"private"}',
      manager: { callTool } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      persistMessages: false,
    });

    expect(handled).toBe(true);
    expect(setMessages).toHaveBeenCalled();
    expect(mockUpsertMessage).not.toHaveBeenCalled();
  });
});
