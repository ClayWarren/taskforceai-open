import { describe, expect, it, vi } from 'bun:test';

import { formatFileSize, readFileContent } from './file';

interface TestFileReader {
  readAsText(blob: Blob): void;
  readonly result: string | ArrayBuffer | null;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

describe('utils/file', () => {
  describe('formatFileSize', () => {
    it('formats 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
    });

    it('formats KB', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('formats MB', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    });

    it('formats GB', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('formats TB', () => {
      expect(formatFileSize(1024 ** 4)).toBe('1 TB');
    });

    it('clamps edge inputs to valid units', () => {
      expect(formatFileSize(-1)).toBe('0 Bytes');
      expect(formatFileSize(Number.NaN)).toBe('0 Bytes');
      expect(formatFileSize(0.5)).toBe('0.5 Bytes');
      expect(formatFileSize(1024 ** 5)).toBe('1 PB');
      expect(formatFileSize(1024 ** 6)).toBe('1024 PB');
    });
  });

  describe('readFileContent', () => {
    it('uses file.text() if available', async () => {
      const file = new Blob(['content']);
      // Mock text() method
      const textMock = vi.fn().mockResolvedValue('content');
      Object.defineProperty(file, 'text', { value: textMock });

      const content = await readFileContent(file);
      expect(content).toBe('content');
    });

    it('uses FileReader if file.text() is not available', async () => {
      class MockReader implements TestFileReader {
        result: string | null = null;
        listeners: Record<string, Function> = {};

        addEventListener(type: string, listener: Function) {
          this.listeners[type] = listener;
        }

        removeEventListener(type: string, _listener: Function) {
          delete this.listeners[type];
        }

        readAsText(_blob: Blob) {
          this.result = 'file reader content';
          this.listeners['load']?.({ target: { result: this.result } });
        }
      }

      // Create a blob without text() method (simulating old browser or weird environment)
      const file = { size: 100, type: 'text/plain' } as Blob;

      const content = await readFileContent(file, MockReader);
      expect(content).toBe('file reader content');
    });

    it('decodes ArrayBuffer FileReader results', async () => {
      class BufferReader implements TestFileReader {
        result: ArrayBuffer | null = null;
        listeners: Record<string, Function> = {};

        addEventListener(type: string, listener: Function) {
          this.listeners[type] = listener;
        }

        removeEventListener(type: string) {
          delete this.listeners[type];
        }

        readAsText() {
          this.result = new TextEncoder().encode('buffer content').buffer;
          this.listeners['load']?.({ target: { result: this.result } });
        }
      }

      await expect(readFileContent({} as Blob, BufferReader)).resolves.toBe('buffer content');
    });

    it('uses a global FileReader implementation when one is available', async () => {
      const previousFileReader = (globalThis as { FileReader?: unknown }).FileReader;

      class GlobalReader implements TestFileReader {
        result: string | null = null;
        listeners: Record<string, Function> = {};

        addEventListener(type: string, listener: Function) {
          this.listeners[type] = listener;
        }

        removeEventListener(type: string) {
          delete this.listeners[type];
        }

        readAsText() {
          this.result = 'global reader content';
          this.listeners['load']?.({ target: null });
        }
      }

      try {
        delete (globalThis as { window?: unknown }).window;
        (globalThis as unknown as { FileReader: typeof GlobalReader }).FileReader = GlobalReader;

        await expect(readFileContent({} as Blob)).resolves.toBe('global reader content');
      } finally {
        if (previousFileReader === undefined) {
          delete (globalThis as { FileReader?: unknown }).FileReader;
        } else {
          (globalThis as { FileReader?: unknown }).FileReader = previousFileReader;
        }
      }
    });

    it('prefers window FileReader over a global FileReader implementation', async () => {
      const previousWindow = globalThis.window;
      const previousFileReader = (globalThis as { FileReader?: unknown }).FileReader;

      class GlobalReader implements TestFileReader {
        result: string | null = 'global';
        addEventListener() {}
        removeEventListener() {}
        readAsText() {
          throw new Error('global reader should not be used');
        }
      }

      class WindowReader implements TestFileReader {
        result: string | null = null;
        listeners: Record<string, Function> = {};

        addEventListener(type: string, listener: Function) {
          this.listeners[type] = listener;
        }

        removeEventListener(type: string) {
          delete this.listeners[type];
        }

        readAsText() {
          this.result = 'window reader content';
          this.listeners['load']?.({ target: { result: this.result } });
        }
      }

      try {
        (globalThis as unknown as { FileReader: typeof GlobalReader }).FileReader = GlobalReader;
        (globalThis as { window?: unknown }).window = { FileReader: WindowReader };

        await expect(readFileContent({} as Blob)).resolves.toBe('window reader content');
      } finally {
        (globalThis as { window?: unknown }).window = previousWindow;
        if (previousFileReader === undefined) {
          delete (globalThis as { FileReader?: unknown }).FileReader;
        } else {
          (globalThis as { FileReader?: unknown }).FileReader = previousFileReader;
        }
      }
    });

    it('rejects unsupported FileReader result types', async () => {
      class UnsupportedReader implements TestFileReader {
        result: null = null;
        listeners: Record<string, Function> = {};

        addEventListener(type: string, listener: Function) {
          this.listeners[type] = listener;
        }

        removeEventListener() {}

        readAsText() {
          this.listeners['load']?.({ target: { result: null } });
        }
      }

      await expect(readFileContent({} as Blob, UnsupportedReader)).rejects.toThrow(
        'FileReader result is not a string'
      );
    });

    it('throws when no FileReader implementation is available', async () => {
      const previousWindow = globalThis.window;
      const previousFileReader = (globalThis as { FileReader?: unknown }).FileReader;
      delete (globalThis as { window?: unknown }).window;
      delete (globalThis as { FileReader?: unknown }).FileReader;

      await expect(readFileContent({} as Blob)).rejects.toThrow('FileReader not available');

      (globalThis as { window?: unknown }).window = previousWindow;
      (globalThis as { FileReader?: unknown }).FileReader = previousFileReader;
    });

    it('handles FileReader errors', async () => {
      class ErrorReader implements TestFileReader {
        result: string | null = null;
        listeners: Record<string, Function> = {};

        addEventListener(type: string, listener: Function) {
          this.listeners[type] = listener;
        }

        removeEventListener() {}

        readAsText() {
          setTimeout(() => {
            this.listeners['error']?.(new Error('read error'));
          }, 0);
        }
      }

      const file = {} as Blob;
      await expect(readFileContent(file, ErrorReader)).rejects.toThrow('read error');
    });

    it('rejects when FileReader readAsText throws synchronously', async () => {
      class ThrowingReader implements TestFileReader {
        result: string | null = null;

        addEventListener() {}
        removeEventListener() {}
        readAsText() {
          throw new Error('read failed immediately');
        }
      }

      await expect(readFileContent({} as Blob, ThrowingReader)).rejects.toThrow(
        'read failed immediately'
      );
    });
  });
});
