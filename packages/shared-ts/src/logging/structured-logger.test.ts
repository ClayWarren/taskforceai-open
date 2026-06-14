import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { z } from 'zod';

import { parseJsonSchema } from '../json/parse';
import { ConsoleLogger } from './structured-logger';

describe('ConsoleLogger', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write');
    stderrWrite = vi.spyOn(process.stderr, 'write');
    stdoutWrite.mockImplementation(() => true);
    stderrWrite.mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  it('rejects invalid log levels', () => {
    expect(
      () =>
        new ConsoleLogger({
          environment: 'test',
          level: 'verbose' as never,
        })
    ).toThrow(/Unexpected value/);
  });

  it('sanitizes sensitive values and includes correlation/metadata', () => {
    const logger = new ConsoleLogger({
      environment: 'test',
      level: 'debug',
      baseMeta: { service: 'web', password: 'super-secret' },
      getCorrelationId: () => 'corr-1',
      getLogMetadata: () => ({
        requestId: 'req-1',
        apiKey: 'sk_test_abcdefghijklmnopqrstuvwxyz0123',
      }),
    });

    logger.info('user email test@example.com', {
      token: 'abc',
      nested: { creditCard: '1111-2222-3333-4444' },
    });

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const payload = String(stdoutWrite.mock.calls[0][0]).trim();
    const parsedResult = parseJsonSchema(payload, z.record(z.string(), z.unknown()));
    if (!parsedResult.ok) {
      throw new Error(`Invalid JSON log payload: ${parsedResult.error}`);
    }
    const parsed = parsedResult.value;
    const meta = parsed['meta'];
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null;
    if (!isRecord(meta)) {
      throw new Error('Missing log metadata');
    }

    expect(parsed['level']).toBe('info');
    expect(parsed['correlationId']).toBe('corr-1');
    expect(parsed['message']).toContain('[REDACTED_EMAIL]');
    expect(meta).toMatchObject({
      service: 'web',
      requestId: 'req-1',
      token: '[REDACTED]',
    });
    expect(meta['password']).toBe('[REDACTED]');
    expect(meta['nested']).toEqual({ creditCard: '[REDACTED_CREDIT_CARD]' });
    expect(meta['apiKey']).toBe('[REDACTED_API_KEY]');
  });

  it('honors log level thresholds for debug/info/warn/error', () => {
    const logger = new ConsoleLogger({
      environment: 'test',
      level: 'info',
    });

    logger.debug('skip-debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(stdoutWrite).toHaveBeenCalledTimes(1); // info
    expect(stderrWrite).toHaveBeenCalledTimes(2); // warn + error
  });

  it('routes errors to the configured reporter with context metadata', () => {
    const errorReporter = vi.fn();

    const logger = new ConsoleLogger({
      environment: 'test',
      level: 'debug',
      getCorrelationId: () => 'corr-2',
      getLogMetadata: () => ({ session: 'abc' }),
      errorReporter,
    });

    const error = new Error('boom');
    logger.error('failure', { error, cause: error, detail: 'extra' });

    expect(stderrWrite).toHaveBeenCalled();
    expect(errorReporter).toHaveBeenCalledWith({
      message: 'failure',
      meta: { error, cause: error, detail: 'extra' },
      environment: 'test',
      correlationId: 'corr-2',
      baseMeta: {},
      getLogMetadata: expect.any(Function),
    });
  });

  it('logs bigint metadata without throwing', () => {
    const logger = new ConsoleLogger({
      environment: 'test',
      level: 'debug',
    });

    expect(() => logger.info('bigint', { id: 1n })).not.toThrow();
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const payload = String(stdoutWrite.mock.calls[0][0]).trim();
    expect(payload).toContain('"id":"1"');
  });
});
