import { describe, expect, it } from 'bun:test';

import {
  act,
  clickText,
  disconnectProfileIntegration,
  installProfileModalTestHooks,
  inputByLabel,
  loadIntegrations,
  mockCloseAllMcpServers,
  mockCloseMcpServer,
  mockDiscoverMcpServer,
  mockInspectDesktopMcpServer,
  mockPersistWebMcpServers,
  mockReadStoredWebMcpServers,
  mockWaitForTauriBridge,
  openProfileTab,
  ProfileModal,
  renderOpenProfile,
  screen,
  waitFor,
} from './ProfileModal.test-harness';

installProfileModalTestHooks();

describe('ProfileModal', () => {
  it('handles connected app connect and disconnect flows', async () => {
    (loadIntegrations as any).mockResolvedValue({
      ok: true,
      value: [{ provider: 'github', connected: true }],
    });
    const location = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/' },
    });

    try {
      await renderOpenProfile();
      await openProfileTab('Connected Apps');

      await clickText('Connect Google Drive');
      expect(window.location.href).toBe('/api/auth/signin/google-drive');

      await clickText('Connect GitHub');
      expect(window.location.href).toBe('/api/auth/signin/github');

      await clickText('Connect Unknown');
      expect(window.location.href).toBe('/api/auth/signin/github');

      await clickText('Disconnect GitHub');

      await waitFor(() => expect(disconnectProfileIntegration).toHaveBeenCalledWith('github'));
      expect(screen.getByText('github disconnected successfully.')).toBeDefined();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    }
  });

  it('shows an error when disconnecting an integration fails', async () => {
    (disconnectProfileIntegration as any).mockResolvedValue({
      ok: false,
      error: { message: 'disconnect failed' },
    });

    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await clickText('Disconnect GitHub');

    await waitFor(() => expect(screen.getByText('Failed to disconnect github.')).toBeDefined());
  });

  it('validates MCP server form input before saving', async () => {
    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await clickText('Save MCP Server');

    expect(mockPersistWebMcpServers).not.toHaveBeenCalled();
    expect(screen.getByText('MCP server name and endpoint are required.')).toBeDefined();
  });

  it('replaces saved MCP servers case-insensitively by name', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'Docs', endpoint: 'https://old.example.com/mcp', enabled: true },
    ]);

    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await inputByLabel('MCP name', 'docs');
    await inputByLabel('MCP endpoint', 'https://new.example.com/mcp');
    await clickText('Save MCP Server');

    expect(mockPersistWebMcpServers).toHaveBeenCalledWith([
      { name: 'docs', endpoint: 'https://new.example.com/mcp', enabled: true },
    ]);
  });

  it('shows an error when MCP inspection fails', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true },
    ]);
    mockDiscoverMcpServer.mockRejectedValue(new Error('offline'));

    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await clickText('Inspect Docs');

    await waitFor(() =>
      expect(screen.getByText('Failed to inspect MCP server Docs.')).toBeDefined()
    );
  });

  it('saves, inspects, removes, and closes MCP servers', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true },
    ]);

    const { rerender } = await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await screen.findByText('Docs');

    await inputByLabel('MCP name', 'Research');
    await inputByLabel('MCP endpoint', 'https://research.example.com/mcp');
    await clickText('Save MCP Server');

    expect(mockPersistWebMcpServers).toHaveBeenCalledWith([
      { name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true },
      { name: 'Research', endpoint: 'https://research.example.com/mcp', enabled: true },
    ]);
    expect(screen.getByText('Saved MCP server Research.')).toBeDefined();

    await clickText('Inspect Docs');

    await waitFor(() => expect(mockDiscoverMcpServer).toHaveBeenCalled());
    expect(screen.getByText('Docs: 1 tools, 0 prompts, 0 resources.')).toBeDefined();

    await clickText('Remove Docs');
    expect(mockCloseMcpServer).toHaveBeenCalledWith('Docs');
    expect(screen.getByText('Removed MCP server Docs.')).toBeDefined();

    await act(async () => {
      rerender(<ProfileModal open={false} onOpenChange={() => {}} />);
    });
    expect(mockCloseAllMcpServers).toHaveBeenCalled();
  });

  it('uses desktop MCP inspection when the Tauri bridge is available', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'Local', endpoint: 'stdio://local', enabled: true },
    ]);
    mockWaitForTauriBridge.mockResolvedValue(true);

    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await clickText('Inspect Local');

    await waitFor(() => expect(mockInspectDesktopMcpServer).toHaveBeenCalled());
    expect(screen.getByText('Desktop Docs: 0 tools, 1 prompts, 1 resources.')).toBeDefined();
  });

  it('inspects MCP servers from the dedicated MCP tab', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true },
    ]);

    await renderOpenProfile();
    await openProfileTab('MCP servers');
    await clickText('Inspect Docs');

    await waitFor(() => expect(mockDiscoverMcpServer).toHaveBeenCalled());
    expect(screen.getByText('Docs: 1 tools, 0 prompts, 0 resources.')).toBeDefined();
  });
});
