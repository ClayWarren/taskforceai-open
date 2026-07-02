import { z } from 'zod';

import { type AuthTokenPayload, type MetricsCollector, type TokenError } from './request.types';
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
  if (typeof token !== 'object' || token === null) {
    return err('TOKEN_INVALID');
  }

  const accessToken = token.access_token;
  const legacyToken = token.token;
  if (
    (accessToken !== undefined && typeof accessToken !== 'string') ||
    (legacyToken !== undefined && typeof legacyToken !== 'string')
  ) {
    return err('TOKEN_INVALID');
  }

  const resolved = accessToken ?? legacyToken;
  if (resolved) {
    const normalizedToken = resolved.trim();
    if (normalizedToken.length > 0) {
      return ok(normalizedToken);
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      body: text,
      message: response.statusText || text,
    };
  }

  if (isRecord(parsed) && Array.isArray(parsed['errors'])) {
    let message = '';
    for (const item of parsed['errors']) {
      if (!isRecord(item) || typeof item['message'] !== 'string') {
        continue;
      }
      const trimmedMessage = item['message'].trim();
      if (!trimmedMessage) {
        continue;
      }
      message = message ? `${message}; ${trimmedMessage}` : trimmedMessage;
    }
    if (message) {
      return { body: parsed, message };
    }
  }
  if (isRecord(parsed) && typeof parsed['detail'] === 'string') {
    return { body: parsed, message: parsed['detail'] };
  }
  return {
    body: parsed,
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

  if (response.status === 204 || response.status === 205) {
    return undefined as unknown as T;
  }

  if (isJsonResponse(response)) {
    const text = await response.text();
    if (!text.trim()) {
      return undefined as unknown as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('Invalid JSON response');
    }
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
