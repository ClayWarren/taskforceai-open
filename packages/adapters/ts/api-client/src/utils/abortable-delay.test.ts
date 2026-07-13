import { describe, expect, it } from 'bun:test';

import { abortableDelay } from './abortable-delay';

describe('abortableDelay', () => {
  it('creates an AbortError when DOMException is unavailable', async () => {
    const original = globalThis.DOMException;
    Object.defineProperty(globalThis, 'DOMException', { configurable: true, value: undefined });
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(abortableDelay(0, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
        message: 'The operation was aborted',
      });
    } finally {
      Object.defineProperty(globalThis, 'DOMException', { configurable: true, value: original });
    }
  });
});
