import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Dispatch, SetStateAction } from 'react';

import '../../../../../tests/setup/dom';

const mockReadStoredWebMcpServers = mock(() => [
  { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
]);
const mockPersistWebMcpServers = mock((servers: unknown[]) => servers);
const mockCallDesktopMcpTool = mock(async () => ({
  content: [{ type: 'text', text: 'desktop result' }],
}));
const mockInvokeTauri = mock(async (command: string, args?: Record<string, any>) => {
  switch (command) {
    case 'app_server_enable_local_coding': {
      const resolvedWorkspace = args?.['params']?.workspace || '/tmp/default-workspace';
      return {
        workspace: resolvedWorkspace,
        serverName: 'workspace',
        serverNames: ['workspace'],
      };
    }
    case 'app_server_command_execute':
      return args?.['params']?.input?.startsWith('/code')
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
          };
    case 'desktop_browser_open': {
      const url = args?.['params']?.url ?? '';
      return {
        open: true,
        currentUrl: url.startsWith('http') ? url : `https://${url}`,
        message: 'Browser preview is open.',
      };
    }
    case 'desktop_browser_show':
      return {
        open: true,
        currentUrl: null,
        message: 'Browser preview is open.',
      };
    case 'desktop_computer_use_observe':
      return {
        path: '/tmp/taskforceai-screen-memory/screen.png',
        imageBase64: 'screen-frame',
        mediaType: 'image/png',
        byteLength: 12,
        message: 'Captured current screen.',
      };
    default:
      return undefined;
  }
});
const tauriCommands = (): string[] =>
  mockInvokeTauri.mock.calls.map(([command]) => command as string);

mock.module('./store', () => ({
  persistWebMcpServers: mockPersistWebMcpServers,
  readStoredWebMcpServers: mockReadStoredWebMcpServers,
}));

mock.module('../platform/desktop-api', () => ({
  callDesktopMcpTool: mockCallDesktopMcpTool,
  enableDesktopLocalCoding: (params: Record<string, unknown> = {}) =>
    mockInvokeTauri('app_server_enable_local_coding', { params }),
  executeDesktopAppServerCommand: (params: Record<string, unknown>) =>
    mockInvokeTauri('app_server_command_execute', { params }),
  observeDesktopComputerUse: () => mockInvokeTauri('desktop_computer_use_observe', undefined),
  openDesktopBrowserPreview: (params: Record<string, unknown>) =>
    mockInvokeTauri('desktop_browser_open', { params }),
  showDesktopBrowserPreview: () => mockInvokeTauri('desktop_browser_show', undefined),
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
    window.localStorage.clear();
    (
      window as unknown as { __TAURI_INTERNALS__?: { invoke: typeof mockInvokeTauri } }
    ).__TAURI_INTERNALS__ = { invoke: mockInvokeTauri };
    mockInvokeTauri.mockClear();
    mockReadStoredWebMcpServers.mockClear();
    mockReadStoredWebMcpServers.mockImplementation(() => [
      { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
    ]);
    mockPersistWebMcpServers.mockClear();
    mockCallDesktopMcpTool.mockClear();
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
    expect(mockInvokeTauri).toHaveBeenCalledWith('app_server_command_execute', {
      params: { input: '/status' },
    });
    expect(setMessages).toHaveBeenCalled();
    expect(upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Status\napp-server: local',
        isLocalCommandOutput: true,
      })
    );
  });

  it('opens natural-language browser URL requests in the desktop in-app browser', async () => {
    const setMessages = createSetMessages();
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt: 'can you pull up threejs.com in the in-app browser',
      runtime: 'desktop',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: true });
    expect(mockInvokeTauri).toHaveBeenCalledWith('desktop_browser_open', {
      params: { url: 'threejs.com' },
    });
    expect(tauriCommands()).not.toContain('app_server_command_execute');
    expect(upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Browser\nOpened https://threejs.com in the in-app browser.',
        isLocalCommandOutput: true,
      })
    );
  });

  it('shows the desktop in-app browser when no URL is requested', async () => {
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt: 'open the in-app browser',
      runtime: 'desktop',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages: createSetMessages(),
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: true });
    expect(mockInvokeTauri).toHaveBeenCalledWith('desktop_browser_show', undefined);
    expect(upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Browser\nIn-app browser is open.',
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
    expect(mockInvokeTauri).toHaveBeenCalledWith('app_server_enable_local_coding', {
      params: { workspace: '/tmp/project' },
    });
    expect(tauriCommands()).not.toContain('app_server_command_execute');
    expect(mockPersistWebMcpServers).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('taskforceai.desktop.code-workspace.v1')).toBe(
      '/tmp/project'
    );
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

    expect(tauriCommands()).not.toContain('app_server_enable_local_coding');
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

  it('ignores empty desktop prompts before local desktop actions', async () => {
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt: '   ',
      runtime: 'desktop',
      computerUseEnabled: true,
      computerUseTarget: 'local',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages: createSetMessages(),
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: false });
    expect(tauriCommands()).toEqual([]);
    expect(upsertMessage).not.toHaveBeenCalled();
  });

  it('captures the current screen for local computer use observation prompts', async () => {
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

    expect(result).toEqual({ handled: true });
    expect(mockInvokeTauri).toHaveBeenCalledWith('desktop_computer_use_observe', undefined);
    expect(mockCallDesktopMcpTool).not.toHaveBeenCalled();
    expect(upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Computer Use\nCaptured current screen.',
        isLocalCommandOutput: true,
        toolEvents: [
          expect.objectContaining({
            agentLabel: 'Local Computer Use',
            toolName: 'computer_use',
            arguments: { action: 'screenshot' },
            status: 'completed',
            success: true,
            image_base64: 'screen-frame',
          }),
        ],
      })
    );
  });

  it('does not intercept local computer use prompts when local target is not selected', async () => {
    const setMessages = createSetMessages();
    const upsertMessage = mock(async () => {});

    const result = await handleLocalMcpCommand({
      prompt:
        'Use local Computer Use on this screen: take a screenshot preview and report the cursor position.',
      runtime: 'desktop',
      computerUseEnabled: true,
      computerUseTarget: 'virtual',
      manager: { callTool: mock(async () => ({ content: [] })) } as never,
      ensureConversationId: async () => 'local-1',
      setMessages,
      conversationStore: { upsertMessage } as never,
    });

    expect(result).toEqual({ handled: false });
    expect(tauriCommands()).not.toContain('desktop_computer_use_observe');
    expect(mockCallDesktopMcpTool).not.toHaveBeenCalled();
    expect(upsertMessage).not.toHaveBeenCalled();
  });
});
