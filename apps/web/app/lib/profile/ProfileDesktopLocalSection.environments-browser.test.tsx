import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import {
  PROMPT_DRAFT_CAPTURE_EVENT,
  readCapturedPromptDraft,
} from '../prompt/hydration-draft-capture';
import {
  BROWSER_COMMENTS_STORAGE_KEY,
  DesktopLocalSection,
  defaultInvokeTauri,
  installDesktopLocalSectionHarness,
  invokeTauriMock,
  setBrowserPreviewUrl,
} from './ProfileDesktopLocalSection.test-harness';

describe('DesktopLocalSection environments and browser review', () => {
  installDesktopLocalSectionHarness();

  it('surfaces local app-server and screen-memory failures without hiding controls', async () => {
    invokeTauriMock.mockImplementation((async (command: string, args?: Record<string, any>) => {
      switch (command) {
        case 'screen_memory_status':
          return {
            supported: true,
            enabled: true,
            paused: false,
            captureDirectory: '/tmp/taskforceai-screen-memory/screen_recording',
            memoryPath: null,
            latestCapturePath: null,
            latestCaptureAt: null,
            captureCount: 0,
            bytes: 0,
            message: 'Screen Memory is running.',
          };
        case 'app_server_ssh_probe':
          return {
            target: args?.['params']?.target ?? 'dev@example.com',
            reachable: true,
            appServerAvailable: false,
            appServerPath: '',
            shell: '/bin/zsh',
            message: 'taskforceai-app-server is not on PATH.',
          };
        case 'app_server_ssh_connect':
          throw new Error('SSH tunnel refused.');
        case 'set_screen_memory_enabled':
          throw new Error('Screen recording permission denied.');
        case 'screen_memory_capture_now':
          throw new Error('Capture service unavailable.');
        default:
          return defaultInvokeTauri(command, args);
      }
    }) as typeof defaultInvokeTauri);

    render(<DesktopLocalSection />);

    await waitFor(() => expect(screen.getByText('Screen Memory is running.')).toBeDefined());
    expect(screen.getByText('Memory source: Unavailable')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Probe SSH' }));
    await waitFor(() => expect(screen.getByText('Enter an SSH target.')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(screen.getAllByText('Enter an SSH target.').length).toBeGreaterThan(1)
    );

    fireEvent.input(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'dev@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Probe SSH' }));
    await waitFor(() =>
      expect(screen.getAllByText('taskforceai-app-server is not on PATH.')).toHaveLength(2)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(screen.getByText('SSH tunnel refused.')).toBeDefined());

    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Screen Memory' }));
    await waitFor(() =>
      expect(screen.getByText('Screen recording permission denied.')).toBeDefined()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }));
    await waitFor(() => expect(screen.getByText('Capture service unavailable.')).toBeDefined());
  });

  it('reuses, forgets, and sanitizes saved remote environments', async () => {
    window.localStorage.setItem(
      '@taskforceai:desktop-remote-environments',
      JSON.stringify([
        { id: 'prod', target: 'prod@example.com', appServerPath: '/opt/taskforceai-app-server' },
        { id: 'stale', target: 'stale@example.com' },
        { id: 'missing-target' },
        'invalid',
      ])
    );

    render(<DesktopLocalSection />);

    await waitFor(() => expect(screen.getByText('prod@example.com')).toBeDefined());
    expect(screen.queryByText('missing-target')).toBeNull();

    const prodRow = screen.getByText('prod@example.com').parentElement?.parentElement;
    expect(prodRow).toBeDefined();
    fireEvent.click(within(prodRow as HTMLElement).getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('app_server_ssh_connect', {
        params: {
          target: 'prod@example.com',
          appServerPath: '/opt/taskforceai-app-server',
        },
      })
    );

    const staleRow = screen.getByText('stale@example.com').parentElement?.parentElement;
    expect(staleRow).toBeDefined();
    fireEvent.click(within(staleRow as HTMLElement).getByRole('button', { name: 'Forget' }));

    await waitFor(() => expect(screen.queryByText('stale@example.com')).toBeNull());
    expect(window.localStorage.getItem('@taskforceai:desktop-remote-environments')).not.toContain(
      'stale@example.com'
    );
  });

  it('keeps browser review summaries selectable when clipboard is unavailable', async () => {
    render(<DesktopLocalSection />);

    await waitFor(() => expect(screen.getByText('Browser preview is closed.')).toBeDefined());
    fireEvent.input(screen.getByLabelText('Page comment'), {
      target: { value: 'Default route needs a tighter mobile toolbar.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));

    await waitFor(() => expect(screen.getByText('Review summary is ready.')).toBeDefined());
    const summary = screen.getByLabelText('Browser review summary') as HTMLTextAreaElement;
    expect(summary.value).toBe(
      [
        'Browser review notes',
        '',
        'URL: http://localhost:3000',
        '1. Target: Page',
        '   Comment: Default route needs a tighter mobile toolbar.',
      ].join('\n')
    );
  });

  it('syncs manually navigated browser preview pages before adding comments', async () => {
    render(<DesktopLocalSection />);

    await waitFor(() => expect(screen.getByText('Browser preview is closed.')).toBeDefined());
    fireEvent.input(screen.getByLabelText('Browser preview'), {
      target: { value: 'http://localhost:4177/start' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }));
    await waitFor(() =>
      expect(screen.getByText('Open at http://localhost:4177/start')).toBeDefined()
    );

    setBrowserPreviewUrl('http://localhost:4177/manual');
    fireEvent.click(screen.getByRole('button', { name: 'Sync page' }));

    await waitFor(() =>
      expect(screen.getByText('Open at http://localhost:4177/manual')).toBeDefined()
    );
    expect(screen.getByLabelText<HTMLInputElement>('Browser preview').value).toBe(
      'http://localhost:4177/manual'
    );

    fireEvent.input(screen.getByLabelText('Page comment'), {
      target: { value: 'Manual route header is cramped.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));

    await waitFor(() => expect(screen.getByText('Review summary is ready.')).toBeDefined());
    const summary = screen.getByLabelText('Browser review summary') as HTMLTextAreaElement;
    expect(summary.value).toContain('URL: http://localhost:4177/manual');
    expect(summary.value).toContain('Comment: Manual route header is cramped.');
  });

  it('adds browser review summaries to the prompt draft', async () => {
    const promptCaptureMock = vi.fn();
    window.addEventListener(PROMPT_DRAFT_CAPTURE_EVENT, promptCaptureMock);

    try {
      render(<DesktopLocalSection />);

      await waitFor(() => expect(screen.getByText('Browser preview is closed.')).toBeDefined());
      fireEvent.input(screen.getByLabelText('Page comment'), {
        target: { value: 'Hero CTA is clipped on mobile.' },
      });
      fireEvent.input(screen.getByLabelText('Comment target'), {
        target: { value: 'Hero CTA' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
      fireEvent.click(screen.getByRole('button', { name: 'Use as prompt' }));

      await waitFor(() =>
        expect(screen.getByText('Added review summary to prompt.')).toBeDefined()
      );
      const promptDraft = readCapturedPromptDraft();
      expect(promptDraft).toContain('Address these Browser review notes.');
      expect(promptDraft).toContain('URL: http://localhost:3000');
      expect(promptDraft).toContain('Target: Hero CTA');
      expect(promptDraft).toContain('Comment: Hero CTA is clipped on mobile.');
      expect(promptCaptureMock).toHaveBeenCalled();
      const event = promptCaptureMock.mock.calls[0]?.[0] as CustomEvent<{ value: string }>;
      expect(event.detail.value).toBe(promptDraft);
    } finally {
      window.removeEventListener(PROMPT_DRAFT_CAPTURE_EVENT, promptCaptureMock);
    }
  });

  it('loads, exports, and clears saved browser comments', async () => {
    window.localStorage.setItem(
      BROWSER_COMMENTS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'saved-current',
          url: 'http://localhost:3000',
          text: 'Saved toolbar wraps too late.',
          target: 'Toolbar',
          annotation: { kind: 'point', x: 18, y: 24, width: 120, height: 30 },
          screenshotPath: '/tmp/taskforceai-browser-preview/saved.png',
          createdAt: 1760000000000,
        },
        {
          id: 'saved-other',
          url: 'http://localhost:4177/pricing',
          text: 'Pricing card spacing is uneven.',
          target: null,
          createdAt: 1760000001000,
        },
        {
          id: 'invalid',
          text: 'Missing URL should be dropped.',
        },
      ])
    );

    render(<DesktopLocalSection />);

    await waitFor(() => expect(screen.getByText('Browser preview is closed.')).toBeDefined());
    expect(screen.getByText('Saved toolbar wraps too late.')).toBeDefined();
    expect(screen.getByText(/Toolbar - /)).toBeDefined();
    expect(screen.getByText('Point: x=18, y=24')).toBeDefined();
    expect(screen.getByText('Capture: /tmp/taskforceai-browser-preview/saved.png')).toBeDefined();
    expect(screen.getByText('2 saved review comments.')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));
    await waitFor(() => expect(screen.getByText('Review summary is ready.')).toBeDefined());
    const summary = screen.getByLabelText('Browser review summary') as HTMLTextAreaElement;
    expect(summary.value).toContain('URL: http://localhost:3000');
    expect(summary.value).toContain('Target: Toolbar');
    expect(summary.value).toContain('Annotation: Point: x=18, y=24');
    expect(summary.value).toContain('Screenshot: /tmp/taskforceai-browser-preview/saved.png');
    expect(summary.value).toContain('Comment: Saved toolbar wraps too late.');
    expect(summary.value).toContain('URL: http://localhost:4177/pricing');
    expect(summary.value).toContain('Comment: Pricing card spacing is uneven.');
    expect(summary.value).not.toContain('Missing URL should be dropped.');

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.queryByText('Saved toolbar wraps too late.')).toBeNull();
    expect(screen.queryByLabelText('Browser review summary')).toBeNull();
    expect(window.localStorage.getItem(BROWSER_COMMENTS_STORAGE_KEY)).toBe('[]');
  });
});
