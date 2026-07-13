import { describe, expect, it } from 'bun:test';
import { classifyApiError } from './error-utils';

describe('classifyApiError', () => {
  it('classifies 401 as unauthorized', () => {
    const result = classifyApiError({ status: 401 });
    expect(result).toEqual({ kind: 'unauthorized', status: 401 });
  });

  it('classifies 404 as not_found', () => {
    const result = classifyApiError({ status: 404 });
    expect(result).toEqual({ kind: 'not_found', status: 404 });
  });

  it('classifies 4xx as server error', () => {
    expect(classifyApiError({ status: 400 })).toEqual({ kind: 'server', status: 400 });
    expect(classifyApiError({ status: 403 })).toEqual({ kind: 'server', status: 403 });
    expect(classifyApiError({ status: 422 })).toEqual({ kind: 'server', status: 422 });
  });

  it('classifies 5xx as server error', () => {
    expect(classifyApiError({ status: 500 })).toEqual({ kind: 'server', status: 500 });
    expect(classifyApiError({ status: 502 })).toEqual({ kind: 'server', status: 502 });
    expect(classifyApiError({ status: 503 })).toEqual({ kind: 'server', status: 503 });
  });

  it('classifies no status as network error', () => {
    expect(classifyApiError(null)).toEqual({ kind: 'network' });
    expect(classifyApiError(undefined)).toEqual({ kind: 'network' });
    expect(classifyApiError({})).toEqual({ kind: 'network' });
    expect(classifyApiError({ message: 'Network error' })).toEqual({ kind: 'network' });
  });

  it('reads status from nested response', () => {
    const result = classifyApiError({ response: { status: 401 } });
    expect(result).toEqual({ kind: 'unauthorized', status: 401 });
  });

  it('reads statusCode property', () => {
    const result = classifyApiError({ statusCode: 404 });
    expect(result).toEqual({ kind: 'not_found', status: 404 });
  });
});
