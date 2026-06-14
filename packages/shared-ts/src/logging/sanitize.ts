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

/**
 * Redacts sensitive values recursively.
 */
export const sanitizeValue = (value: unknown): unknown => {
  const seen = new Set<unknown>();

  const sanitize = (next: unknown): unknown => {
    if (typeof next === 'string') {
      let sanitized = next;
      for (const { pattern, name } of sensitivePatterns) {
        sanitized = sanitized.replace(pattern, `[REDACTED_${name.toUpperCase()}]`);
      }
      return sanitized;
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
