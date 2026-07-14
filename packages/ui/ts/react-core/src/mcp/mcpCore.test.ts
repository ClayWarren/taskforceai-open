import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../../tests/setup/dom';

import {
  appendLocalAssistantMessage,
  formatMcpToolResult,
  handleLocalMcpCommandCore,
} from './mcpLocalCommand';

import { formatMcpInventorySummary, loadAvailableMcpTools } from './mcpInventory';
import { SharedMcpManager, type McpClientLike, type McpServerConfig } from './mcpManager';
import {
  SharedMcpToolRegistry,
  type SharedMcpRegistrySnapshot,
  useSharedMcpToolCatalog,
} from './mcpRegistry';
import {
  normalizeMcpServers,
  parseStoredMcpServers,
  persistStoredMcpServers,
  readStoredMcpServers,
  serializeStoredMcpServers,
} from './mcpStore';

type TestEndpoint = { url: URL };

const mcpTool = (serverName: string, toolName: string) => ({
  source: 'mcp' as const,
  serverName,
  toolName,
  title: toolName,
  description: `${serverName} ${toolName}`,
});

const server = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  name: 'docs',
  endpoint: 'https://mcp.example/sse',
  enabled: true,
  ...overrides,
});

const createClient = (overrides: Partial<McpClientLike> = {}): McpClientLike => ({
  callTool: vi.fn(async () => ({ ok: true })),
  close: vi.fn(async () => undefined),
  getInstructions: vi.fn(() => ' use wisely '),
  getServerCapabilities: vi.fn(() => ({ tools: true, prompts: true, resources: true })),
  getServerVersion: vi.fn(() => ({ name: ' docs-server ', version: ' 1.0.0 ' })),
  listPrompts: vi.fn(async (params?: { cursor: string }) =>
    params?.cursor
      ? { prompts: [{ name: 'second-prompt', title: null, description: ' second ' }] }
      : {
          prompts: [{ name: 'first-prompt', title: ' First ', description: null }],
          nextCursor: 'prompt-page-2',
        }
  ),
  listResources: vi.fn(async (params?: { cursor: string }) =>
    params?.cursor
      ? {
          resources: [
            {
              name: 'second-resource',
              title: ' Resource ',
              description: null,
              uri: 'file://second',
              mimeType: null,
            },
          ],
        }
      : {
          resources: [
            {
              name: 'first-resource',
              title: null,
              description: ' First ',
              uri: 'file://first',
              mimeType: ' text/plain ',
            },
          ],
          nextCursor: 'resource-page-2',
        }
  ),
  listTools: vi.fn(async (params?: { cursor: string }) =>
    params?.cursor
      ? { tools: [{ name: 'second-tool', title: null, description: ' second ' }] }
      : {
          tools: [{ name: 'first-tool', title: ' First ', description: null }],
          nextCursor: 'tool-page-2',
        }
  ),
  ...overrides,
});

