import { createGraphTransformer } from '../internal/graph-transform';

/**
 * Patterns for detecting and redacting sensitive information in logs.
 */
const sensitivePatterns = [
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    name: 'email',
  },
  { pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, name: 'credit_card' },
  {
    pattern: /\b(?:sk|pk|api|key|token)_[a-zA-Z0-9]{20,}\b/gi,
    name: 'api_key',
  },
  { pattern: /\b(sk|pk)_(test|live)_[a-zA-Z0-9]{24,}\b/g, name: 'stripe_key' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, name: 'ssn' },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, name: 'phone' },
  {
    pattern: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
    name: 'jwt',
  },
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

type SensitiveStringSignals = {
  hasAt: boolean;
  hasDigit: boolean;
  hasUnderscore: boolean;
  hasJwtPrefix: boolean;
  hasBearer: boolean;
};

const shouldCheckPattern = (
  name: (typeof sensitivePatterns)[number]['name'],
  signals: SensitiveStringSignals
): boolean => {
  if (name === 'email') return signals.hasAt;
  if (name === 'credit_card' || name === 'ssn' || name === 'phone') return signals.hasDigit;
  if (name === 'api_key' || name === 'stripe_key') return signals.hasUnderscore;
  if (name === 'jwt') return signals.hasJwtPrefix;
  if (name === 'bearer_token') return signals.hasBearer;
  return true;
};

const sanitizeString = (value: string): string => {
  const signals = {
    hasAt: value.includes('@'),
    hasDigit: containsAsciiDigit(value),
    hasUnderscore: value.includes('_'),
    hasJwtPrefix: value.includes('eyJ') && value.includes('.'),
    hasBearer: containsBearerToken(value),
  };

  if (!Object.values(signals).some(Boolean)) {
    return value;
  }

  let sanitized = value;
  for (const { pattern, name } of sensitivePatterns) {
    if (!shouldCheckPattern(name, signals)) {
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
  return createGraphTransformer({
    leaf: (entry) =>
      typeof entry === 'string'
        ? sanitizeString(entry)
        : typeof entry === 'bigint'
          ? entry.toString()
          : entry,
    redact: (key) => {
      const normalized = key.toLowerCase();
      if (normalized.includes('apikey') || normalized.includes('api_key')) {
        return '[REDACTED_API_KEY]';
      }
      return normalized.includes('password') ||
        normalized.includes('secret') ||
        normalized.includes('token')
        ? '[REDACTED]'
        : undefined;
    },
    memoize: false,
    preserveArrayHoles: true,
  })(value);
};
