import type { z } from 'zod';

import { parseJsonSchema } from '../json/parse';

export const fromBooleanFlag = (value?: number | boolean | null): boolean =>
  typeof value === 'boolean' ? value : value === 1;

export const toBooleanFlag = (value?: unknown): boolean => Boolean(value);

export const serializeJson = (value: unknown): string => {
  if (value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

export const safeParseJson = <T>(
  value: string | null | undefined,
  schema: z.ZodType<T>,
  fallback: T
): T => {
  if (!value) {
    return fallback;
  }
  const parsed = parseJsonSchema(value, schema);
  return parsed.ok ? parsed.value : fallback;
};

export const serializeError = (error: unknown): { message: string; stack?: string } =>
  error instanceof Error
    ? {
        message: error.message,
        ...(error.stack !== undefined ? { stack: error.stack } : {}),
      }
    : { message: String(error) };
