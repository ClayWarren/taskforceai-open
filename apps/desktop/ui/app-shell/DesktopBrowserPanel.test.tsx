import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const invokeTauriMock = vi.fn(async (command: string) => {
  if (command === 'desktop_browser_mount') {
    return {
      open: true,
      currentUrl: null,
      message: 'mounted',
    };
  }
  return undefined;
});

vi.mock('../platform/bridge', () => ({
  invokeTauri: invokeTauriMock,
}));

import { DesktopBrowserPanel } from './DesktopBrowserPanel';

describe('DesktopBrowserPanel', () => {
  afterEach(() => {
    cleanup();
    invokeTauriMock.mockClear();
    vi.restoreAllMocks();
  });

  it('mounts the native webview below the app-owned browser toolbar', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset['testid'] === 'desktop-browser-content-slot') {
          return {
            x: 720,
            y: 128,
            width: 560,
            height: 592,
            top: 128,
            right: 1280,
            bottom: 720,
            left: 720,
            toJSON: () => ({}),
          } as DOMRect;
        }

        return {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
    );

    render(<DesktopBrowserPanel open onClose={() => undefined} />);

    await waitFor(() => {
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_mount', {
        params: {
          bounds: {
            x: 720,
            y: 144,
            width: 560,
            height: 576,
          },
        },
      });
    });
  });
});
