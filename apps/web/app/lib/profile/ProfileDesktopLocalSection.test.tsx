import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const pairingConnectMock = vi.fn(async () => undefined);
const invokeTauriMock = vi.fn(async (command: string, args?: Record<string, any>) => {
  switch (command) {
    case 'app_server_hybrid_mode_get':
      return {
        enabled: false,
        role: 'Skeptic',
        modelId: null,
        recommendedModelId: 'ollama/gemma4:e4b',
        message: 'Hybrid mode disabled.',
        orchestration: { roles: [], budget: null },
      };
    case 'app_server_hybrid_mode_set':
      return {
        enabled: true,
        role: 'Skeptic',
        modelId: 'ollama/gemma4:e4b',
        recommendedModelId: 'ollama/gemma4:e4b',
        message: 'Hybrid mode enabled.',
        orchestration: { roles: [], budget: null },
      };
    case 'app_server_pet_get':
      return {
        pet: {
          name: 'Pulse',
          mood: 'focus',
          visible: true,
          message: 'Pulse is focused with you.',
        },
      };
    case 'app_server_pet_set':
      return {
        pet: {
          name: 'Pulse',
          mood: args?.['params']?.mood ?? 'focus',
          visible: args?.['params']?.visible ?? true,
          message: 'Pulse is focused with you.',
        },
      };
    case 'app_server_plugin_list':
      return {
        plugins: [
          {
            id: 'browser@openai-bundled',
            name: 'Browser',
            path: '/plugins/browser',
            enabled: false,
            source: 'openai-bundled',
          },
        ],
      };
    case 'app_server_plugin_set_enabled':
      return {
        plugins: [
          {
            id: 'browser@openai-bundled',
            name: 'Browser',
            path: '/plugins/browser',
            enabled: true,
            source: 'openai-bundled',
          },
        ],
      };
    case 'screen_memory_status':
      return {
        supported: true,
        enabled: false,
        paused: true,
        captureDirectory: '/tmp/taskforceai-screen-memory/screen_recording',
        memoryPath: '/Users/test/.taskforceai/screen-memory/MEMORY.md',
        latestCapturePath: null,
        latestCaptureAt: null,
        captureCount: 0,
        bytes: 0,
        message: 'Screen Memory is off.',
      };
    case 'set_screen_memory_enabled':
      return {
        supported: true,
        enabled: args?.['enabled'] ?? true,
        paused: !(args?.['enabled'] ?? true),
        captureDirectory: '/tmp/taskforceai-screen-memory/screen_recording',
        memoryPath: '/Users/test/.taskforceai/screen-memory/MEMORY.md',
        latestCapturePath: null,
        latestCaptureAt: null,
        captureCount: 0,
        bytes: 0,
        message: args?.['enabled']
          ? 'Screen Memory is capturing temporary local snapshots.'
          : 'Screen Memory is off.',
      };
    case 'set_screen_memory_paused':
      return {
        supported: true,
        enabled: true,
        paused: args?.['paused'] ?? false,
        captureDirectory: '/tmp/taskforceai-screen-memory/screen_recording',
        memoryPath: '/Users/test/.taskforceai/screen-memory/MEMORY.md',
        latestCapturePath: null,
        latestCaptureAt: null,
        captureCount: 0,
        bytes: 0,
        message: args?.['paused']
          ? 'Screen Memory is paused.'
          : 'Screen Memory is capturing temporary local snapshots.',
      };
    case 'screen_memory_capture_now':
      return {
        supported: true,
        enabled: true,
        paused: false,
        captureDirectory: '/tmp/taskforceai-screen-memory/screen_recording',
        memoryPath: '/Users/test/.taskforceai/screen-memory/MEMORY.md',
        latestCapturePath: '/tmp/taskforceai-screen-memory/screen_recording/screen-1.png',
        latestCaptureAt: 1760000000000,
        captureCount: 1,
        bytes: 2048,
        message: 'Captured current screen.',
      };
    case 'app_server_environment_status':
      return {
        active: 'local',
        target: null,
        localBaseUrl: null,
        remoteBaseUrl: null,
        localPort: null,
        remotePort: null,
        remoteConnected: false,
      };
    case 'app_server_environment_use_local':
    case 'app_server_environment_disconnect_remote':
      return {
        active: 'local',
        target: null,
        localBaseUrl: null,
        remoteBaseUrl: null,
        localPort: null,
        remotePort: null,
        remoteConnected: false,
      };
    case 'app_server_ssh_probe':
      return {
        target: args?.['params']?.target ?? 'dev@example.com',
        reachable: true,
        appServerAvailable: true,
        appServerPath: '/usr/local/bin/taskforceai-app-server',
        shell: '/bin/zsh',
        message: 'SSH target is reachable and has taskforceai-app-server on PATH.',
      };
    case 'app_server_ssh_connect':
      return {
        target: args?.['params']?.target ?? 'dev@example.com',
        remoteBaseUrl: 'http://127.0.0.1:4111',
        localBaseUrl: 'http://127.0.0.1:9222',
        localPort: 9222,
        remotePort: 4111,
        pairing: {
          baseUrl: 'http://127.0.0.1:9222',
          pairingCode: 'remote-pair',
          rpcPath: '/rpc',
          transport: { kind: 'ssh', encoding: 'json' },
        },
        message: 'Remote app-server is connected through a local SSH tunnel.',
      };
    default:
      return undefined;
  }
});

