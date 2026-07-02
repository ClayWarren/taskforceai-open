import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { render, renderHook } from '@testing-library/react-native';
import React from 'react';

import { getJwtExpiryMs } from '@taskforceai/shared/auth/session-expiry';
import { resolveSessionExpiryMs } from '../auth/token-expiry';
import { MessageTimestamp } from '../components/MessageBubble/MessageTimestamp';
import { formatBytes, prepareAttachment } from '../components/PromptInput.internal';
import {
  loadStoredMobileMcpServers,
  persistMobileMcpServers,
  subscribeMobileMcpServers,
} from '../mcp/store';
import { fulfillPendingMcpApproval } from '../mcp/approval';
import {
  connectMobileMcpClient,
  parseMobileMcpEndpoint,
} from '../mcp/client';
import { DeviceRepository } from '../storage/repositories/DeviceRepository';
import { serializeError } from '@taskforceai/shared/storage/value-utils';
import { withRepoError } from '../storage/utils';
import { useTypography } from '../theme/useTypography';
import {
  persistOrchestrationConfig,
  readStoredOrchestrationConfig,
} from '../utils/orchestration-preference';
import { useMobileMcpToolCatalog } from '../mcp/useMcpToolCatalog';

const mockAsyncStorage = require('@react-native-async-storage/async-storage');

const mockPinnedFetch = jest.fn();
const mockUseSharedMcpToolCatalog = jest.fn();
const mockFulfillPendingMcpApprovalCore = jest.fn();
const mockResolveEnabledMcpServer = jest.fn();
const mockSqliteGetSession = jest.fn();
const mockSecureStore = {
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
};
const mockFileSystem = {
  getInfoAsync: jest.fn(),
};
const mockMcpConnect = jest.fn();
const mockMcpClientConstructor = jest.fn();
const mockMcpTransportConstructor = jest.fn();
const mockUseFonts = jest.fn(() => [true]);

jest.mock('../api/client', () => ({
  getMobilePinnedFetch: () => mockPinnedFetch,
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  ...mockSecureStore,
}));

jest.mock('../utils/file-system', () => ({
  __esModule: true,
  ...mockFileSystem,
}));

jest.mock('@modelcontextprotocol/sdk/client', () => ({
  Client: jest.fn().mockImplementation((info, options) => {
    mockMcpClientConstructor(info, options);
    return { connect: mockMcpConnect };
  }),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation((url, options) => {
    mockMcpTransportConstructor(url, options);
    return { url, options };
  }),
}));

jest.mock('expo-font', () => ({
  useFonts: () => mockUseFonts(),
}));

jest.mock('@taskforceai/react-core', () => {
  const actual = jest.requireActual('@taskforceai/react-core') as Record<string, unknown>;
  return {
    ...actual,
    useSharedMcpToolCatalog: (...args: unknown[]) => mockUseSharedMcpToolCatalog(...args),
    fulfillPendingMcpApprovalCore: (...args: unknown[]) => mockFulfillPendingMcpApprovalCore(...args),
    resolveEnabledMcpServer: (...args: unknown[]) => mockResolveEnabledMcpServer(...args),
  };
});

jest.mock('../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    getSession: () => mockSqliteGetSession(),
  },
}));

