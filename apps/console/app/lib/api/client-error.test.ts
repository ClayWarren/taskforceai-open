import { describe, it, expect } from 'bun:test';
import { readStatusCode, readErrorBody } from './client-error';

describe('client-error', () => {
  describe('readStatusCode', () => {
    it('returns null for non-objects', () => {
      expect(readStatusCode(null)).toBeNull();
      expect(readStatusCode(undefined)).toBeNull();
      expect(readStatusCode('error')).toBeNull();
      expect(readStatusCode(123)).toBeNull();
    });

    it('reads status from status property', () => {
      expect(readStatusCode({ status: 404 })).toBe(404);
    });

    it('reads status from statusCode property', () => {
      expect(readStatusCode({ statusCode: 500 })).toBe(500);
    });

    it('reads status from response.status property', () => {
      expect(readStatusCode({ response: { status: 401 } })).toBe(401);
    });

    it('prioritizes direct status over statusCode', () => {
      expect(readStatusCode({ status: 400, statusCode: 500 })).toBe(400);
    });

    it('returns null if no status property is found', () => {
      expect(readStatusCode({ message: 'Error' })).toBeNull();
      expect(readStatusCode({ response: {} })).toBeNull();
    });
  });

  describe('readErrorBody', () => {
    it('returns null for non-objects', () => {
      expect(readErrorBody(null)).toBeNull();
      expect(readErrorBody('body')).toBeNull();
    });

    it('returns body if present', () => {
      const body = { detail: 'error' };
      expect(readErrorBody({ body })).toBe(body);
    });

    it('returns null if body is missing', () => {
      expect(readErrorBody({})).toBeNull();
    });
  });
});
