import { isRecord } from './guards';

/**
 * Patterns for detecting and redacting sensitive information in logs.
 */
const sensitivePatterns = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, name: 'email' },
  { pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, name: 'credit_card' },
  { pattern: /\b(?:sk|pk|api|key|token)_[a-zA-Z0-9]{20,}\b/gi, name: 'api_key' },
  { pattern: /\b(sk|pk)_(test|live)_[a-zA-Z0-9]{24,}\b/g, name: 'stripe_key' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, name: 'ssn' },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, name: 'phone' },
  { pattern: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, name: 'jwt' },
  { pattern: /\bBearer\s+[^\s,;]+/gi, name: 'bearer_token' },
] as const;

const containsAsciiDigit = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 48 && code <= 57) {
      return true;
    }
  }
  return false;
};

const matchesBearerPrefix = (value: string, start: number): boolean =>
  value.charCodeAt(start) === 66 || value.charCodeAt(start) === 98
    ? (value.charCodeAt(start + 1) | 32) === 101 &&
      (value.charCodeAt(start + 2) | 32) === 97 &&
      (value.charCodeAt(start + 3) | 32) === 114 &&
      (value.charCodeAt(start + 4) | 32) === 101 &&
      (value.charCodeAt(start + 5) | 32) === 114
    : false;

const containsBearerToken = (value: string): boolean => {
  for (let index = 0; index <= value.length - 6; index += 1) {
    if (matchesBearerPrefix(value, index)) {
      return true;
    }
  }
  return false;
};

const sanitizeString = (value: string): string => {
  const hasAt = value.includes('@');
  const hasDigit = containsAsciiDigit(value);
  const hasUnderscore = value.includes('_');
  const hasJwtPrefix = value.includes('eyJ') && value.includes('.');
  const hasBearer = containsBearerToken(value);

  if (!hasAt && !hasDigit && !hasUnderscore && !hasJwtPrefix && !hasBearer) {
    return value;
  }

  let sanitized = value;
  for (const { pattern, name } of sensitivePatterns) {
    if (name === 'email' && !hasAt) {
      continue;
    }
    if ((name === 'credit_card' || name === 'ssn' || name === 'phone') && !hasDigit) {
      continue;
    }
    if ((name === 'api_key' || name === 'stripe_key') && !hasUnderscore) {
      continue;
    }
    if (name === 'jwt' && !hasJwtPrefix) {
      continue;
    }
    if (name === 'bearer_token' && !hasBearer) {
      continue;
    }
    sanitized = sanitized.replace(pattern, `[REDACTED_${name.toUpperCase()}]`);
  }
  return sanitized;
};

/**
 * Redacts sensitive values recursively.
 */
export const sanitizeValue = (value: unknown): unknown => {
  const seen = new Set<unknown>();

  const sanitize = (next: unknown): unknown => {
    if (typeof next === 'string') {
      return sanitizeString(next);
    }

    if (typeof next === 'bigint') {
      return next.toString();
    }

    if (Array.isArray(next)) {
      if (seen.has(next)) {
        return '[Circular]';
      }
      seen.add(next);
      const sanitizedArray = next.map((entry) => sanitize(entry));
      seen.delete(next);
      return sanitizedArray;
    }

    if (isRecord(next)) {
      if (seen.has(next)) {
        return '[Circular]';
      }
      seen.add(next);
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(next)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('apikey') || lowerKey.includes('api_key')) {
          sanitized[key] = '[REDACTED_API_KEY]';
          continue;
        }
        if (
          lowerKey.includes('password') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('token')
        ) {
          sanitized[key] = '[REDACTED]';
          continue;
        }
        sanitized[key] = sanitize(val);
      }
      seen.delete(next);
      return sanitized;
    }

    return next;
  };

  return sanitize(value);
};
