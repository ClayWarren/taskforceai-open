import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const loggerWarn = mock();
const openDesktopBrowserPreview = mock();

mock.module('@taskforceai/web/app/lib/logger', () => ({ logger: { warn: loggerWarn } }));
mock.module('../platform/app-server', () => ({ openDesktopBrowserPreview }));

import { useDesktopBrowserPreview } from './useDesktopBrowserPreview';

describe('useDesktopBrowserPreview', () => {
  beforeEach(() => {
    loggerWarn.mockReset();
    openDesktopBrowserPreview.mockReset();
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it('closes the preview and reports intercepted URL failures', async () => {
    const error = new Error('preview unavailable');
    openDesktopBrowserPreview.mockRejectedValue(error);
    const { result } = renderHook(() => useDesktopBrowserPreview(true));

    act(() => result.current.openBrowserPreview());
    expect(result.current.isBrowserPreviewOpen).toBe(true);
    act(() => result.current.closeBrowserPreview());
    expect(result.current.isBrowserPreviewOpen).toBe(false);

    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/docs';
    anchor.textContent = 'Docs';
    document.body.append(anchor);
    act(() => {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });

    await waitFor(() =>
      expect(loggerWarn).toHaveBeenCalledWith('Failed to open URL in desktop browser preview', {
        error,
        url: 'https://example.com/docs',
      })
    );
  });
});
