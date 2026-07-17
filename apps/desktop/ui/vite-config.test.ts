import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { contentTypeForAsset, desktopIndexPlugin, renderDesktopIndex } from '../vite.config';

const runGenerateBundle = (
  plugin: ReturnType<typeof desktopIndexPlugin>,
  context: { emitFile: ReturnType<typeof vi.fn> },
  bundle: Record<string, { type: 'asset' | 'chunk' }>
): void => {
  const hook = plugin.generateBundle;
  if (!hook) {
    throw new Error('Desktop index plugin is missing generateBundle.');
  }

  const handler = typeof hook === 'function' ? hook : hook.handler;
  handler.call(context as never, {} as never, bundle as never, false);
};

describe('desktop Vite config helpers', () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    process.chdir(new URL('../..', import.meta.url).pathname);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('renders the desktop index with the Tauri ready marker and bundled assets', () => {
    const html = renderDesktopIndex(
      './assets/desktop-client-abc123.js',
      '    <link rel="stylesheet" href="./assets/app.css" />'
    );

    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('window.__TASKFORCE_TAURI_READY = true;');
    expect(html).toContain('<script type="module" src="./assets/desktop-client-abc123.js">');
    expect(html).toContain('<link rel="stylesheet" href="./assets/app.css" />');
  });

  it('maps known public asset names to browser content types', () => {
    expect(contentTypeForAsset('icon.png')).toBe('image/png');
    expect(contentTypeForAsset('desktop-browser-start.html')).toBe('text/html');
    expect(contentTypeForAsset('favicon.ico')).toBe('image/x-icon');
    expect(contentTypeForAsset('manifest.json')).toBe('application/json');
    expect(contentTypeForAsset('asset.bin')).toBe('application/octet-stream');
  });

  it('emits a desktop index and required public assets during bundle generation', () => {
    const plugin = desktopIndexPlugin();
    const emitFile = vi.fn();

    runGenerateBundle(
      plugin,
      { emitFile },
      {
        'assets/desktop-client-abc123.js': { type: 'chunk' },
        'assets/app.css': { type: 'asset' },
      }
    );

    const indexAsset = emitFile.mock.calls.find(([asset]) => asset.fileName === 'index.html')?.[0];

    expect(indexAsset).toEqual({
      type: 'asset',
      fileName: 'index.html',
      source: expect.stringContaining(
        '<script type="module" src="./assets/desktop-client-abc123.js">'
      ),
    });
    expect(indexAsset.source).toContain('<link rel="stylesheet" href="./assets/app.css" />');
    expect(emitFile.mock.calls.some(([asset]) => asset.fileName === 'manifest.json')).toBe(true);
    expect(emitFile.mock.calls.some(([asset]) => asset.fileName === 'favicon.ico')).toBe(true);
    expect(
      emitFile.mock.calls.some(([asset]) => asset.fileName === 'desktop-browser-start.html')
    ).toBe(true);
    for (const providerLogo of [
      'provider-logos/anthropic.png',
      'provider-logos/gemini.png',
      'provider-logos/meta.png',
      'provider-logos/openai.png',
      'provider-logos/xai.png',
    ]) {
      expect(emitFile.mock.calls.some(([asset]) => asset.fileName === providerLogo)).toBe(true);
    }
  });

  it('fails the build when no desktop entry chunk is emitted', () => {
    const plugin = desktopIndexPlugin();

    expect(() =>
      runGenerateBundle(
        plugin,
        { emitFile: vi.fn() },
        {
          'assets/app.css': { type: 'asset' },
        }
      )
    ).toThrow('Desktop build did not emit an index JavaScript entry.');
  });
});
