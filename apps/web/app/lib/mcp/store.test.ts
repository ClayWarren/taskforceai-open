import { beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../../tests/setup/dom';

type StorageReadResult =
  | { ok: false; error: { kind: string; message: string } }
  | { ok: true; value: string };

const mockReadStorageItem = mock(
  (): StorageReadResult => ({
    ok: false,
    error: { kind: 'missing', message: 'missing' },
  })
);
const mockWriteStorageItem = mock(() => undefined);
const mockRemoveStorageItem = mock(() => undefined);

mock.module('@taskforceai/browser-runtime/browser-storage', () => ({
  readStorageItem: mockReadStorageItem,
  writeStorageItem: mockWriteStorageItem,
  removeStorageItem: mockRemoveStorageItem,
}));

const loadModule = async () => import('./store');

describe('web mcp store', () => {
  beforeEach(() => {
    mockReadStorageItem.mockReset();
    mockWriteStorageItem.mockReset();
    mockRemoveStorageItem.mockReset();
    mockReadStorageItem.mockReturnValue({
      ok: false,
      error: { kind: 'missing', message: 'missing' },
    });
  });

  it('returns an empty list when storage is missing', async () => {
    const { readStoredWebMcpServers } = await loadModule();
    expect(readStoredWebMcpServers()).toEqual([]);
  });

  it('normalizes and persists valid servers', async () => {
    const { WEB_MCP_SERVERS_CHANGED_EVENT, WEB_MCP_SERVERS_STORAGE_KEY, persistWebMcpServers } =
      await loadModule();
    const listener = mock(() => {});
    window.addEventListener(WEB_MCP_SERVERS_CHANGED_EVENT, listener);
    const result = persistWebMcpServers([
      { name: ' Docs ', endpoint: ' https://example.com/mcp ', enabled: true },
      { name: 'docs', endpoint: 'https://override.example.com/mcp', enabled: false },
      { name: '  ', endpoint: 'https://skip.example.com/mcp', enabled: true },
    ]);

    expect(result).toEqual([
      { name: 'docs', endpoint: 'https://override.example.com/mcp', enabled: false },
    ]);
    expect(mockWriteStorageItem).toHaveBeenCalledWith(
      WEB_MCP_SERVERS_STORAGE_KEY,
      JSON.stringify(result)
    );
    expect(listener).toHaveBeenCalled();
    window.removeEventListener(WEB_MCP_SERVERS_CHANGED_EVENT, listener);
  });

  it('reads normalized stored servers and clears storage for empty lists', async () => {
    const { WEB_MCP_SERVERS_STORAGE_KEY, persistWebMcpServers, readStoredWebMcpServers } =
      await loadModule();
    mockReadStorageItem.mockReturnValue({
      ok: true,
      value: JSON.stringify([
        { name: ' Docs ', endpoint: ' https://example.com/mcp ', enabled: true },
        { name: 'bad', endpoint: '', enabled: true },
      ]),
    });

    expect(readStoredWebMcpServers()).toEqual([
      { name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true },
    ]);

    expect(persistWebMcpServers([])).toEqual([]);
    expect(mockRemoveStorageItem).toHaveBeenCalledWith(WEB_MCP_SERVERS_STORAGE_KEY);
  });

  it('returns an empty list for malformed stored data', async () => {
    const { readStoredWebMcpServers } = await loadModule();

    mockReadStorageItem.mockReturnValue({ ok: true, value: '{"nope":true}' });
    expect(readStoredWebMcpServers()).toEqual([]);

    mockReadStorageItem.mockReturnValue({ ok: true, value: '{' });
    expect(readStoredWebMcpServers()).toEqual([]);
  });
});
