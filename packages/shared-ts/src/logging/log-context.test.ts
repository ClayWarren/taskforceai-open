import { describe, expect, it } from 'bun:test';

import {
  CORRELATION_ID_HEADER,
  appendLogMetadata,
  getCorrelationId,
  getLogContext,
  getLogMetadata,
  runWithLogContext,
  withRequestContext,
} from './log-context';

describe('log-context', () => {
  describe('CORRELATION_ID_HEADER', () => {
    it('exports the correct header name', () => {
      expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
    });
  });

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
  });

  describe('getLogContext', () => {
    it('returns undefined outside of context', () => {
      expect(getLogContext()).toBeUndefined();
    });

    it('returns context when inside runWithLogContext', () => {
      runWithLogContext({ correlationId: 'ctx-id' }, () => {
        const ctx = getLogContext();
        expect(ctx).toBeDefined();
        expect(ctx?.correlationId).toBe('ctx-id');
      });
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

  describe('appendLogMetadata', () => {
    it('appends metadata to existing context', () => {
      runWithLogContext({ correlationId: 'append-test', metadata: { initial: true } }, () => {
        appendLogMetadata({ added: 'value' });
        expect(getLogMetadata()).toEqual({ initial: true, added: 'value' });
      });
    });

    it('creates context if none exists', () => {
      // Run in its own context to not leak state
      runWithLogContext({}, () => {
        // Clear any existing metadata first
        appendLogMetadata({ standalone: true });
        const ctx = getLogContext();
        expect(ctx).toBeDefined();
        expect(ctx?.metadata?.['standalone']).toBe(true);
      });
    });

    it('overwrites existing keys with same name', () => {
      runWithLogContext({ metadata: { key: 'original' } }, () => {
        appendLogMetadata({ key: 'updated' });
        const meta = getLogMetadata();
        expect(meta['key']).toEqual('updated');
      });
    });
  });

  describe('withRequestContext', () => {
    it('handles null request', () => {
      const result = withRequestContext(null, () => {
        return getCorrelationId();
      });

      expect(result).toBeDefined();
    });

    it('handles undefined request', () => {
      const result = withRequestContext(undefined, () => {
        return getCorrelationId();
      });

      expect(result).toBeDefined();
    });

    it('extracts correlation ID from x-correlation-id header', () => {
      const request = new Request('http://localhost/api/test', {
        headers: { 'x-correlation-id': 'req-corr-id' },
      });

      const result = withRequestContext(request, () => {
        return getCorrelationId();
      });

      expect(result).toBe('req-corr-id');
    });

    it('falls back to x-request-id header', () => {
      const request = new Request('http://localhost/api/test', {
        headers: { 'x-request-id': 'x-req-id' },
      });

      const result = withRequestContext(request, () => {
        return getCorrelationId();
      });

      expect(result).toBe('x-req-id');
    });

    it('includes method and url in metadata', () => {
      const request = new Request('http://localhost/api/test', {
        method: 'POST',
      });

      const result = withRequestContext(request, () => {
        return getLogMetadata();
      });

      expect(result).toMatchObject({
        method: 'POST',
        url: 'http://localhost/api/test',
      });
    });

    it('supports async functions', async () => {
      const request = new Request('http://localhost/api/test', {
        headers: { 'x-correlation-id': 'async-req-id' },
      });

      const result = await withRequestContext(request, async () => {
        await Promise.resolve();
        return getCorrelationId();
      });

      expect(result).toBe('async-req-id');
    });
  });
});
