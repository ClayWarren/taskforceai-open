import { z } from 'zod';

import { type Result, err, ok } from '../result';

export type JsonParseError = 'INVALID_JSON' | 'INVALID_SCHEMA' | 'EMPTY_INPUT';

export const parseJsonSchema = <T>(
  raw: string,
  schema: z.ZodType<T>
): Result<T, JsonParseError> => {
  if (!raw) {
    return err('EMPTY_INPUT');
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const validation = schema.safeParse(parsed);
    if (!validation.success) {
      return err('INVALID_SCHEMA');
    }
    return ok(validation.data);
  } catch {
    return err('INVALID_JSON');
  }
};

export const parseJsonValueSchema = <T>(
  raw: unknown,
  schema: z.ZodType<T>
): Result<T, JsonParseError> => {
  if (typeof raw === 'string') {
    return parseJsonSchema(raw, schema);
  }
  if (raw === undefined) {
    return err('EMPTY_INPUT');
  }
  const validation = schema.safeParse(raw);
  if (!validation.success) {
    return err('INVALID_SCHEMA');
  }
  return ok(validation.data);
};
