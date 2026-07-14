import { sanitizeValue } from '@taskforceai/observability/logging/sanitize';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'x-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-vercel-ai-key',
  'vercel-ai-key',
  'vercel_ai_api_key',
  'vercelaikey',
  'api_key',
  'apikey',
  'vercel_ai_key',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'password',
  'client_secret',
  'stripe_secret_key',
]);

export const isSensitiveSentryKey = (key: string): boolean => {
  const lowerKey = key.toLowerCase();
  return (
    SENSITIVE_KEYS.has(lowerKey) ||
    lowerKey.includes('apikey') ||
    lowerKey.includes('api_key') ||
    lowerKey.includes('api-key') ||
    lowerKey.includes('authorization') ||
    lowerKey.includes('cookie') ||
    lowerKey.includes('password') ||
    lowerKey.includes('session') ||
    lowerKey.includes('secret') ||
    lowerKey.includes('token')
  );
};

export const isApiKeyLikeSentryKey = (key: string): boolean => {
  const lowerKey = key.toLowerCase();
  return (
    lowerKey.includes('apikey') ||
    lowerKey.includes('api_key') ||
    lowerKey.includes('api-key') ||
    lowerKey.includes('vercel-ai-key') ||
    lowerKey.includes('vercel_ai_key') ||
    lowerKey.includes('vercel_ai_api_key') ||
    lowerKey.includes('vercelaikey') ||
    lowerKey.includes('x-api-key')
  );
};

export const sanitizeSentryString = (value: string): string => String(sanitizeValue(value));
