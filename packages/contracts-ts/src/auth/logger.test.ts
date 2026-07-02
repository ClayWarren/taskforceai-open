import { describe, expect, it } from 'bun:test';

describe('shared/auth/logger', () => {
  it('creates a logger when process is unavailable', async () => {
    const originalProcess = globalThis.process;
    try {
      // @ts-expect-error - simulate a browser-like runtime
      globalThis.process = undefined;
      const module = await import(`./logger?browser=${Date.now()}`);

      expect(module.getAuthLogger()).toBeDefined();
    } finally {
      globalThis.process = originalProcess;
    }
  });
});
