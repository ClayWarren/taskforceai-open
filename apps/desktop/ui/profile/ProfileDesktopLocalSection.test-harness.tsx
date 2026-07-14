// oxlint-disable complexity, typescript/no-floating-promises -- The command dispatcher mirrors the desktop API, and Bun mocks register synchronously.
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'bun:test';

import '../../../../tests/setup/dom';
import { writeCapturedPromptDraft } from '@taskforceai/web/app/lib/prompt/hydration-draft-capture';

export const pairingConnectMock = vi.fn(async () => undefined);
export const BROWSER_COMMENTS_STORAGE_KEY = '@taskforceai:desktop-browser-comments';

export const createConnectedPairing = () => ({
  status: 'connected',
  session: {
    baseUrl: 'http://127.0.0.1:7319',
    sessionToken: 'session-token',
    rpcPath: '/rpc',
    transport: { kind: 'http', encoding: 'json' },
  },
  error: null,
  connect: pairingConnectMock,
});

export let pairingState:
  | ReturnType<typeof createConnectedPairing>
  | {
      status: 'error' | 'pairing' | 'idle';
      session: null;
      error: string | null;
      connect: typeof pairingConnectMock;
    } = createConnectedPairing();
export let browserPreviewOpen = false;
export let browserPreviewUrl: string | null = null;

export const setPairingState = (state: typeof pairingState) => {
  pairingState = state;
};

export const setBrowserPreviewUrl = (url: string | null) => {
  browserPreviewUrl = url;
};

