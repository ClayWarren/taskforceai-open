import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { parseJsonSchema, parseJsonValueSchema } from './parse';

describe('client-core/json/parse', () => {
  describe('parseJsonSchema', () => {
    const stringSchema = z.string();
    const objectSchema = z.object({ name: z.string(), age: z.number() });

    it('parses valid JSON with matching schema', () => {
      const result = parseJsonSchema('{"name":"John","age":30}', objectSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ name: 'John', age: 30 });
      }
    });

    it('returns EMPTY_INPUT for empty string', () => {
      const result = parseJsonSchema('', stringSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('EMPTY_INPUT');
      }
    });

    it('returns INVALID_JSON for malformed JSON', () => {
      const result = parseJsonSchema('{ invalid json }', stringSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('INVALID_JSON');
      }
    });

    it('returns INVALID_SCHEMA when JSON does not match schema', () => {
      const result = parseJsonSchema('{"name":"John"}', objectSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('INVALID_SCHEMA');
      }
    });

    it('parses simple string JSON', () => {
      const result = parseJsonSchema('"hello"', stringSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('hello');
      }
    });
  });

  describe('parseJsonValueSchema', () => {
    const numberSchema = z.number();
    const objectSchema = z.object({ id: z.number() });

    it('parses string input by delegating to parseJsonSchema', () => {
      const result = parseJsonValueSchema('42', numberSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it('returns EMPTY_INPUT for undefined', () => {
      const result = parseJsonValueSchema(undefined, numberSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('EMPTY_INPUT');
      }
    });

    it('validates non-string values directly against schema', () => {
      const result = parseJsonValueSchema({ id: 123 }, objectSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ id: 123 });
      }
    });

    it('returns INVALID_SCHEMA for non-string values that do not match', () => {
      const result = parseJsonValueSchema({ id: 'not a number' }, objectSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('INVALID_SCHEMA');
      }
    });

    it('validates number directly against schema', () => {
      const result = parseJsonValueSchema(42, numberSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it('returns INVALID_SCHEMA for null when schema expects number', () => {
      const result = parseJsonValueSchema(null, numberSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('INVALID_SCHEMA');
      }
    });
  });
});
