import { describe, expect, it } from 'bun:test';
import { readApiErrorMessage, readErrorBody, readStatusCode } from './response';

describe('readStatusCode', () => {
  it('returns null for non-objects', () => {
    expect(readStatusCode(null)).toBe(null);
    expect(readStatusCode(undefined)).toBe(null);
    expect(readStatusCode('error')).toBe(null);
    expect(readStatusCode(123)).toBe(null);
  });

  it('reads status property', () => {
    expect(readStatusCode({ status: 404 })).toBe(404);
    expect(readStatusCode({ status: 500 })).toBe(500);
  });

  it('reads statusCode property', () => {
    expect(readStatusCode({ statusCode: 400 })).toBe(400);
    expect(readStatusCode({ statusCode: 503 })).toBe(503);
  });

  it('reads status from nested response', () => {
    expect(readStatusCode({ response: { status: 401 } })).toBe(401);
    expect(readStatusCode({ response: { status: 403 } })).toBe(403);
  });

  it('prefers direct status over statusCode', () => {
    expect(readStatusCode({ status: 404, statusCode: 500 })).toBe(404);
  });

  it('prefers direct statusCode over nested response', () => {
    expect(readStatusCode({ statusCode: 400, response: { status: 500 } })).toBe(400);
  });

  it('returns null when no status found', () => {
    expect(readStatusCode({})).toBe(null);
    expect(readStatusCode({ message: 'error' })).toBe(null);
    expect(readStatusCode({ response: {} })).toBe(null);
  });
});

describe('readErrorBody', () => {
  it('returns null for non-objects', () => {
    expect(readErrorBody(null)).toBe(null);
    expect(readErrorBody(undefined)).toBe(null);
    expect(readErrorBody('error')).toBe(null);
  });

  it('returns body property', () => {
    expect(readErrorBody({ body: { error: 'test' } })).toEqual({ error: 'test' });
    expect(readErrorBody({ body: 'error message' })).toBe('error message');
  });

  it('returns null when no body property', () => {
    expect(readErrorBody({})).toBe(null);
    expect(readErrorBody({ message: 'error' })).toBe(null);
  });
});

describe('readApiErrorMessage', () => {
  it('prefers error over message', () => {
    expect(readApiErrorMessage({ error: 'invalid', message: 'fallback' })).toBe('invalid');
  });

  it('reads message when error is missing', () => {
    expect(readApiErrorMessage({ message: 'Something went wrong' })).toBe('Something went wrong');
  });

  it('ignores empty and non-string values', () => {
    expect(readApiErrorMessage({ error: '', message: 123 })).toBe(null);
    expect(readApiErrorMessage(null)).toBe(null);
  });
});
