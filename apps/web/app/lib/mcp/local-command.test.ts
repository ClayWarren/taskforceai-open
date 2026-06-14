import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Dispatch, SetStateAction } from 'react';

const mockReadStoredWebMcpServers = mock(() => [
  { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
]);
const mockPersistWebMcpServers = mock((servers: unknown[]) => servers);
const mockCallDesktopMcpTool = mock(async () => ({
  content: [{ type: 'text', text: 'desktop result' }],
}));
const mockEnableDesktopLocalCoding = mock(async ({ workspace }: { workspace?: string } = {}) => {
  const resolvedWorkspace = workspace || '/tmp/default-workspace';
  return {
    workspace: resolvedWorkspace,
    serverName: 'workspace',
    serverNames: ['workspace'],
  };
});
const mockExecuteDesktopAppServerCommand = mock(async ({ input }: { input: string }) =>
  input.startsWith('/code')
    ? {
        handled: true,
        title: 'Code',
        message:
          'Workspace tools enabled for /tmp/project.\nUse explicit local workspace actions for file operations. Enabled MCP servers: workspace.',
      }
    : {
        handled: true,
        title: 'Status',
        message: 'app-server: local',
      }
);

mock.module('./store', () => ({
  persistWebMcpServers: mockPersistWebMcpServers,
  readStoredWebMcpServers: mockReadStoredWebMcpServers,
}));

mock.module('../platform/desktop/mcp', () => ({
  callDesktopMcpTool: mockCallDesktopMcpTool,
}));

mock.module('../platform/desktop/app-server', () => ({
  enableDesktopLocalCoding: mockEnableDesktopLocalCoding,
  executeDesktopAppServerCommand: mockExecuteDesktopAppServerCommand,
}));

import { handleLocalMcpCommand } from './local-command';

const createSetMessages = (): Dispatch<SetStateAction<import('../types').Message[]>> =>
  mock((value: SetStateAction<import('../types').Message[]>) => {
    if (typeof value === 'function') {
      return value([]);
    }
    return value;
  }) as Dispatch<SetStateAction<import('../types').Message[]>>;

describe('web local mcp command', () => {
  beforeEach(() => {
    mockReadStoredWebMcpServers.mockClear();
    mockReadStoredWebMcpServers.mockImplementation(() => [
      { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
    ]);
    mockPersistWebMcpServers.mockClear();
    mockCallDesktopMcpTool.mockClear();
    mockEnableDesktopLocalCoding.mockClear();
    mockExecuteDesktopAppServerCommand.mockClear();
  });

  it('returns false for non-mcp prompts', async () => {
    const handled = await handleLocalMcpCommand({
      prompt: 'hello',
      runtime: 'browser',
      manager: {
        callTool: mock(async () => ({ content: [] })),
      } as never,
      ensureConversationId: async () => 'local-1',
      setMessages: mock(() => {}),
      conversationStore: {
        upsertMessage: mock(async () => {}),
      } as never,
    });

    expect(handled).toEqual({ handled: false });
  });

  it('calls the browser manager and appends a local assistant message', async () => {
    const callTool = mock(async () => ({
      content: [{ type: 'text', text: 'browser result' }],
    }));
    const setMessages = createSetMessages();
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt: '/mcp call docs search {"query":"bun"}',
      runtime: 'browser',
      manager: { callTool } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: true });
    expect(callTool).toHaveBeenCalledWith(
      { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
      'search',
      { query: 'bun' }
    );
    expect(setMessages).toHaveBeenCalled();
    expect(upsertMessage).toHaveBeenCalled();
  });

  it('uses the desktop bridge in desktop runtime', async () => {
    const setMessages = createSetMessages();
    const upsertMessage = mock(async () => {});

    await handleLocalMcpCommand({
      prompt: '/mcp call docs search',
      runtime: 'desktop',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      conversationStore: { upsertMessage } as never,
    });

    expect(mockCallDesktopMcpTool).toHaveBeenCalledWith(
      { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
      'search',
      {}
    );
  });

  it('executes desktop slash commands through the app-server command handler', async () => {
    const setMessages = createSetMessages();
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt: '/status',
      runtime: 'desktop',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: true });
    expect(mockExecuteDesktopAppServerCommand).toHaveBeenCalledWith({ input: '/status' });
    expect(setMessages).toHaveBeenCalled();
    expect(upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Status\napp-server: local',
        isLocalCommandOutput: true,
      })
    );
  });

  it('enables desktop local coding tools with /code', async () => {
    const setMessages = createSetMessages();
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt: '/code /tmp/project',
      runtime: 'desktop',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: true });
    expect(mockEnableDesktopLocalCoding).toHaveBeenCalledWith({ workspace: '/tmp/project' });
    expect(mockExecuteDesktopAppServerCommand).not.toHaveBeenCalled();
    expect(mockPersistWebMcpServers).not.toHaveBeenCalled();
    expect(upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'Code\nWorkspace tools enabled for /tmp/project.\nUse explicit local workspace actions for file operations. Enabled MCP servers: workspace.',
        isLocalCommandOutput: true,
      })
    );
  });

  it('requires an explicit desktop workspace when /code has no path', async () => {
    const upsertMessage = mock(async () => {});

    await handleLocalMcpCommand({
      prompt: '/code',
      runtime: 'desktop',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages: createSetMessages(),
      conversationStore: { upsertMessage } as never,
    });

    expect(mockEnableDesktopLocalCoding).not.toHaveBeenCalled();
    expect(upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Code\nUsage: /code <project-directory>',
        isLocalCommandOutput: true,
      })
    );
  });

  it('does not intercept normal local coding prompts with a demo-specific flow', async () => {
    mockReadStoredWebMcpServers.mockImplementation(() => [
      {
        name: 'workspace',
        endpoint: 'stdio:bunx @modelcontextprotocol/server-filesystem "/tmp/project"',
        enabled: true,
      },
    ]);
    const setMessages = createSetMessages();
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt:
        'In the local coding workspace, create a folder named demo, add a file called demo/notes.txt with two short lines, read it back, then edit the file to add a final line that says Edited after readback. Show me what changed.',
      runtime: 'desktop',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: false });
    expect(mockCallDesktopMcpTool).not.toHaveBeenCalled();
    expect(upsertMessage).not.toHaveBeenCalled();
  });

  it('does not auto-run local computer use prompts through a privileged MCP shortcut', async () => {
    const setMessages = createSetMessages();
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt: 'Use local Computer Use to take a screenshot of my screen and report the cursor.',
      runtime: 'desktop',
      computerUseEnabled: true,
      computerUseTarget: 'local',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: false });
    expect(mockCallDesktopMcpTool).not.toHaveBeenCalled();
    expect(upsertMessage).not.toHaveBeenCalled();
  });

  it('does not intercept visible Computer Use demo prompts', async () => {
    const setMessages = createSetMessages();
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt:
        'Use local Computer Use on this screen: take a screenshot preview and report the cursor position.',
      runtime: 'desktop',
      computerUseEnabled: true,
      computerUseTarget: 'local',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: false });
    expect(mockCallDesktopMcpTool).not.toHaveBeenCalled();
    expect(upsertMessage).not.toHaveBeenCalled();
  });
});
