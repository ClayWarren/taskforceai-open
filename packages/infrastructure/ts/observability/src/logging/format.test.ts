import { describe, expect, it } from 'bun:test';

import { formatLogEntry } from './format';

describe('logging/format', () => {
  describe('formatLogEntry', () => {
    it('formats a basic log entry', () => {
      const result = formatLogEntry({
        level: 'info',
        message: 'Test message',
        meta: undefined,
        environment: 'test',
        nodeVersion: '20.0.0',
        correlationId: undefined,
        baseMeta: {},
        getLogMetadata: () => ({}),
      });

      const parsed = JSON.parse(result);
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('Test message');
      expect(parsed.environment).toBe('test');
      expect(parsed.nodeVersion).toBe('20.0.0');
      expect(parsed.timestamp).toBeDefined();
    });

    it('includes correlationId when provided', () => {
      const result = formatLogEntry({
        level: 'debug',
        message: 'Test',
        meta: undefined,
        environment: 'test',
        nodeVersion: '20.0.0',
        correlationId: 'corr-123',
        baseMeta: {},
        getLogMetadata: () => ({}),
      });

      const parsed = JSON.parse(result);
      expect(parsed.correlationId).toBe('corr-123');
    });

    it('excludes correlationId when undefined', () => {
      const result = formatLogEntry({
        level: 'info',
        message: 'Test',
        meta: undefined,
        environment: 'test',
        nodeVersion: '20.0.0',
        correlationId: undefined,
        baseMeta: {},
        getLogMetadata: () => ({}),
      });

      const parsed = JSON.parse(result);
      expect(parsed.correlationId).toBeUndefined();
    });

    it('includes meta when provided', () => {
      const result = formatLogEntry({
        level: 'info',
        message: 'Test',
        meta: { userId: '123', action: 'test' },
        environment: 'test',
        nodeVersion: '20.0.0',
        correlationId: undefined,
        baseMeta: {},
        getLogMetadata: () => ({}),
      });

      const parsed = JSON.parse(result);
      expect(parsed.meta).toEqual({ userId: '123', action: 'test' });
    });

    it('sanitizes sensitive data in message', () => {
      const result = formatLogEntry({
        level: 'info',
        message: 'User email: user@example.com',
        meta: undefined,
        environment: 'test',
        nodeVersion: '20.0.0',
        correlationId: undefined,
        baseMeta: {},
        getLogMetadata: () => ({}),
      });

      const parsed = JSON.parse(result);
      expect(parsed.message).toBe('User email: [REDACTED_EMAIL]');
    });

    it('sanitizes sensitive data in meta', () => {
      const result = formatLogEntry({
        level: 'info',
        message: 'Test',
        meta: { password: 'secret123' },
        environment: 'test',
        nodeVersion: '20.0.0',
        correlationId: undefined,
        baseMeta: {},
        getLogMetadata: () => ({}),
      });

      const parsed = JSON.parse(result);
      expect(parsed.meta.password).toBe('[REDACTED]');
    });

    it('merges baseMeta and getLogMetadata', () => {
      const result = formatLogEntry({
        level: 'info',
        message: 'Test',
        meta: { extra: 'data' },
        environment: 'test',
        nodeVersion: '20.0.0',
        correlationId: undefined,
        baseMeta: { app: 'test-app' },
        getLogMetadata: () => ({ requestId: 'req-123' }),
      });

      const parsed = JSON.parse(result);
      expect(parsed.meta.app).toBe('test-app');
      expect(parsed.meta.requestId).toBe('req-123');
      expect(parsed.meta.extra).toBe('data');
    });

    it('handles all log levels', () => {
      const levels = ['debug', 'info', 'warn', 'error'] as const;
      for (const level of levels) {
        const result = formatLogEntry({
          level,
          message: 'Test',
          meta: undefined,
          environment: 'test',
          nodeVersion: '20.0.0',
          correlationId: undefined,
          baseMeta: {},
          getLogMetadata: () => ({}),
        });

        const parsed = JSON.parse(result);
        expect(parsed.level).toBe(level);
      }
    });

    it('handles circular meta payloads without throwing', () => {
      const circular: Record<string, unknown> = { userId: '123' };
      circular['self'] = circular;

      const result = formatLogEntry({
        level: 'info',
        message: 'Test',
        meta: circular,
        environment: 'test',
        nodeVersion: '20.0.0',
        correlationId: undefined,
        baseMeta: {},
        getLogMetadata: () => ({}),
      });

      const parsed = JSON.parse(result);
      expect(parsed.meta.userId).toBe('123');
      expect(parsed.meta.self.userId).toBe('123');
      expect(parsed.meta.self.self).toBe('[Circular]');
    });
  });
});
