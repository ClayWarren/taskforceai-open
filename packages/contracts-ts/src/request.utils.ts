import { z } from 'zod';

import {
  type AuthTokenPayload,
  type MetricsCollector,
  type TokenError,
  tokenSchema,
} from './request.types';
import { parseJsonSchema } from './utils/json';
import { type Result, err, ok } from './utils/result';

export const isJsonResponse = (response: Response): boolean => {
  const contentType = response.headers.get('content-type');
  return contentType ? contentType.includes('application/json') : false;
};

export const normalizeBaseUrl = (value?: string): string => {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const parseOptional = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown
): Schema['_output'] | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  return schema.parse(value);
};

export const resolveBearerToken = (token: AuthTokenPayload): Result<string, TokenError> => {
  if (typeof token === 'string') {
    const normalizedToken = token.trim();
    if (normalizedToken.length > 0) {
      return ok(normalizedToken);
    }
    return err('TOKEN_INVALID');
  }
  const parsedToken = tokenSchema.safeParse(token);
  if (parsedToken.success) {
    const resolved = parsedToken.data.access_token ?? parsedToken.data.token;
    if (resolved) {
      const normalizedToken = resolved.trim();
      if (normalizedToken.length > 0) {
        return ok(normalizedToken);
      }
    }
  }
  return err('TOKEN_INVALID');
};

export const parseErrorPayload = (
  response: Response,
  text: string
): { body: unknown; message: string } => {
  if (!text) {
    return { body: text, message: response.statusText || 'Request failed' };
  }

  const parsed = parseJsonSchema(text, z.unknown());
  if (!parsed.ok) {
    return {
      body: text,
      message: response.statusText || text,
    };
  }
  if (isRecord(parsed.value) && Array.isArray(parsed.value['errors'])) {
    const messages = parsed.value['errors']
      .map((item) =>
        isRecord(item) && typeof item['message'] === 'string' ? item['message'].trim() : ''
      )
      .filter(Boolean);
    if (messages.length > 0) {
      return { body: parsed.value, message: messages.join('; ') };
    }
  }
  if (isRecord(parsed.value) && typeof parsed.value['detail'] === 'string') {
    return { body: parsed.value, message: parsed.value['detail'] };
  }
  return {
    body: parsed.value,
    message: response.statusText || text,
  };
};

export const parseSuccessPayload = async <T>(
  response: Response,
  parseJson: boolean
): Promise<T> => {
  if (!parseJson) {
    return (await response.text()) as unknown as T;
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  if (isJsonResponse(response)) {
    return (await response.json()) as T;
  }

  return undefined as unknown as T;
};

export const applyAuthorizationHeader = async (
  headers: Headers,
  metricLabels: { baseUrl: string; method: string; path: string },
  metrics: MetricsCollector,
  resolveToken: () => Promise<Result<AuthTokenPayload, TokenError>>
): Promise<void> => {
  if (headers.has('Authorization')) {
    return;
  }

  const token = await resolveToken();
  metrics.incrementCounter('api.client.token.resolved', {
    baseUrl: metricLabels.baseUrl,
    present: token.ok,
  });

  if (!token.ok) {
    metrics.incrementCounter('api.client.token.missing', { baseUrl: metricLabels.baseUrl });
    return;
  }

  const bearerToken = resolveBearerToken(token.value);
  if (!bearerToken.ok) {
    metrics.incrementCounter('api.client.token.invalid', { baseUrl: metricLabels.baseUrl });
    return;
  }

  metrics.incrementCounter('api.client.token.applied', { baseUrl: metricLabels.baseUrl });
  headers.set('Authorization', `Bearer ${bearerToken.value}`);
};