export const defaultInvokeTauri = async (command: string, args?: Record<string, any>) => {
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
          {
            id: 'computer-use@openai-bundled',
            name: 'Computer Use',
            path: '/plugins/computer-use',
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
            enabled:
              args?.['pluginId'] === 'browser@openai-bundled' ? (args?.['enabled'] ?? true) : false,
            source: 'openai-bundled',
          },
          {
            id: 'computer-use@openai-bundled',
            name: 'Computer Use',
            path: '/plugins/computer-use',
            enabled:
              args?.['pluginId'] === 'computer-use@openai-bundled'
                ? (args?.['enabled'] ?? true)
                : false,
            source: 'openai-bundled',
          },
        ],
      };
    case 'app_server_browser_status':
      return {
        supported: true,
        installed: true,
        supportsAuth: false,
        message: 'Browser plugin is installed.',
      };
    case 'app_server_computer_use_status':
      return {
        supported: true,
        installed: true,
        permissionRequired: false,
        lockedUseSupported: true,
        message: 'Computer Use plugin is installed.',
      };
    case 'app_server_computer_use_mode_get':
      return { enabled: false };
    case 'app_server_computer_use_mode_set':
      return { enabled: args?.['enabled'] ?? true };
    case 'desktop_browser_status':
      return {
        open: browserPreviewOpen,
        currentUrl: browserPreviewUrl,
        message: browserPreviewOpen ? 'Browser preview is open.' : 'Browser preview is closed.',
      };
    case 'desktop_browser_devtools_status':
      return {
        supported: true,
        open: false,
        message: 'Browser preview devtools are available.',
      };
    case 'desktop_browser_open':
      browserPreviewOpen = true;
      browserPreviewUrl = args?.['params']?.url ?? 'http://localhost:3000';
      return {
        open: true,
        currentUrl: browserPreviewUrl,
        message: 'Browser preview is open.',
      };
    case 'desktop_browser_reload':
      return undefined;
    case 'desktop_browser_back':
      browserPreviewUrl = 'http://localhost:4177/back';
      return undefined;
    case 'desktop_browser_forward':
      browserPreviewUrl = 'http://localhost:4177/forward';
      return undefined;
    case 'desktop_browser_close':
      browserPreviewOpen = false;
      browserPreviewUrl = null;
      return undefined;
    case 'desktop_browser_action':
      return {
        action: args?.['params']?.action ?? 'selectPoint',
        ok: true,
        message: 'Selected browser preview element.',
        currentUrl: browserPreviewUrl,
        selection: {
          mode: args?.['params']?.mode ?? 'point',
          point: { x: 44, y: 56 },
          rect: { x: 40, y: 50, width: 160, height: 48, top: 50, right: 200, bottom: 98, left: 40 },
          element: {
            tagName: 'button',
            id: 'save',
            classes: ['primary'],
            text: 'Save changes',
            role: null,
            ariaLabel: 'Save changes',
            name: null,
            href: null,
            value: null,
            selector: '#save',
            rect: {
              x: 40,
              y: 50,
              width: 160,
              height: 48,
              top: 50,
              right: 200,
              bottom: 98,
              left: 40,
            },
          },
        },
        inspection: null,
      };
    case 'desktop_browser_annotations_set':
      return {
        action: 'annotations',
        ok: true,
        message: 'Rendered browser preview annotations.',
        currentUrl: browserPreviewUrl,
        selection: null,
        inspection: null,
      };
    case 'desktop_browser_inspect':
      return {
        title: 'Benchmarks',
        url: browserPreviewUrl ?? 'http://localhost:3000',
        readyState: 'complete',
        viewport: { width: 1180, height: 760, deviceScaleFactor: 2 },
        scroll: { x: 0, y: 0 },
        activeElement: null,
        elements: [
          {
            tagName: 'button',
            id: 'save',
            classes: ['primary'],
            text: 'Save changes',
            role: null,
            ariaLabel: 'Save changes',
            name: null,
            href: null,
            value: null,
            selector: '#save',
            rect: {
              x: 40,
              y: 50,
              width: 160,
              height: 48,
              top: 50,
              right: 200,
              bottom: 98,
              left: 40,
            },
          },
        ],
        text: 'Save changes',
      };
    case 'desktop_browser_screenshot':
      return {
        path: '/tmp/taskforceai-browser-preview/browser-preview-1.png',
        imageBase64: 'cG5n',
        mediaType: 'image/png',
        byteLength: 3,
        currentUrl: browserPreviewUrl,
      };
    case 'desktop_browser_devtools_open':
      return {
        supported: true,
        open: true,
        message: 'Browser preview devtools are available.',
      };
    case 'desktop_browser_devtools_close':
      return {
        supported: true,
        open: false,
        message: 'Browser preview devtools are available.',
      };
    case 'desktop_browser_diagnostics':
      return {
        url: browserPreviewUrl ?? 'http://localhost:3000',
        title: 'Benchmarks',
        capturedAt: 1760000000100,
        startedAt: 1760000000000,
        logs: [
          {
            level: 'warn',
            message: 'Slow table render',
            args: ['Slow table render'],
            timestamp: 1760000000001,
          },
        ],
        network: [
          {
            type: 'fetch',
            method: 'GET',
            url: '/api/benchmarks',
            status: 200,
            ok: true,
            durationMs: 42,
            error: null,
            timestamp: 1760000000002,
          },
        ],
        errors: [],
        performance: {
          navigation: null,
          resourceCount: 3,
          slowResources: [{ name: '/bundle.js', initiatorType: 'script', durationMs: 180 }],
        },
      };
    case 'desktop_browser_diagnostics_clear':
      return {
        action: 'diagnosticsClear',
        ok: true,
        message: 'Cleared browser preview diagnostics.',
        currentUrl: browserPreviewUrl,
        selection: null,
        inspection: null,
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
    case 'appshot_capture_frontmost':
      return {
        supported: true,
        capturedAt: 1760000000003,
        appName: 'Safari',
        windowTitle: 'API Reference',
        imagePath: '/tmp/taskforceai-appshots/appshot-1.png',
        textPath: '/tmp/taskforceai-appshots/appshot-1.txt',
        metadataPath: '/tmp/taskforceai-appshots/appshot-1.json',
        text: 'Visible appshot text',
        permissions: {
          screenRecordingRequired: false,
          accessibilityRequired: false,
        },
        message: 'Captured the frontmost window image and available text.',
      };
    case 'app_server_attachment_add':
      return {
        attachment: {
          id: 'att-appshot',
          name: 'appshot-1.png',
          path: args?.['params']?.path ?? '/tmp/taskforceai-appshots/appshot-1.png',
          mimeType: 'image/png',
          size: 1024,
        },
        attachments: [
          {
            id: 'att-appshot',
            name: 'appshot-1.png',
            path: args?.['params']?.path ?? '/tmp/taskforceai-appshots/appshot-1.png',
            mimeType: 'image/png',
            size: 1024,
          },
        ],
        maxAttachments: 5,
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
    case 'local_environment_status':
      return {
        workspace: '/tmp/project',
        configPath: '/tmp/project/.codex/environments/environment.json',
        exists: true,
        config: {
          setup: { default: 'bun install', macos: 'brew bundle' },
          actions: [
            {
              id: 'test',
              name: 'Test',
              icon: 'check',
              scripts: { default: 'bun test', macos: 'bun test:macos' },
            },
            {
              id: 'lint',
              name: 'Lint',
              scripts: { default: 'bun run lint' },
            },
          ],
        },
      };
    case 'local_environment_save':
      return {
        workspace: '/tmp/project',
        configPath: '/tmp/project/.codex/environments/environment.json',
        exists: true,
        config: args?.['params']?.config,
      };
    case 'local_environment_run_setup':
      return {
        command: 'bun install',
        cwd: '/tmp/project',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      };
    case 'local_environment_run_action':
      return {
        command: 'bun test',
        cwd: '/tmp/project',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      };
    case 'desktop_worktree_list':
      return {
        repositoryRoot: args?.['params']?.repository ?? '/tmp/project',
        worktrees: [
          {
            path: '/tmp/project',
            head: 'abc123',
            branch: 'main',
            bare: false,
            detached: false,
            prunable: false,
          },
        ],
      };
    case 'desktop_worktree_create':
      return {
        repositoryRoot: args?.['params']?.repository ?? '/tmp/project',
        worktree: {
          path: '/tmp/project-codex-review-pane',
          head: 'def456',
          branch: args?.['params']?.branch ?? 'codex/review-pane',
          bare: false,
          detached: false,
          prunable: false,
        },
        message: 'Git worktree created.',
      };
    case 'app_server_enable_local_coding':
      return {
        workspace: args?.['params']?.workspace ?? '/tmp/project-codex-review-pane',
        serverName: 'workspace',
        serverNames: ['workspace'],
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
};

export const invokeTauriMock = vi.fn(defaultInvokeTauri);

vi.mock('../platform/bridge', () => ({
  invokeTauri: invokeTauriMock,
}));

vi.mock('../platform/useDesktopHttpAppServerPairing', () => ({
  useDesktopHttpAppServerPairing: () => pairingState,
}));

import {
  DesktopBrowserUseSection,
  DesktopComputerUseSection,
  DesktopLocalSection,
} from './ProfileDesktopLocalSection';

export const installDesktopLocalSectionHarness = () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    invokeTauriMock.mockClear();
    invokeTauriMock.mockImplementation(defaultInvokeTauri);
    pairingConnectMock.mockClear();
    pairingState = createConnectedPairing();
    browserPreviewOpen = false;
    browserPreviewUrl = null;
    writeCapturedPromptDraft('');
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            pairingCode: 'fresh-code',
            rpcPath: '/rpc',
            transport: { kind: 'http', encoding: 'json' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as unknown as typeof fetch;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    cleanup();
  });
};

export { DesktopBrowserUseSection, DesktopComputerUseSection, DesktopLocalSection };
