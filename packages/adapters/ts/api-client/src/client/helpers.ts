import { z } from 'zod';
import { parseOptional, type createRequestContext } from '../request';
import { type Result, err, ok } from '../utils/result';

export type RequestContext = ReturnType<typeof createRequestContext>;

export const encodePathSegment = (value: string): string => encodeURIComponent(value);

export const positiveIntegerPathSegment = (value: number, label: string): string => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return String(value);
};

export const createHelpers = (context: RequestContext) => {
  const { request, buildJsonHeaders } = context;

  const post = async <T>(
    p: string,
    b: unknown,
    s: z.ZodType<T>,
    h = buildJsonHeaders()
  ): Promise<T> =>
    s.parse(await request(p, { method: 'POST', headers: h, body: JSON.stringify(b) }));

  const patch = async <T>(
    p: string,
    b: unknown,
    s: z.ZodType<T>,
    h = buildJsonHeaders()
  ): Promise<T> =>
    s.parse(await request(p, { method: 'PATCH', headers: h, body: JSON.stringify(b) }));

  const get = async <T>(p: string, s: z.ZodType<T>, init: RequestInit = {}): Promise<T> =>
    s.parse(
      await request(p, {
        ...init,
        method: 'GET',
      })
    );

  const result = async <T>(
    s: z.ZodType<T>,
    requestBody: () => Promise<unknown>
  ): Promise<Result<T>> => {
    try {
      const parsed = parseOptional(s, await requestBody());
      return parsed !== undefined ? ok(parsed) : err(new Error('No response data'));
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return { post, patch, get, result, request, buildJsonHeaders };
};
