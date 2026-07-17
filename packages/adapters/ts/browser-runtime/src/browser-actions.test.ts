import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  confirmAction,
  copyToClipboard,
  downloadBlob,
  navigateTo,
  openInNewTab,
  reloadPage,
  scrollToTop,
  showAlert,
  writeClipboardText,
} from './browser-actions';

const globalScope = globalThis as Record<string, unknown>;

let previousWindow: unknown;
let previousDocument: unknown;
let previousNavigator: unknown;

const restoreGlobal = (name: string, value: unknown): void => {
  if (value === undefined) {
    delete globalScope[name];
    return;
  }
  globalScope[name] = value;
};

describe('client-core/utils/browser-actions', () => {
  beforeEach(() => {
    previousWindow = globalScope['window'];
    previousDocument = globalScope['document'];
    previousNavigator = globalScope['navigator'];
  });

  afterEach(() => {
    restoreGlobal('window', previousWindow);
    restoreGlobal('document', previousDocument);
    restoreGlobal('navigator', previousNavigator);
    vi.restoreAllMocks();
  });

  it('returns invalid when navigateTo URL is blank', () => {
    const result = navigateTo('   ');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid', message: 'URL is required' },
    });
  });

  it('returns unavailable when navigateTo is called without window', () => {
    delete globalScope['window'];

    const result = navigateTo('https://taskforceai.chat');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Window is not available' },
    });
  });

  it('returns failed when navigateTo cannot set location.href', () => {
    const location = {};
    Object.defineProperty(location, 'href', {
      get: () => 'https://old.example',
      set: () => {
        throw new Error('navigation blocked');
      },
      configurable: true,
    });
    globalScope['window'] = { location };

    const result = navigateTo('https://taskforceai.chat');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'navigation blocked' },
    });
  });

  it('navigates when location href can be assigned', () => {
    const location = { href: 'https://old.example' };
    globalScope['window'] = { location };

    const result = navigateTo('https://taskforceai.chat');

    expect(location.href).toBe('https://taskforceai.chat');
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('reloads the page when reload API is available', () => {
    const reload = vi.fn();
    globalScope['window'] = { location: { reload } };

    expect(reloadPage()).toEqual({ ok: true, value: undefined });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('returns failed when reloadPage throws', () => {
    const reload = vi.fn(() => {
      throw new Error('reload blocked');
    });
    globalScope['window'] = { location: { reload } };

    const result = reloadPage();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'reload blocked' },
    });
  });

  it('returns unavailable when reloadPage is called without window', () => {
    delete globalScope['window'];

    expect(reloadPage()).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Window is not available' },
    });
  });

  it('returns unavailable when alert API is missing', () => {
    globalScope['window'] = {};

    const result = showAlert('hello');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Alert is not available' },
    });
  });

  it('shows alerts when alert API is available', () => {
    const alert = vi.fn();
    globalScope['window'] = { alert };

    expect(showAlert('hello')).toEqual({ ok: true, value: undefined });
    expect(alert).toHaveBeenCalledWith('hello');
  });

  it('returns failed when alert throws', () => {
    globalScope['window'] = {
      alert: () => {
        throw new Error('alert blocked');
      },
    };

    expect(showAlert('hello')).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'alert blocked' },
    });
  });

  it('returns unavailable when confirm API is missing', () => {
    globalScope['window'] = {};

    expect(confirmAction('continue?')).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Confirm is not available' },
    });
  });

  it('returns failed when confirm throws', () => {
    globalScope['window'] = {
      confirm: () => {
        throw new Error('confirm blocked');
      },
    };

    const result = confirmAction('continue?');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'confirm blocked' },
    });
  });

  it('returns confirm result when confirm succeeds', () => {
    const confirm = vi.fn(() => true);
    globalScope['window'] = { confirm };

    const result = confirmAction('continue?');

    expect(confirm).toHaveBeenCalledWith('continue?');
    expect(result).toEqual({ ok: true, value: true });
  });

  it('returns false from copyToClipboard when clipboard write fails', async () => {
    globalScope['navigator'] = {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('clipboard blocked');
        }),
      },
    };

    const copied = await copyToClipboard('hello');

    expect(copied).toBe(false);
  });

  it('copies text to clipboard when clipboard write succeeds', async () => {
    const writeText = vi.fn(async () => {});
    globalScope['navigator'] = { clipboard: { writeText } };

    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns false from copyToClipboard when clipboard API is unavailable', async () => {
    globalScope['navigator'] = {};

    await expect(copyToClipboard('hello')).resolves.toBe(false);
  });

  it('returns unavailable from writeClipboardText when clipboard API is missing', async () => {
    globalScope['navigator'] = {};

    const result = await writeClipboardText('hello');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Clipboard is not available' },
    });
  });

  it('returns failed from writeClipboardText when clipboard write throws', async () => {
    globalScope['navigator'] = {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('clipboard blocked');
        }),
      },
    };

    const result = await writeClipboardText('hello');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'clipboard blocked' },
    });
  });

  it('writes clipboard text when clipboard API succeeds', async () => {
    const writeText = vi.fn(async () => {});
    globalScope['navigator'] = { clipboard: { writeText } };

    await expect(writeClipboardText('hello')).resolves.toEqual({ ok: true, value: undefined });
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns unavailable from downloadBlob when document APIs are missing', () => {
    delete globalScope['window'];
    delete globalScope['document'];

    const result = downloadBlob({ blob: new Blob(['test']), filename: 'result.txt' });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Document is not available' },
    });
  });

  it('downloads blob and defers object URL revocation when APIs are available', () => {
    vi.useFakeTimers();
    const removeChild = vi.fn();
    const link = {
      href: '',
      setAttribute: vi.fn(),
      click: vi.fn(),
      parentNode: { removeChild },
    };
    const createElement = vi.fn(() => link);
    const appendChild = vi.fn();
    globalScope['document'] = {
      createElement,
      body: { appendChild },
    };

    const createObjectURL = vi.fn(() => 'blob:test-url');
    const revokeObjectURL = vi.fn();
    globalScope['window'] = {
      URL: { createObjectURL, revokeObjectURL },
    };

    const blob = new Blob(['payload'], { type: 'text/plain' });
    const result = downloadBlob({ blob, filename: 'report.txt' });

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(createElement).toHaveBeenCalledWith('a');
    expect(link.href).toBe('blob:test-url');
    expect(link.setAttribute).toHaveBeenCalledWith('download', 'report.txt');
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledWith(link);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    expect(result).toEqual({ ok: true, value: undefined });
    vi.useRealTimers();
  });

  it('returns failed when blob download setup throws', () => {
    globalScope['document'] = {
      createElement: () => {
        throw new Error('cannot create link');
      },
    };
    globalScope['window'] = {
      URL: { createObjectURL: vi.fn(() => 'blob:test-url'), revokeObjectURL: vi.fn() },
    };

    expect(downloadBlob({ blob: new Blob(['payload']), filename: 'report.txt' })).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'cannot create link' },
    });
  });

  it('opens URL in a new tab with noopener and noreferrer', () => {
    const open = vi.fn();
    globalScope['window'] = { open };

    openInNewTab('https://taskforceai.chat');

    expect(open).toHaveBeenCalledWith('https://taskforceai.chat', '_blank', 'noopener,noreferrer');
  });

  it('does not open a new tab when window is unavailable', () => {
    delete globalScope['window'];

    expect(() => openInNewTab('https://taskforceai.chat')).not.toThrow();
  });

  it('scrolls to the top when window is available and no-ops without window', () => {
    delete globalScope['window'];

    expect(() => scrollToTop()).not.toThrow();

    const scrollTo = vi.fn();
    globalScope['window'] = { scrollTo };

    scrollToTop();

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
