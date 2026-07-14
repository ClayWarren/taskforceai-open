import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import {
  BROWSER_COMMENTS_STORAGE_KEY,
  DesktopBrowserUseSection,
  DesktopComputerUseSection,
  DesktopLocalSection,
  installDesktopLocalSectionHarness,
  invokeTauriMock,
} from './ProfileDesktopLocalSection.test-harness';

describe('DesktopLocalSection', () => {
  installDesktopLocalSectionHarness();

  it('loads and updates desktop local capabilities', async () => {
    const clipboardWriteMock = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteMock,
      },
    });

    render(<DesktopLocalSection />);

    await waitFor(() => expect(screen.getByText('Hybrid local reviewer')).toBeDefined());
    expect(screen.getByText('Remote environment')).toBeDefined();
    expect(screen.getByText('Local capabilities')).toBeDefined();
    expect(screen.getByText('Recommended: ollama/gemma4:e4b')).toBeDefined();
    expect(screen.getByText('Browser')).toBeDefined();
    expect(screen.getByText('Browser preview')).toBeDefined();
    expect(screen.getByText('Browser preview is closed.')).toBeDefined();
    expect(screen.getByText('Screen Memory')).toBeDefined();
    expect(screen.getByText('Screen Memory is off.')).toBeDefined();
    expect(screen.getByText('Worktrees')).toBeDefined();
    await waitFor(() => expect(screen.getAllByText('/tmp/project').length).toBeGreaterThan(0));

    fireEvent.input(screen.getByLabelText('Browser preview'), {
      target: { value: 'http://localhost:4177/benchmarks' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_open', {
        params: { url: 'http://localhost:4177/benchmarks' },
      })
    );
    await waitFor(() =>
      expect(screen.getByText('Open at http://localhost:4177/benchmarks')).toBeDefined()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select area' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_action', {
        params: { action: 'selectArea', mode: 'area' },
      })
    );
    await waitFor(() =>
      expect(screen.getByText('Selected Area: x=40, y=50, w=160, h=48')).toBeDefined()
    );
    expect(screen.getByLabelText<HTMLInputElement>('Comment target').value).toBe('#save');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_inspect', {
        params: { selector: '#save', maxElements: 12 },
      })
    );
    await waitFor(() =>
      expect(screen.getByText('Inspected 1 element on Benchmarks.')).toBeDefined()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_diagnostics')
    );
    await waitFor(() =>
      expect(
        screen.getByText('Diagnostics: 1 logs, 1 requests, 0 errors, 1 slow resources.')
      ).toBeDefined()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear diagnostics' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_diagnostics_clear')
    );
    await waitFor(() =>
      expect(
        screen.queryByText('Diagnostics: 1 logs, 1 requests, 0 errors, 1 slow resources.')
      ).toBeNull()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Capture preview' }));
    await waitFor(() => expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_screenshot'));
    await waitFor(() =>
      expect(
        screen.getByText('Preview capture: /tmp/taskforceai-browser-preview/browser-preview-1.png')
      ).toBeDefined()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open devtools' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_devtools_open')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close devtools' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_devtools_close')
    );
    fireEvent.input(screen.getByLabelText('Page comment'), {
      target: { value: 'Benchmark table clips on phone width.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(screen.getByText('Benchmark table clips on phone width.')).toBeDefined();
    expect(screen.getByText(/#save - /)).toBeDefined();
    expect(screen.getByText('Area: x=40, y=50, w=160, h=48')).toBeDefined();
    expect(
      screen.getByText('Capture: /tmp/taskforceai-browser-preview/browser-preview-1.png')
    ).toBeDefined();
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_annotations_set', {
        params: {
          annotations: [
            {
              id: expect.any(String),
              text: 'Benchmark table clips on phone width.',
              target: '#save',
              x: 40,
              y: 50,
              width: 160,
              height: 48,
              kind: 'area',
            },
          ],
        },
      })
    );
    expect(window.localStorage.getItem(BROWSER_COMMENTS_STORAGE_KEY)).toContain(
      'Benchmark table clips on phone width.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));
    await waitFor(() => expect(screen.getByText('Copied review summary.')).toBeDefined());
    const copiedSummary =
      (clipboardWriteMock.mock.calls as unknown as string[][]).find((call) =>
        call[0]?.includes('Browser review notes')
      )?.[0] ?? '';
    expect(copiedSummary).toContain('Browser review notes');
    expect(copiedSummary).toContain('URL: http://localhost:4177/benchmarks');
    expect(copiedSummary).toContain('Target: #save');
    expect(copiedSummary).toContain('Annotation: Area: x=40, y=50, w=160, h=48');
    expect(copiedSummary).toContain(
      'Screenshot: /tmp/taskforceai-browser-preview/browser-preview-1.png'
    );
    expect(copiedSummary).toContain('Comment: Benchmark table clips on phone width.');
    expect(screen.getByLabelText('Browser review summary')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Benchmark table clips on phone width.')).toBeNull();
    expect(window.localStorage.getItem(BROWSER_COMMENTS_STORAGE_KEY)).not.toContain(
      'Benchmark table clips on phone width.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_back'));
    await waitFor(() =>
      expect(screen.getByText('Open at http://localhost:4177/back')).toBeDefined()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await waitFor(() => expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_forward'));
    await waitFor(() =>
      expect(screen.getByText('Open at http://localhost:4177/forward')).toBeDefined()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_reload'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_close'));

    fireEvent.click(screen.getByRole('button', { name: 'Take appshot' }));
    await waitFor(() => expect(invokeTauriMock).toHaveBeenCalledWith('appshot_capture_frontmost'));
    await waitFor(() =>
      expect(
        screen.getByText('Captured the frontmost window image and available text.')
      ).toBeDefined()
    );
    expect(screen.getByText('App: Safari')).toBeDefined();
    expect(screen.getByLabelText('Appshot text')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Attach image' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_attachment_add', {
        params: { path: '/tmp/taskforceai-appshots/appshot-1.png' },
      })
    );
    await waitFor(() => expect(screen.getByText('Attached appshot-1.png.')).toBeDefined());

    fireEvent.input(screen.getByLabelText('Branch'), {
      target: { value: 'codex/review-pane' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create worktree' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_worktree_create', {
        params: {
          repository: null,
          branch: 'codex/review-pane',
          baseRef: null,
          path: null,
        },
      })
    );
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_enable_local_coding', {
        params: { workspace: '/tmp/project-codex-review-pane' },
      })
    );
    await waitFor(() =>
      expect(
        screen.getByText('Local coding workspace set to /tmp/project-codex-review-pane.')
      ).toBeDefined()
    );

    await waitFor(() =>
      expect(screen.getByText('/tmp/project/.codex/environments/environment.json')).toBeDefined()
    );
    fireEvent.input(screen.getByLabelText('Setup script'), {
      target: { value: 'bun install --frozen-lockfile' },
    });
    fireEvent.input(screen.getByLabelText('Script'), {
      target: { value: 'bun test --watch=false' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('local_environment_save', {
        params: {
          config: {
            setup: {
              default: 'bun install --frozen-lockfile',
              macos: 'brew bundle',
            },
            actions: [
              {
                id: 'test',
                name: 'Test',
                icon: 'check',
                scripts: {
                  default: 'bun test --watch=false',
                  macos: 'bun test:macos',
                },
              },
              {
                id: 'lint',
                name: 'Lint',
                scripts: { default: 'bun run lint' },
              },
            ],
          },
        },
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run setup' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('local_environment_run_setup')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run action' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('local_environment_run_action', {
        params: { actionId: 'test' },
      })
    );

    fireEvent.input(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'dev@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Probe SSH' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle hybrid local reviewer' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle companion' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Browser' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Screen Memory' }));
    fireEvent.click(screen.getByText('celebrate'));
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
    await waitFor(() => expect(screen.getByText('Local app-server')).toBeDefined());
    expect(window.localStorage.getItem('@taskforceai:desktop-remote-environments')).toContain(
      'dev@example.com'
    );
  });

  it('loads and updates browser use plugin settings', async () => {
    render(<DesktopBrowserUseSection />);

    await waitFor(() => expect(screen.getByText('Browser use')).toBeDefined());
    expect(screen.getByText('Browser plugin is installed.')).toBeDefined();
    expect(screen.getByText('Browser preview')).toBeDefined();

    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Browser' }));

    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_plugin_set_enabled', {
        pluginId: 'browser@openai-bundled',
        enabled: true,
      })
    );
    await waitFor(() => expect(invokeTauriMock).toHaveBeenCalledWith('app_server_browser_status'));
  });

  it('loads and updates computer use mode and plugin settings', async () => {
    render(<DesktopComputerUseSection />);

    await waitFor(() =>
      expect(screen.getByText('Computer Use plugin is installed.')).toBeDefined()
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Computer Use mode' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_computer_use_mode_set', {
        enabled: true,
      })
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Computer Use' }));
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_plugin_set_enabled', {
        pluginId: 'computer-use@openai-bundled',
        enabled: true,
      })
    );
    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_computer_use_status')
    );
  });
});
