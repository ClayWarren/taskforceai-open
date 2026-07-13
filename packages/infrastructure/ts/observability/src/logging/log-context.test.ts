import { describe, expect, it } from 'bun:test';

import { getCorrelationId, getLogMetadata, runWithLogContext } from './log-context';

describe('log-context', () => {
  describe('runWithLogContext', () => {
    it('runs function with provided correlation ID', () => {
      const result = runWithLogContext({ correlationId: 'test-id-123' }, () => {
        return getCorrelationId();
      });

      expect(result).toBe('test-id-123');
    });

    it('generates correlation ID if not provided', async () => {
      const result = await runWithLogContext({}, async () => {
        return getCorrelationId();
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      if (result !== undefined) {
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('includes metadata when provided', () => {
      const result = runWithLogContext(
        { correlationId: 'test', metadata: { userId: 42, action: 'test' } },
        () => {
          return getLogMetadata();
        }
      );

      expect(result).toEqual({ userId: 42, action: 'test' });
    });

    it('supports async functions', async () => {
      const result = await runWithLogContext({ correlationId: 'async-id' }, async () => {
        await Promise.resolve();
        return getCorrelationId();
      });

      expect(result).toBe('async-id');
    });

    it('inherits parent context correlation ID', () => {
      const result = runWithLogContext({ correlationId: 'parent-id' }, () => {
        return runWithLogContext({}, () => {
          return getCorrelationId();
        });
      });

      expect(result).toBe('parent-id');
    });

    it('merges metadata with parent context', () => {
      const result = runWithLogContext({ metadata: { foo: 'bar' } }, () => {
        return runWithLogContext({ metadata: { baz: 'qux' } }, () => {
          return getLogMetadata();
        });
      });

      expect(result).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('lets child metadata override parent metadata with the same key', () => {
      const result = runWithLogContext({ metadata: { scope: 'parent', shared: 'parent' } }, () => {
        return runWithLogContext({ metadata: { shared: 'child', childOnly: true } }, () => {
          return getLogMetadata();
        });
      });

      expect(result).toEqual({ scope: 'parent', shared: 'child', childOnly: true });
    });
  });

  describe('getCorrelationId', () => {
    it('returns undefined outside of context', () => {
      expect(getCorrelationId()).toBeUndefined();
    });
  });

  describe('getLogMetadata', () => {
    it('returns empty object outside of context', () => {
      expect(getLogMetadata()).toEqual({});
    });

    it('returns metadata when set', () => {
      runWithLogContext({ metadata: { key: 'value' } }, () => {
        expect(getLogMetadata()).toEqual({ key: 'value' });
      });
    });
  });

  it('uses the browser storage shim when imported without process', async () => {
    const originalProcess = globalThis.process;
    try {
      // @ts-expect-error - simulate a browser-like module load
      globalThis.process = undefined;
      const browserModule = await import(`./log-context?browser=${Date.now()}`);

      const result = browserModule.runWithLogContext({ correlationId: 'browser-id' }, () =>
        browserModule.getCorrelationId()
      );

      expect(result).toBeUndefined();
    } finally {
      globalThis.process = originalProcess;
    }
  });
});
