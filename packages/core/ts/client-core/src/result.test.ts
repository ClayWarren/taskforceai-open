import { describe, expect, it } from 'bun:test';

import { type Result, err, isErr, isOk, ok } from './result';

describe('client-core/result', () => {
  describe('ok', () => {
    it('creates a success result with a value', () => {
      const result = ok('hello');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('hello');
      }
    });

    it('creates a success result with undefined', () => {
      const result = ok(undefined);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(undefined);
      }
    });

    it('creates a success result with null', () => {
      const result = ok(null);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(null);
      }
    });
  });

  describe('err', () => {
    it('creates an error result with an error', () => {
      const result = err('error');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('error');
      }
    });

    it('creates an error result with an Error object', () => {
      const error = new Error('something went wrong');
      const result = err(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe('isOk', () => {
    it('returns true for ok result', () => {
      const result = ok('value');
      expect(isOk(result)).toBe(true);
    });

    it('returns false for err result', () => {
      const result = err('error');
      expect(isOk(result)).toBe(false);
    });

    it('narrows type for ok result', () => {
      const result: Result<string, string> = ok('value');
      if (isOk(result)) {
        expect(result.value).toBe('value');
      }
    });
  });

  describe('isErr', () => {
    it('returns true for err result', () => {
      const result = err('error');
      expect(isErr(result)).toBe(true);
    });

    it('returns false for ok result', () => {
      const result = ok('value');
      expect(isErr(result)).toBe(false);
    });

    it('narrows type for err result', () => {
      const result: Result<string, string> = err('error');
      if (isErr(result)) {
        expect(result.error).toBe('error');
      }
    });
  });
});