const createManager = (
  connect = vi.fn(async () => ({
    client: createClient(),
    transport: { close: vi.fn(async (): Promise<void> => {}) },
  }))
) =>
  new SharedMcpManager({
    connect,
    parseEndpoint: (rawEndpoint) => ({ url: new URL(rawEndpoint) }),
    getSnapshotExtra: (session) => ({ endpointHost: session.endpoint.url.host }),
  });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SharedMcpManager', () => {
  it('discovers paginated tools, prompts, resources, server metadata, and snapshot extras', async () => {
    const client = createClient();
    const connect = vi.fn(async () => ({
      client,
      transport: { close: vi.fn(async () => undefined) },
    }));
    const manager = createManager(connect);

    const snapshot = await manager.discover(server());

    expect(connect).toHaveBeenCalledWith('https://mcp.example/sse');
    expect(snapshot).toEqual({
      name: 'docs',
      endpoint: 'https://mcp.example/sse',
      serverName: 'docs-server',
      serverVersion: '1.0.0',
      instructions: 'use wisely',
      endpointHost: 'mcp.example',
      tools: [
        { name: 'first-tool', title: 'First', description: '' },
        { name: 'second-tool', title: '', description: 'second' },
      ],
      prompts: [
        { name: 'first-prompt', title: 'First', description: '' },
        { name: 'second-prompt', title: '', description: 'second' },
      ],
      resources: [
        {
          name: 'first-resource',
          title: '',
          description: 'First',
          uri: 'file://first',
          mimeType: 'text/plain',
        },
        {
          name: 'second-resource',
          title: 'Resource',
          description: '',
          uri: 'file://second',
          mimeType: '',
        },
      ],
    });
  });

  it('rejects MCP pagination when cursors do not advance', async () => {
    const client = createClient({
      listTools: vi.fn(async () => ({
        tools: [{ name: 'loop', title: null, description: null }],
        nextCursor: 'same',
      })),
    });
    const manager = createManager(
      vi.fn(async () => ({ client, transport: { close: vi.fn(async () => undefined) } }))
    );

    await expect(manager.discover(server())).rejects.toThrow(
      'MCP pagination cursor did not advance'
    );
    expect(client.listTools).toHaveBeenCalledTimes(2);
  });

  it('rejects MCP pagination after the maximum page count', async () => {
    let page = 0;
    const client = createClient({
      listTools: vi.fn(async () => {
        page += 1;
        return {
          tools: [{ name: `tool-${page}`, title: null, description: null }],
          nextCursor: `page-${page}`,
        };
      }),
    });
    const manager = createManager(
      vi.fn(async () => ({ client, transport: { close: vi.fn(async () => undefined) } }))
    );

    await expect(manager.discover(server())).rejects.toThrow(
      'MCP pagination exceeded maximum page count'
    );
    expect(client.listTools).toHaveBeenCalledTimes(20);
  });

  it('reuses matching sessions and reconnects when the endpoint changes', async () => {
    const firstClient = createClient();
    const secondClient = createClient();
    const firstTransport = { close: vi.fn(async () => undefined) };
    const secondTransport = { close: vi.fn(async () => undefined) };
    const connect = vi
      .fn()
      .mockResolvedValueOnce({ client: firstClient, transport: firstTransport })
      .mockResolvedValueOnce({ client: secondClient, transport: secondTransport });
    const manager = createManager(connect);

    await manager.callTool(server({ name: ' Docs ' }), ' lookup ', { query: 'one' });
    await manager.callTool(server({ name: 'docs' }), 'lookup', { query: 'two' });
    await manager.callTool(server({ endpoint: 'https://other.example/sse' }), 'lookup');

    expect(connect).toHaveBeenCalledTimes(2);
    expect(firstClient.callTool).toHaveBeenNthCalledWith(1, {
      name: 'lookup',
      arguments: { query: 'one' },
    });
    expect(firstClient.callTool).toHaveBeenNthCalledWith(2, {
      name: 'lookup',
      arguments: { query: 'two' },
    });
    expect(firstClient.close).toHaveBeenCalledTimes(1);
    expect(firstTransport.close).toHaveBeenCalledTimes(1);
    expect(secondClient.callTool).toHaveBeenCalledWith({ name: 'lookup', arguments: {} });
  });

  it('deduplicates concurrent connection attempts for the same server', async () => {
    const client = createClient();
    const transport = { close: vi.fn(async () => undefined) };
    const pendingConnection = deferred<{ client: McpClientLike; transport: typeof transport }>();
    const connect = vi.fn(() => pendingConnection.promise);
    const manager = createManager(connect);

    const discoveryPromise = manager.discover(server());
    const callPromise = manager.callTool(server(), 'lookup', { query: 'same' });

    await waitFor(() => {
      expect(connect).toHaveBeenCalledTimes(1);
    });

    pendingConnection.resolve({ client, transport });

    await discoveryPromise;
    await callPromise;

    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.callTool).toHaveBeenCalledWith({
      name: 'lookup',
      arguments: { query: 'same' },
    });
  });

  it('closes a pending connection exactly once when closeAll supersedes it', async () => {
    const client = createClient();
    const transport = { close: vi.fn(async () => undefined) };
    const pendingConnection = deferred<{ client: McpClientLike; transport: typeof transport }>();
    const manager = createManager(vi.fn(() => pendingConnection.promise));

    const discoveryPromise = manager.discover(server());
    const discoveryResult = discoveryPromise.catch((error: unknown) => error);
    const closePromise = manager.closeAll();

    pendingConnection.resolve({ client, transport });
    const [discoveryError] = await Promise.all([discoveryResult, closePromise]);

    expect(discoveryError).toBeInstanceOf(Error);
    expect((discoveryError as Error).message).toContain('connection was superseded');
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid server and tool inputs', async () => {
    const manager = createManager();

    await expect(manager.discover(server({ name: ' ' }))).rejects.toThrow(
      'MCP server name is required.'
    );
    await expect(manager.discover(server({ enabled: false }))).rejects.toThrow(
      'MCP server docs is disabled.'
    );
    await expect(manager.callTool(server(), ' ')).rejects.toThrow('Tool name is required.');
  });

  it('closes named sessions and all active sessions', async () => {
    const clientA = createClient();
    const clientB = createClient();
    const transportA = { close: vi.fn(async () => undefined) };
    const transportB = { close: vi.fn(async () => undefined) };
    const connect = vi
      .fn()
      .mockResolvedValueOnce({ client: clientA, transport: transportA })
      .mockResolvedValueOnce({ client: clientB, transport: transportB });
    const manager = createManager(connect);

    await manager.discover(server({ name: 'a' }));
    await manager.discover(server({ name: 'b', endpoint: 'https://b.example/sse' }));
    await manager.close(' A ');
    await manager.close(' ');
    await manager.closeAll();

    expect(clientA.close).toHaveBeenCalledTimes(1);
    expect(clientB.close).toHaveBeenCalledTimes(1);
    expect(transportA.close).toHaveBeenCalledTimes(1);
    expect(transportB.close).toHaveBeenCalledTimes(1);
  });

  it('skips capability listing when the server does not advertise capabilities', async () => {
    const client = createClient({
      getInstructions: vi.fn(() => undefined),
      getServerCapabilities: vi.fn(() => undefined),
      getServerVersion: vi.fn(() => undefined),
    });
    const manager = createManager(
      vi.fn(async () => ({ client, transport: { close: vi.fn(async () => undefined) } }))
    );

    const snapshot = await manager.discover(server());

    expect(snapshot.tools).toEqual([]);
    expect(snapshot.prompts).toEqual([]);
    expect(snapshot.resources).toEqual([]);
    expect(snapshot.serverName).toBe('');
    expect(snapshot.serverVersion).toBe('');
    expect(snapshot.instructions).toBe('');
    expect(client.listTools).not.toHaveBeenCalled();
  });

  it('uses a custom endpoint matcher before deciding whether to reconnect', async () => {
    const client = createClient();
    const isEndpointMatch = vi.fn(
      (left: TestEndpoint, right: TestEndpoint) => left.url.host === right.url.host
    );
    const connect = vi.fn(async () => ({
      client,
      transport: { close: vi.fn(async () => undefined) },
    }));
    const manager = new SharedMcpManager<TestEndpoint>({
      connect,
      parseEndpoint: (rawEndpoint) => ({ url: new URL(rawEndpoint) }),
      isEndpointMatch,
    });

    await manager.discover(server());
    await manager.discover(server());

    expect(isEndpointMatch).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('MCP inventory and store helpers', () => {
  it('normalizes server entries by trimming names and endpoints and keeping the last duplicate', () => {
    expect(
      normalizeMcpServers([
        server({ name: ' Docs ', endpoint: ' https://one.example/sse ' }),
        server({ name: 'docs', endpoint: 'https://two.example/sse', enabled: false }),
        server({ name: '', endpoint: 'https://missing-name.example/sse' }),
        server({ name: 'missing-endpoint', endpoint: ' ' }),
      ])
    ).toEqual([server({ name: 'docs', endpoint: 'https://two.example/sse', enabled: false })]);
  });

  it('parses, serializes, reads, and persists stored MCP server entries', async () => {
    const normalized = [server({ name: 'Docs', endpoint: 'https://docs.example/sse' })];
    const raw = JSON.stringify([
      server({ name: ' Docs ', endpoint: ' https://docs.example/sse ' }),
      server({ name: '', endpoint: 'https://skip.example/sse' }),
    ]);

    expect(parseStoredMcpServers(raw)).toEqual(normalized);
    expect(parseStoredMcpServers(null)).toEqual([]);
    expect(parseStoredMcpServers('{"bad":true}')).toEqual([]);
    expect(serializeStoredMcpServers(normalized)).toBe(JSON.stringify(normalized));
    expect(serializeStoredMcpServers([server({ name: '', endpoint: '' })])).toBeNull();

    const write = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const notify = vi.fn();

    await expect(readStoredMcpServers({ read: async () => raw })).resolves.toEqual(normalized);
    await expect(persistStoredMcpServers({ write, remove, notify }, normalized)).resolves.toEqual(
      normalized
    );
    expect(write).toHaveBeenCalledWith(JSON.stringify(normalized));
    expect(notify).toHaveBeenCalledTimes(1);

    await expect(persistStoredMcpServers({ write, remove, notify }, [])).resolves.toEqual([]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('returns safe MCP store fallbacks and reports adapter failures', async () => {
    const onReadError = vi.fn();
    const onWriteError = vi.fn();

    await expect(
      readStoredMcpServers({
        read: async () => {
          throw new Error('read failed');
        },
        onReadError,
      })
    ).resolves.toEqual([]);
    expect(onReadError).toHaveBeenCalledTimes(1);

    const servers = [server()];
    const writeError = new Error('write failed');
    await expect(
      persistStoredMcpServers(
        {
          write: async () => {
            throw writeError;
          },
          remove: async () => undefined,
          onWriteError,
        },
        servers
      )
    ).rejects.toBe(writeError);
    expect(onWriteError).toHaveBeenCalledWith(writeError, 1);
  });

  it('loads enabled MCP tools, ignores failed inspections, sorts descriptors, and formats summaries', async () => {
    const summary = await loadAvailableMcpTools(
      () => [
        server({ name: 'zeta' }),
        server({ name: 'alpha', endpoint: 'https://alpha.example/sse' }),
        server({ name: 'disabled', enabled: false }),
      ],
      async (config) => {
        if (config.name === 'zeta') {
          throw new Error('offline');
        }
        return {
          tools: [
            { name: 'write', title: ' Write ', description: ' Writes ' },
            { name: 'read', title: ' Read ', description: ' Reads ' },
          ],
        };
      }
    );

    expect(summary).toEqual({
      serverCount: 2,
      toolCount: 2,
      items: [
        {
          source: 'mcp',
          serverName: 'alpha',
          toolName: 'read',
          title: 'Read',
          description: 'Reads',
        },
        {
          source: 'mcp',
          serverName: 'alpha',
          toolName: 'write',
          title: 'Write',
          description: 'Writes',
        },
      ],
    });
    expect(formatMcpInventorySummary(summary)).toBe('MCP tools available: 2 across 2 servers.');
    expect(formatMcpInventorySummary({ serverCount: 0, toolCount: 0, items: [] })).toBeNull();
  });

  it('returns an empty inventory when no servers are enabled', async () => {
    const inspectServer = vi.fn();

    await expect(
      loadAvailableMcpTools(() => [server({ enabled: false })], inspectServer)
    ).resolves.toEqual({ serverCount: 0, toolCount: 0, items: [] });
    expect(inspectServer).not.toHaveBeenCalled();
  });
});

describe('SharedMcpToolRegistry', () => {
  it('starts empty and maps inventory items on refresh by default', async () => {
    const registry = new SharedMcpToolRegistry({
      loadInventory: async () => ({
        serverCount: 1,
        toolCount: 1,
        items: [mcpTool('docs', 'lookup')],
      }),
    });

    expect(registry.getSnapshot()).toEqual({ toolSummary: null, items: [] });
    await expect(registry.refresh()).resolves.toEqual({
      toolSummary: null,
      items: [mcpTool('docs', 'lookup')],
    });
  });

  it('emits the initial snapshot, refresh snapshots, and stops unsubscribed listeners', async () => {
    const listener = vi.fn();
    const loadInventory = vi.fn(async () => ({
      serverCount: 1,
      toolCount: 1,
      items: [mcpTool('docs', 'lookup')],
    }));
    const registry = new SharedMcpToolRegistry({
      loadInventory,
      buildSnapshot: (inventory) => ({
        toolSummary: `count:${inventory.toolCount}`,
        items: inventory.items,
      }),
    });

    const unsubscribe = registry.subscribe(listener);
    const refreshed = await registry.refresh();
    unsubscribe();
    await registry.refresh();

    expect(listener).toHaveBeenNthCalledWith(1, { toolSummary: null, items: [] });
    expect(listener).toHaveBeenNthCalledWith(2, {
      toolSummary: 'count:1',
      items: [mcpTool('docs', 'lookup')],
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(refreshed).toEqual(registry.getSnapshot());
  });

  it('uses caller-provided initial snapshots and the default inventory mapper', async () => {
    const initialSnapshot: SharedMcpRegistrySnapshot = {
      toolSummary: 'warm',
      items: [mcpTool('initial', 'cached')],
    };
    const registry = new SharedMcpToolRegistry({
      initialSnapshot,
      loadInventory: async () => ({
        serverCount: 1,
        toolCount: 1,
        items: [mcpTool('docs', 'lookup')],
      }),
    });

    expect(registry.getSnapshot()).toEqual(initialSnapshot);
    const refreshed = await registry.refresh();
    expect(refreshed).toEqual({
      toolSummary: null,
      items: [mcpTool('docs', 'lookup')],
    });
  });

  it('notifies every subscribed listener when the snapshot refreshes', async () => {
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const registry = new SharedMcpToolRegistry({
      loadInventory: async () => ({
        serverCount: 2,
        toolCount: 2,
        items: [mcpTool('docs', 'lookup'), mcpTool('docs', 'search')],
      }),
    });

    registry.subscribe(firstListener);
    registry.subscribe(secondListener);
    await registry.refresh();

    expect(firstListener).toHaveBeenLastCalledWith({
      toolSummary: null,
      items: [mcpTool('docs', 'lookup'), mcpTool('docs', 'search')],
    });
    expect(secondListener).toHaveBeenLastCalledWith(firstListener.mock.lastCall?.[0]);
  });

  it('keeps the newest snapshot when refreshes resolve out of order', async () => {
    const stale = deferred<{ serverCount: number; toolCount: number; items: any[] }>();
    const fresh = deferred<{ serverCount: number; toolCount: number; items: any[] }>();
    const listener = vi.fn();
    const registry = new SharedMcpToolRegistry({
      loadInventory: vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise),
    });

    registry.subscribe(listener);

    const staleRefresh = registry.refresh();
    const freshRefresh = registry.refresh();

    fresh.resolve({
      serverCount: 1,
      toolCount: 1,
      items: [mcpTool('fresh', 'lookup')],
    });
    await expect(freshRefresh).resolves.toEqual({
      toolSummary: null,
      items: [mcpTool('fresh', 'lookup')],
    });

    stale.resolve({
      serverCount: 1,
      toolCount: 1,
      items: [mcpTool('stale', 'lookup')],
    });
    await expect(staleRefresh).resolves.toEqual({
      toolSummary: null,
      items: [mcpTool('stale', 'lookup')],
    });

    expect(registry.getSnapshot()).toEqual({
      toolSummary: null,
      items: [mcpTool('fresh', 'lookup')],
    });
    expect(listener).toHaveBeenLastCalledWith(registry.getSnapshot());
  });

  it('wires manager lifecycle, registry refresh, and binding through the React hook', async () => {
    const closeAll = vi.fn(async () => undefined);
    const unbind = vi.fn();
    let activeListener: ((snapshot: { toolSummary: string | null; items: [] }) => void) | null =
      null;
    const registry = {
      subscribe: vi.fn(
        (listener: (snapshot: { toolSummary: string | null; items: [] }) => void) => {
          activeListener = listener;
          listener({ toolSummary: 'initial', items: [] });
          return vi.fn();
        }
      ),
      refresh: vi.fn(async () => {
        activeListener?.({ toolSummary: 'refreshed', items: [] });
      }),
    };
    const manager = { closeAll };
    const createHookManager = vi.fn(() => manager);
    const createRegistry = vi.fn(() => registry);
    const bindRegistry = vi.fn(() => unbind);

    const { result, unmount } = renderHook(() =>
      useSharedMcpToolCatalog(createHookManager, createRegistry, bindRegistry)
    );

    await waitFor(() => expect(result.current.snapshot.toolSummary).toBe('refreshed'));
    unmount();

    expect(result.current.manager.closeAll).toBe(closeAll);
    expect(createHookManager).toHaveBeenCalledTimes(1);
    expect(createRegistry).toHaveBeenCalledWith(manager);
    expect(bindRegistry).toHaveBeenCalledWith(registry);
    expect(registry.subscribe).toHaveBeenCalledTimes(1);
    expect(registry.refresh).toHaveBeenCalledTimes(1);
    expect(unbind).toHaveBeenCalledTimes(1);
    expect(closeAll).toHaveBeenCalledTimes(1);
  });

  it('supports hooks without an external registry unbind callback', async () => {
    const closeAll = vi.fn(async () => undefined);
    const registry = {
      subscribe: vi.fn(
        (listener: (snapshot: { toolSummary: string | null; items: [] }) => void) => {
          listener({ toolSummary: 'initial', items: [] });
          return vi.fn();
        }
      ),
      refresh: vi.fn(async () => undefined),
    };
    const manager = { closeAll };
    const mockCreateManager = vi.fn(() => manager);
    const createRegistry = vi.fn(() => registry);
    const bindRegistry = vi.fn(() => null);

    const { unmount } = renderHook(() =>
      useSharedMcpToolCatalog(mockCreateManager, createRegistry, bindRegistry)
    );

    await waitFor(() => expect(registry.refresh).toHaveBeenCalledTimes(1));
    unmount();

    expect(closeAll).toHaveBeenCalledTimes(1);
    expect(registry.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe('MCP local command helpers', () => {
  it('formats common MCP tool result shapes', () => {
    expect(formatMcpToolResult(null)).toBe('MCP tool returned no result.');
    expect(
      formatMcpToolResult({
        content: [
          null,
          { type: 'text', text: ' first ' },
          { type: 'image', data: 'ignored' },
          { type: 'text', text: 'second' },
        ],
      })
    ).toBe('first\n\nsecond');
    expect(formatMcpToolResult({ structuredContent: { ok: true } })).toBe(
      JSON.stringify({ ok: true }, null, 2)
    );
    expect(formatMcpToolResult({ content: [{ type: 'image', data: 'abc' }] })).toBe(
      JSON.stringify([{ type: 'image', data: 'abc' }], null, 2)
    );
    expect(formatMcpToolResult({ ok: true })).toBe(JSON.stringify({ ok: true }, null, 2));
  });

  it('appends and persists a local assistant message', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const persistMessage = vi.fn(async () => undefined);
    let messages: unknown[] = [];

    await appendLocalAssistantMessage(
      {
        ensureConversationId: vi.fn(async () => 'conversation-1'),
        setMessages: (updater) => {
          messages = typeof updater === 'function' ? updater(messages as never) : updater;
        },
        persistMessage,
      },
      'Tool result'
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: 'Tool result',
      sources: [],
      toolEvents: [],
      createdAt: 1234,
      updatedAt: 1234,
    });
    expect(persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        role: 'assistant',
        content: 'Tool result',
        isStreaming: false,
        createdAt: 1234,
        updatedAt: 1234,
      })
    );
  });

  it('marks appended local assistant messages as local command output when requested', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5678);
    const persistMessage = vi.fn(async () => undefined);
    let messages: unknown[] = [];

    await appendLocalAssistantMessage(
      {
        ensureConversationId: vi.fn(async () => 'conversation-2'),
        setMessages: (updater) => {
          messages = typeof updater === 'function' ? updater(messages as never) : updater;
        },
        persistMessage,
      },
      'Local command result',
      { isLocalCommandOutput: true }
    );

    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: 'Local command result',
      isLocalCommandOutput: true,
    });
    expect(persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-2',
        isLocalCommandOutput: true,
      })
    );
  });

  it('handles local MCP slash commands and appends failures as assistant messages', async () => {
    const appendAssistantMessage = vi.fn(async () => undefined);
    const resolveServer = vi.fn(async () => server());
    const executeTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));

    await expect(
      handleLocalMcpCommandCore({
        prompt: 'regular prompt',
        resolveServer,
        executeTool,
        appendAssistantMessage,
      })
    ).resolves.toEqual({ handled: false });

    await expect(
      handleLocalMcpCommandCore({
        prompt: '/mcp call docs lookup {"query":"sync"}',
        resolveServer,
        executeTool,
        appendAssistantMessage,
      })
    ).resolves.toEqual({ handled: true });

    await expect(
      handleLocalMcpCommandCore({
        prompt: '/mcp call docs lookup {}',
        attachmentIds: ['attachment-1'],
        resolveServer,
        executeTool,
        appendAssistantMessage,
      })
    ).resolves.toEqual({ handled: true });

    expect(resolveServer).toHaveBeenCalledWith('docs');
    expect(executeTool).toHaveBeenCalledWith(server(), 'lookup', { query: 'sync' });
    expect(appendAssistantMessage).toHaveBeenNthCalledWith(1, 'ok');
    expect(appendAssistantMessage).toHaveBeenNthCalledWith(
      2,
      'MCP call failed: MCP local commands do not support attachments.'
    );
  });

  it('propagates parser failures before appending and formats non-error failures as assistant messages', async () => {
    const appendAssistantMessage = vi.fn(async () => undefined);

    await expect(
      handleLocalMcpCommandCore({
        prompt: '/mcp call docs',
        resolveServer: vi.fn(),
        executeTool: vi.fn(),
        appendAssistantMessage,
      })
    ).rejects.toThrow('Usage: /mcp call <server> <tool> [json-arguments]');

    await expect(
      handleLocalMcpCommandCore({
        prompt: '/mcp call docs lookup {}',
        resolveServer: vi.fn(async () => server()),
        executeTool: vi.fn(async () => {
          throw 'string failure';
        }),
        appendAssistantMessage,
      })
    ).resolves.toEqual({ handled: true });

    expect(appendAssistantMessage).toHaveBeenCalledTimes(1);
    expect(appendAssistantMessage).toHaveBeenCalledWith('MCP call failed: string failure');
  });
});
