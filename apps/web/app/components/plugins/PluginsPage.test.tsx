import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

let storedServers: Array<{ name: string; endpoint: string; enabled: boolean }> = [];
let platformRuntime: 'browser' | 'desktop' = 'browser';
const listDesktopAppServerPlugins = vi.fn(async (): Promise<any> => ({ plugins: [] }));
const setDesktopAppServerPluginEnabled = vi.fn(async (): Promise<any> => ({ plugins: [] }));
const persistWebMcpServers = vi.fn(
  (servers: Array<{ name: string; endpoint: string; enabled: boolean }>) => {
    storedServers = servers;
    return servers;
  }
);

vi.mock('../../lib/mcp/store', () => ({
  WEB_MCP_SERVERS_CHANGED_EVENT: 'taskforceai:mcp-servers-changed',
  readStoredWebMcpServers: () => storedServers,
  persistWebMcpServers,
}));

vi.mock('../../lib/platform/PlatformProvider', () => ({
  usePlatformRuntime: () => platformRuntime,
}));

vi.mock('../../lib/platform/desktop/app-server', () => ({
  listDesktopAppServerPlugins,
  setDesktopAppServerPluginEnabled,
}));

import { PluginsPage } from './PluginsPage';

describe('PluginsPage', () => {
  beforeEach(() => {
    storedServers = [];
    platformRuntime = 'browser';
    persistWebMcpServers.mockClear();
    listDesktopAppServerPlugins.mockClear();
    setDesktopAppServerPluginEnabled.mockClear();
  });

  afterEach(() => cleanup());

  it('adds a catalog plugin with a real MCP endpoint', () => {
    render(<PluginsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Add GitHub' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText('Plugin name') as HTMLInputElement).value).toBe('GitHub');

    fireEvent.input(screen.getByLabelText('Plugin MCP endpoint'), {
      target: { value: 'https://mcp.example.com/github' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save plugin' }));

    expect(persistWebMcpServers).toHaveBeenCalledWith([
      {
        name: 'GitHub',
        endpoint: 'https://mcp.example.com/github',
        enabled: true,
      },
    ]);
    expect(screen.getByRole('switch', { name: 'GitHub plugin' })).toBeTruthy();
  });

  it('filters catalog entries and toggles installed plugins', () => {
    storedServers = [{ name: 'Docs', endpoint: 'https://mcp.example.com/docs', enabled: true }];
    render(<PluginsPage />);

    fireEvent.input(screen.getByRole('searchbox', { name: 'Search plugins' }), {
      target: { value: 'calendar' },
    });
    expect(screen.getByText('Google Calendar')).toBeTruthy();
    expect(screen.queryByText('GitHub')).toBeNull();

    fireEvent.input(screen.getByRole('searchbox', { name: 'Search plugins' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Docs plugin' }));
    expect(persistWebMcpServers).toHaveBeenCalledWith([
      {
        name: 'Docs',
        endpoint: 'https://mcp.example.com/docs',
        enabled: false,
      },
    ]);
  });

  it('shows validation feedback instead of storing an incomplete plugin', () => {
    render(<PluginsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add plugin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save plugin' }));

    expect(screen.getByRole('alert').textContent).toContain('required');
    expect(persistWebMcpServers).not.toHaveBeenCalled();
  });

  it('lists and toggles installed desktop plugin bundles', async () => {
    platformRuntime = 'desktop';
    listDesktopAppServerPlugins.mockResolvedValueOnce({
      plugins: [
        {
          id: 'computer-use',
          name: 'Computer Use',
          path: '/plugins/computer-use',
          enabled: true,
          description: 'Control Mac apps',
          source: 'bundled',
        },
      ],
    });
    setDesktopAppServerPluginEnabled.mockResolvedValueOnce({ plugins: [] });
    render(<PluginsPage />);

    const plugin = await screen.findByRole('switch', {
      name: 'Computer Use plugin',
    });
    await act(async () => fireEvent.click(plugin));

    expect(setDesktopAppServerPluginEnabled).toHaveBeenCalledWith('computer-use', false);
  });
});
