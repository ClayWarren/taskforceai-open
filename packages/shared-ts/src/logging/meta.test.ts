import { describe, expect, it } from 'bun:test';

import { extractError, normalizeMeta } from './meta';

describe('logging/meta', () => {
  describe('extractError', () => {
    it('returns undefined for null/undefined', () => {
      expect(extractError(null)).toBeUndefined();
      expect(extractError(undefined)).toBeUndefined();
    });

    it('returns the error if meta is an Error', () => {
      const err = new Error('test');
      expect(extractError(err)).toBe(err);
    });

    it('extracts error from record with error property', () => {
      const err = new Error('nested');
      expect(extractError({ error: err })).toBe(err);
    });

    it('extracts error from record with cause property', () => {
      const err = new Error('cause error');
      expect(extractError({ cause: err })).toBe(err);
    });

    it('returns undefined if record has no error/cause', () => {
      expect(extractError({ foo: 'bar' })).toBeUndefined();
    });

    it('returns undefined if error/cause is not an Error', () => {
      expect(extractError({ error: 'not an error' })).toBeUndefined();
    });
  });

  describe('normalizeMeta', () => {
    it('returns undefined for empty merged result', () => {
      const result = normalizeMeta({}, () => ({}), undefined);
      expect(result).toBeUndefined();
    });

    it('includes baseMeta and getLogMetadata', () => {
      const result = normalizeMeta(
        { app: 'test-app' },
        () => ({ requestId: 'req-123' }),
        undefined
      );
      expect(result).toEqual({
        app: 'test-app',
        requestId: 'req-123',
      });
    });

    it('serializes Error meta to error object', () => {
      const err = new Error('test error');
      const result = normalizeMeta({}, () => ({}), err);
      expect(result?.['error']).toEqual({
        name: 'Error',
        message: 'test error',
        stack: err.stack,
      });
    });

    it('merges record meta', () => {
      const result = normalizeMeta({ app: 'test' }, () => ({}), { userId: '123', action: 'login' });
      expect(result).toEqual({
        app: 'test',
        userId: '123',
        action: 'login',
      });
    });

    it('sets detail for non-record, non-Error meta', () => {
      const result = normalizeMeta({}, () => ({}), 'string meta');
      expect(result).toEqual({ detail: 'string meta' });

      const result2 = normalizeMeta({}, () => ({}), 42);
      expect(result2).toEqual({ detail: 42 });
    });

    it('handles null meta', () => {
      const result = normalizeMeta({ app: 'test' }, () => ({}), null);
      expect(result).toEqual({ app: 'test' });
    });
  });
});
