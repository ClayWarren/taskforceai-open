import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const runDesktopBrowserDeveloperCommand = mock();

mock.module('../lib/platform/desktop/app-server', () => ({
  runDesktopBrowserDeveloperCommand,
}));

import { DesktopBrowserDeveloperPanel } from './DesktopBrowserDeveloperPanel';

describe('DesktopBrowserDeveloperPanel', () => {
  afterEach(() => {
    cleanup();
    runDesktopBrowserDeveloperCommand.mockReset();
  });

  it('opens an allowlisted session and inspects bounded network entries', async () => {
    runDesktopBrowserDeveloperCommand
      .mockResolvedValueOnce({
        sessionId: 'browser-dev-1',
        method: 'Browser.startSession',
        protocol: 'cdp-compatible-webview-v1',
        active: true,
        result: { supportedDomains: ['Network'] },
      })
      .mockResolvedValueOnce({
        sessionId: 'browser-dev-1',
        method: 'Network.getEntries',
        protocol: 'cdp-compatible-webview-v1',
        active: true,
        result: { entries: [{ method: 'GET', url: 'http://localhost/api' }] },
      })
      .mockResolvedValue({
        sessionId: 'browser-dev-1',
        method: 'Browser.endSession',
        protocol: 'cdp-compatible-webview-v1',
        active: false,
        result: { ended: true },
      });
    render(<DesktopBrowserDeveloperPanel open />);

    fireEvent.click(screen.getByLabelText('Capture same-origin bodies (16 KB)'));
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() =>
      expect(runDesktopBrowserDeveloperCommand).toHaveBeenCalledWith({
        method: 'Browser.startSession',
        sessionId: null,
        captureBodies: true,
        maxBodyBytes: 16 * 1024,
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Network' }));
    await waitFor(() =>
      expect(runDesktopBrowserDeveloperCommand).toHaveBeenCalledWith({
        method: 'Network.getEntries',
        sessionId: 'browser-dev-1',
      })
    );
    expect(await screen.findByText(/localhost\/api/)).toBeTruthy();
  });

  it('runs the remaining developer commands and ends the session', async () => {
    runDesktopBrowserDeveloperCommand.mockImplementation(
      async ({ method }: { method: string }) => ({
        sessionId: 'browser-dev-1',
        method,
        protocol: 'cdp-compatible-webview-v1',
        active: method !== 'Browser.endSession',
        result: { method },
      })
    );
    render(<DesktopBrowserDeveloperPanel open />);

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await screen.findByRole('button', { name: 'Metrics' });
    for (const name of ['Metrics', 'Start trace', 'Stop trace', 'Profile', 'End']) {
      fireEvent.click(await screen.findByRole('button', { name }));
      await waitFor(() => expect(runDesktopBrowserDeveloperCommand).toHaveBeenCalled());
    }

    expect(runDesktopBrowserDeveloperCommand.mock.calls.map(([call]) => call.method)).toEqual([
      'Browser.startSession',
      'Performance.getMetrics',
      'Tracing.start',
      'Tracing.end',
      'Profiler.getProfile',
      'Browser.endSession',
      'Browser.endSession',
    ]);
    expect(await screen.findByRole('button', { name: 'Start session' })).toBeTruthy();
  });

  it('reports command failures and clears sessions when closed', async () => {
    runDesktopBrowserDeveloperCommand
      .mockRejectedValueOnce(new Error('Developer bridge unavailable'))
      .mockRejectedValueOnce('Still unavailable')
      .mockResolvedValue({
        sessionId: 'browser-dev-1',
        active: true,
        result: {},
      });
    const { rerender, unmount } = render(<DesktopBrowserDeveloperPanel open />);

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(await screen.findByText('Developer bridge unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(await screen.findByText('Still unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await screen.findByRole('button', { name: 'End' });

    rerender(<DesktopBrowserDeveloperPanel open={false} />);
    expect(screen.queryByLabelText('Browser developer mode')).toBeNull();
    rerender(<DesktopBrowserDeveloperPanel open />);
    expect(screen.getByRole('button', { name: 'Start session' })).toBeTruthy();
    unmount();
  });
});
