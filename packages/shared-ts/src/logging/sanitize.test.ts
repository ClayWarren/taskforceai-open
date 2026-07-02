import { describe, expect, it } from 'bun:test';

import { sanitizeValue } from './sanitize';

describe('logging/sanitize', () => {
  describe('sanitizeValue', () => {
    it('returns non-string primitives unchanged', () => {
      expect(sanitizeValue(42)).toBe(42);
      expect(sanitizeValue(true)).toBe(true);
      expect(sanitizeValue(null)).toBe(null);
      expect(sanitizeValue(undefined)).toBe(undefined);
    });

    it('converts bigint values to strings', () => {
      expect(sanitizeValue(123n)).toBe('123');
      expect(sanitizeValue({ id: 123n })).toEqual({ id: '123' });
    });

    it('returns plain strings unchanged', () => {
      expect(sanitizeValue('hello world')).toBe('hello world');
    });

    it('redacts email addresses', () => {
      expect(sanitizeValue('contact: user@example.com')).toBe('contact: [REDACTED_EMAIL]');
    });

    it('redacts credit card numbers', () => {
      expect(sanitizeValue('card: 1234-5678-9012-3456')).toBe('card: [REDACTED_CREDIT_CARD]');
      expect(sanitizeValue('card: 1234 5678 9012 3456')).toBe('card: [REDACTED_CREDIT_CARD]');
    });

    it('redacts API keys', () => {
      expect(sanitizeValue('key: sk_1234567890abcdefghijklmnop')).toBe('key: [REDACTED_API_KEY]');
      expect(sanitizeValue('key: api_1234567890abcdefghijklmnop')).toBe('key: [REDACTED_API_KEY]');
    });

    it('redacts Stripe keys', () => {
      expect(sanitizeValue('sk_test_1234567890abcdefghijklmnop')).toBe('[REDACTED_STRIPE_KEY]');
      expect(sanitizeValue('pk_live_1234567890abcdefghijklmnop')).toBe('[REDACTED_STRIPE_KEY]');
    });

    it('redacts SSN', () => {
      expect(sanitizeValue('ssn: 123-45-6789')).toBe('ssn: [REDACTED_SSN]');
    });

    it('redacts phone numbers', () => {
      expect(sanitizeValue('phone: 123-456-7890')).toBe('phone: [REDACTED_PHONE]');
      expect(sanitizeValue('phone: 123.456.7890')).toBe('phone: [REDACTED_PHONE]');
    });

    it('redacts JWT tokens', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      expect(sanitizeValue(`token: ${jwt}`)).toBe('token: [REDACTED_JWT]');
    });

    it('redacts Bearer tokens', () => {
      expect(sanitizeValue('Authorization: Bearer abc123xyz')).toBe(
        'Authorization: [REDACTED_BEARER_TOKEN]'
      );
      expect(sanitizeValue('Authorization: bEaReR abc123xyz')).toBe(
        'Authorization: [REDACTED_BEARER_TOKEN]'
      );
    });

    it('redacts dotted Bearer tokens', () => {
      expect(sanitizeValue('Authorization: Bearer abc.def.ghi')).toBe(
        'Authorization: [REDACTED_BEARER_TOKEN]'
      );
    });

    it('handles arrays recursively', () => {
      expect(sanitizeValue(['hello', 'user@example.com', 42])).toEqual([
        'hello',
        '[REDACTED_EMAIL]',
        42,
      ]);
    });

    it('redacts keys named apikey or api_key', () => {
      expect(sanitizeValue({ apiKey: 'secret123' })).toEqual({
        apiKey: '[REDACTED_API_KEY]',
      });
      expect(sanitizeValue({ api_key: 'secret123' })).toEqual({
        api_key: '[REDACTED_API_KEY]',
      });
    });

    it('redacts password, secret, and token keys', () => {
      expect(sanitizeValue({ password: 'secret123' })).toEqual({
        password: '[REDACTED]',
      });
      expect(sanitizeValue({ secret: 'my-secret' })).toEqual({
        secret: '[REDACTED]',
      });
      expect(sanitizeValue({ authToken: 'abc123' })).toEqual({
        authToken: '[REDACTED]',
      });
    });

    it('recursively sanitizes nested objects', () => {
      expect(
        sanitizeValue({
          user: {
            email: 'user@example.com',
            name: 'John',
          },
          credentials: {
            password: 'secret',
          },
        })
      ).toEqual({
        user: {
          email: '[REDACTED_EMAIL]',
          name: 'John',
        },
        credentials: {
          password: '[REDACTED]',
        },
      });
    });

    it('handles mixed nested structures', () => {
      expect(
        sanitizeValue({
          items: ['user@test.com', { apiKey: 'key123' }],
          value: 123,
        })
      ).toEqual({
        items: ['[REDACTED_EMAIL]', { apiKey: '[REDACTED_API_KEY]' }],
        value: 123,
      });
    });

    it('handles circular references without throwing', () => {
      const circular: Record<string, unknown> = { email: 'user@example.com' };
      circular['self'] = circular;

      expect(sanitizeValue(circular)).toEqual({
        email: '[REDACTED_EMAIL]',
        self: '[Circular]',
      });
    });

    it('handles circular arrays without throwing', () => {
      const circular: unknown[] = ['user@example.com'];
      circular.push(circular);

      expect(sanitizeValue(circular)).toEqual(['[REDACTED_EMAIL]', '[Circular]']);
    });
  });
});
