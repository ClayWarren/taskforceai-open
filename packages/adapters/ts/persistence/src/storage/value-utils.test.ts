import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import {
  fromBooleanFlag,
  safeParseJson,
  serializeError,
  serializeJson,
  toBooleanFlag,
} from './value-utils';

describe('storage value utils', () => {
  it('converts database boolean flags', () => {
    expect(fromBooleanFlag(true)).toBe(true);
    expect(fromBooleanFlag(false)).toBe(false);
    expect(fromBooleanFlag(1)).toBe(true);
    expect(fromBooleanFlag(0)).toBe(false);
    expect(fromBooleanFlag(null)).toBe(false);
    expect(toBooleanFlag('hello')).toBe(true);
    expect(toBooleanFlag(undefined)).toBe(false);
  });

  it('serializes JSON values defensively', () => {
    expect(serializeJson({ foo: 'bar' })).toBe('{"foo":"bar"}');
    expect(serializeJson(undefined)).toBe('');

    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(serializeJson(circular)).toBe('');
  });

  it('parses JSON with schema fallback', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const fallback = { name: 'default', age: 0 };

    expect(safeParseJson('{"name":"Jane","age":31}', schema, fallback)).toEqual({
      name: 'Jane',
      age: 31,
    });
    expect(safeParseJson('{"name":"Jane"}', schema, fallback)).toBe(fallback);
    expect(safeParseJson('not-json', schema, fallback)).toBe(fallback);
    expect(safeParseJson(null, schema, fallback)).toBe(fallback);
  });

  it('serializes errors for structured logging', () => {
    expect(serializeError(new Error('boom')).message).toBe('boom');
    expect(serializeError('plain')).toEqual({ message: 'plain' });
  });
});
