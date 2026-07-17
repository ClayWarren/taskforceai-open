import { describe, expect, it } from 'bun:test';

import '../../../../../tests/setup/dom';
import { getBrowserOrigin } from './browser-context';

describe('browser-context', () => {
  describe('getBrowserOrigin', () => {
    it('returns origin when window is defined', () => {
      // happy-dom environment has window
      const result = getBrowserOrigin();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('http://localhost');
      }
    });

    it('returns error when window is undefined', () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
      Reflect.deleteProperty(globalThis, 'window');

      try {
        const result = getBrowserOrigin();
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toEqual({
            kind: 'unavailable',
            message: 'Browser origin unavailable.',
          });
        }
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(globalThis, 'window', originalDescriptor);
        }
      }
    });
  });
});