vi.mock('../platform/desktop/bridge', () => ({
  invokeTauri: invokeTauriMock,
}));

vi.mock('../platform/desktop/useDesktopHttpAppServerPairing', () => ({
  useDesktopHttpAppServerPairing: () => ({
    status: 'connected',
    session: {
      baseUrl: 'http://127.0.0.1:7319',
      sessionToken: 'session-token',
      rpcPath: '/rpc',
      transport: { kind: 'http', encoding: 'json' },
    },
    error: null,
    connect: pairingConnectMock,
  }),
}));

import { DesktopLocalSection } from './ProfileDesktopLocalSection';

describe('DesktopLocalSection', () => {
  it('loads and updates desktop local capabilities', async () => {
    window.localStorage.clear();
    const clipboardWriteMock = vi.fn(async () => undefined);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            pairingCode: 'fresh-code',
            rpcPath: '/rpc',
            transport: { kind: 'http', encoding: 'json' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteMock,
      },
    });

    render(<DesktopLocalSection />);

    await waitFor(() => expect(screen.getByText('Hybrid local reviewer')).toBeDefined());
    await waitFor(() => expect(screen.getByText('connected')).toBeDefined());
    expect(screen.getByText('HTTP ready at http://127.0.0.1:7319')).toBeDefined();
    expect(screen.getByText('Remote environment')).toBeDefined();
    expect(screen.getByText('Local capabilities')).toBeDefined();
    expect(screen.getByText('Recommended: ollama/gemma4:e4b')).toBeDefined();
    expect(screen.getByText('Browser')).toBeDefined();
    expect(screen.getByText('Screen Memory')).toBeDefined();
    expect(screen.getByText('Screen Memory is off.')).toBeDefined();

    fireEvent.input(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'dev@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Probe SSH' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle hybrid local reviewer' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle companion' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Browser' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Screen Memory' }));
    fireEvent.click(screen.getByText('celebrate'));
    fireEvent.click(screen.getByText('Copy mobile link'));

    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_hybrid_mode_set', {
        enabled: true,
        modelId: 'ollama/gemma4:e4b',
        role: 'Skeptic',
      })
    );
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_pet_set', {
      params: { visible: false },
    });
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_pet_set', {
      params: { mood: 'celebrate' },
    });
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_plugin_set_enabled', {
      pluginId: 'browser@openai-bundled',
      enabled: true,
    });
    expect(invokeTauriMock).toHaveBeenCalledWith('set_screen_memory_enabled', {
      enabled: true,
    });
    await waitFor(() =>
      expect(
        screen.getByText('Screen Memory is capturing temporary local snapshots.')
      ).toBeDefined()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('set_screen_memory_paused', {
        paused: true,
      })
    );
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_ssh_probe', {
        params: { target: 'dev@example.com' },
      })
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          'SSH target is reachable and has taskforceai-app-server on PATH. Path: /usr/local/bin/taskforceai-app-server'
        )
      ).toBeDefined()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_ssh_connect', {
        params: {
          target: 'dev@example.com',
          appServerPath: '/usr/local/bin/taskforceai-app-server',
        },
      })
    );
    expect(screen.getByText(/Local: http:\/\/127\.0\.0\.1:9222/)).toBeDefined();
    expect(screen.getByText('dev@example.com tunnel 9222 -> 4111')).toBeDefined();
    expect(screen.getByText('http://127.0.0.1:9222 to http://127.0.0.1:4111')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_environment_disconnect_remote')
    );
    expect(screen.getByText('Local app-server')).toBeDefined();
    expect(window.localStorage.getItem('@taskforceai:desktop-remote-environments')).toContain(
      'dev@example.com'
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7319/pairing-code', {
        method: 'POST',
        headers: { Authorization: 'Bearer session-token' },
      })
    );
    const copiedLink = (clipboardWriteMock.mock.calls as unknown as string[][])[0]?.[0] ?? '';
    expect(copiedLink.startsWith('taskforceai://desktop-pairing?payload=')).toBe(true);
    expect(screen.getByAltText('Mobile pairing QR code')).toBeDefined();
    expect(new URL(copiedLink).searchParams.get('payload')).toBe(
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:7319',
        pairingCode: 'fresh-code',
        rpcPath: '/rpc',
        transport: { kind: 'http', encoding: 'json' },
      })
    );
    expect(screen.getByLabelText('Mobile pairing link')).toBeDefined();
  });
});