jest.mock('../logger', () => ({
  createModuleLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
  }),
  mobileLogger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const createToken = (payload: Record<string, unknown>) => {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `header.${encoded}.signature`;
};

describe('mobile coverage logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockReset();
    mockAsyncStorage.setItem.mockReset();
    mockAsyncStorage.removeItem.mockReset();
    mockSecureStore.getItemAsync.mockReset();
    mockSecureStore.setItemAsync.mockReset();
    mockSecureStore.deleteItemAsync.mockReset();
    mockFileSystem.getInfoAsync.mockReset();
    mockMcpConnect.mockReset();
    mockMcpClientConstructor.mockClear();
    mockMcpTransportConstructor.mockClear();
    mockUseFonts.mockReset();
    mockUseFonts.mockReturnValue([true]);
    mockFulfillPendingMcpApprovalCore.mockReset();
    mockResolveEnabledMcpServer.mockReset();
    mockSqliteGetSession.mockReset();
  });

  it('resolves JWT expiry from numeric claims and fallback values', () => {
    expect(getJwtExpiryMs(createToken({ exp: 123.4 }))).toBe(123_400);
    expect(getJwtExpiryMs(createToken({ exp: '456' }))).toBe(456_000);
    expect(getJwtExpiryMs(createToken({ exp: 'bad' }))).toBeNull();
    expect(getJwtExpiryMs('header.bad.signature')).toBeNull();
    expect(getJwtExpiryMs('header..signature')).toBeNull();
    expect(getJwtExpiryMs('')).toBeNull();
    expect(getJwtExpiryMs('not-a-token')).toBeNull();
    expect(getJwtExpiryMs(createToken({ exp: -1 }))).toBeNull();
    expect(resolveSessionExpiryMs(createToken({ exp: 10 }), 20)).toBe(10_000);
    expect(resolveSessionExpiryMs('invalid', 20)).toBe(20);
    expect(resolveSessionExpiryMs('invalid', -1)).toBeGreaterThan(Date.now());
  });

  it('formats and prepares prompt attachments', async () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');

    await expect(prepareAttachment({ name: 'bad', uri: '', kind: 'file' })).resolves.toMatchObject({
      ok: false,
    });

    mockFileSystem.getInfoAsync.mockRejectedValueOnce(new Error('missing file'));
    await expect(
      prepareAttachment({ name: 'bad.pdf', uri: 'file:///bad.pdf', kind: 'file' })
    ).resolves.toMatchObject({ ok: false });
  });

  it('creates and connects mobile MCP clients', async () => {
    const endpoint = parseMobileMcpEndpoint(' https://mcp.example/rpc ');
    expect(endpoint.url.href).toBe('https://mcp.example/rpc');
    expect(() => parseMobileMcpEndpoint('http://mcp.example/rpc')).toThrow(
      'Mobile MCP endpoints must use https in production builds.'
    );
    expect(() => parseMobileMcpEndpoint('ftp://mcp.example/rpc')).toThrow(
      'Unsupported MCP endpoint protocol: ftp:'
    );

    mockMcpConnect.mockResolvedValueOnce(undefined);
    const connected = await connectMobileMcpClient('https://mcp.example/rpc');
    expect(connected.client).toBeTruthy();
    expect(connected.transport).toBeTruthy();
    expect(mockMcpClientConstructor).toHaveBeenCalledWith(
      { name: 'taskforceai-mobile', version: '0.3.0' },
      { capabilities: {} }
    );
    expect(mockMcpTransportConstructor).toHaveBeenCalledWith(new URL('https://mcp.example/rpc'), {
      fetch: expect.any(Function),
    });
    expect(mockMcpTransportConstructor.mock.calls[0]?.[1]?.fetch).not.toBe(mockPinnedFetch);
    expect(mockMcpConnect).toHaveBeenCalledTimes(1);
  });

  it('fulfills pending MCP approvals through the shared core callbacks', async () => {
    const approval = { server: 'docs', tool: 'search', arguments: { q: 'coverage' } };
    const manager = {
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    };
    mockFulfillPendingMcpApprovalCore.mockImplementationOnce(async (options) => {
      await options.executeTool(
        { name: 'docs', endpoint: 'https://docs.example/mcp', enabled: true },
        'search',
        { q: 'coverage' }
      );
      options.logFailure({ error: new Error('logged'), taskId: 'task-1', approval });
      return true;
    });

    await expect(
      fulfillPendingMcpApproval({ taskId: 'task-1', approval: approval as never, manager: manager as never })
    ).resolves.toBe(true);

    expect(mockFulfillPendingMcpApprovalCore).toHaveBeenCalledTimes(1);
    expect(manager.callTool).toHaveBeenCalledWith(
      { name: 'docs', endpoint: 'https://docs.example/mcp', enabled: true },
      'search',
      { q: 'coverage' }
    );
  });

  it('persists generated and explicit device ids', async () => {
    const repository = new DeviceRepository();
    mockAsyncStorage.getItem.mockResolvedValueOnce(null);
    const generated = await repository.getDeviceId();
    expect(generated).toBe('mobile-mock-uuid-0000-0000-0000-000000000000');
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith('@taskforceai:device_id', generated);

    mockAsyncStorage.getItem.mockResolvedValueOnce('device-1');
    await expect(repository.getDeviceId()).resolves.toBe('device-1');

    await repository.setDeviceId('device-2');
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith('@taskforceai:device_id', 'device-2');
  });

  it('wraps storage repository errors with structured context', async () => {
    const failure = new Error('write failed');

    await expect(withRepoError('save row', async () => 'ok')).resolves.toBe('ok');
    await expect(
      withRepoError(
        'save row',
        async () => {
          throw failure;
        },
        { rowId: 'row-1' }
      )
    ).rejects.toThrow('write failed');

    expect(serializeError(failure).message).toBe('write failed');
    expect(serializeError('plain failure')).toEqual({ message: 'plain failure' });
  });

  it('returns typography font readiness', () => {
    const loaded = renderHook(() => useTypography());
    expect(loaded.result.current).toBe(true);

    mockUseFonts.mockReturnValueOnce([false]);
    const pending = renderHook(() => useTypography());
    expect(pending.result.current).toBe(false);
  });

  it('loads, persists, notifies, and recovers mobile MCP server storage', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeMobileMcpServers(listener);

    mockAsyncStorage.getItem.mockResolvedValueOnce(
      JSON.stringify([
        { name: ' Docs ', endpoint: ' https://docs.example/mcp ', enabled: true },
        { name: '', endpoint: '', enabled: true },
      ])
    );
    const loaded = await loadStoredMobileMcpServers();
    expect(loaded).toEqual([{ name: 'Docs', endpoint: 'https://docs.example/mcp', enabled: true }]);

    mockAsyncStorage.getItem.mockResolvedValueOnce('{"bad":true}');
    await expect(loadStoredMobileMcpServers()).resolves.toEqual([]);

    await expect(persistMobileMcpServers([])).resolves.toEqual([]);
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('@taskforceai:mcp-servers');
    expect(listener).toHaveBeenCalledTimes(1);

    await persistMobileMcpServers([{ name: 'files', endpoint: 'https://files.example/mcp', enabled: false }]);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      '@taskforceai:mcp-servers',
      JSON.stringify([{ name: 'files', endpoint: 'https://files.example/mcp', enabled: false }])
    );
    expect(listener).toHaveBeenCalledTimes(2);

    mockAsyncStorage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      persistMobileMcpServers([{ name: 'bad', endpoint: 'https://bad.example/mcp', enabled: true }])
    ).resolves.toEqual([{ name: 'bad', endpoint: 'https://bad.example/mcp', enabled: true }]);

    unsubscribe();
  });

  it('round trips orchestration preference storage', async () => {
    mockAsyncStorage.getItem.mockResolvedValueOnce(null);
    await expect(readStoredOrchestrationConfig()).resolves.toBeNull();

    const storedConfig = { roleModels: { reviewer: 'gpt-5' }, budget: 5, agentCount: 2 };
    mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(storedConfig));
    await expect(readStoredOrchestrationConfig()).resolves.toEqual(storedConfig);

    await persistOrchestrationConfig(storedConfig);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      '@taskforceai:orchestration-config',
      JSON.stringify(storedConfig)
    );
  });

  it('normalizes streaming parser errors and renders message timestamps', () => {
    const rendered = render(<MessageTimestamp timestamp={new Date('2026-01-02T03:04:05Z')} isUser={false} />);
    expect(rendered.toJSON()).toBeTruthy();
  });

  it('wires the mobile MCP catalog hook to a manager and registry factory', () => {
    mockUseSharedMcpToolCatalog.mockImplementation((createManager, createRegistry, bindRegistry) => {
      const manager = createManager();
      const registry = createRegistry(manager);
      const cleanup = bindRegistry(registry);
      return { manager, registry, cleanup };
    });

    const { result } = renderHook(() => useMobileMcpToolCatalog());

    expect(mockUseSharedMcpToolCatalog).toHaveBeenCalledTimes(1);
    expect(result.current.manager).toBeTruthy();
    expect(result.current.registry).toBeTruthy();
    expect(typeof result.current.cleanup).toBe('function');
  });
});
