import { describe, expect, it, vi } from 'bun:test';

import { Logger } from '../logger';
import { createSentryTransport, type SentryLike } from './sentry';

const createScope = (): Parameters<SentryLike['withScope']>[0] extends (scope: infer Scope) => void
  ? Scope
  : never => ({
  setLevel: () => {},
  setContext: () => {},
  setTag: () => {},
  setExtra: () => {},
});

describe('shared/logger/transports/sentry', () => {
  it('captures messages with mapped levels, context, tags, and metadata extras', () => {
    const setLevel = vi.fn();
    const setContext = vi.fn();
    const setTag = vi.fn();
    const setExtra = vi.fn();
    const captureMessage = vi.fn(() => 'message-id');
    const captureException = vi.fn(() => 'exception-id');

    const sentry: SentryLike = {
      withScope: (callback) =>
        callback({
          setLevel,
          setContext,
          setTag,
          setExtra,
        }),
      captureException,
      captureMessage,
    };
    const transport = createSentryTransport({ sentry, levels: ['warn'] });

    transport.log({
      level: 'warn',
      message: 'quota warning',
      timestamp: '2026-06-13T12:00:00.000Z',
      context: { requestId: 'req-1' },
      tags: ['billing', 'quota'],
      metadata: { remaining: 1 },
    });

    expect(setLevel).toHaveBeenCalledWith('warning');
    expect(setContext).toHaveBeenCalledWith('logger', { requestId: 'req-1' });
    expect(setTag).toHaveBeenNthCalledWith(1, 'billing', 'true');
    expect(setTag).toHaveBeenNthCalledWith(2, 'quota', 'true');
    expect(setExtra).toHaveBeenCalledWith('remaining', 1);
    expect(captureMessage).toHaveBeenCalledWith('quota warning', { level: 'warning' });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('respects enabled levels, custom level mapping, and metadata suppression', () => {
    const setLevel = vi.fn();
    const setExtra = vi.fn();
    const captureMessage = vi.fn(() => 'message-id');

    const sentry: SentryLike = {
      withScope: (callback) =>
        callback({
          setLevel,
          setContext: vi.fn(),
          setTag: vi.fn(),
          setExtra,
        }),
      captureException: vi.fn(() => 'exception-id'),
      captureMessage,
    };
    const transport = createSentryTransport({
      sentry,
      levels: ['info'],
      includeMetadata: false,
      mapLevel: () => 'fatal',
    });

    transport.log({
      level: 'debug',
      message: 'hidden',
      timestamp: '2026-06-13T12:00:00.000Z',
      metadata: { hidden: true },
    });
    transport.log({
      level: 'info',
      message: 'visible',
      timestamp: '2026-06-13T12:00:00.000Z',
      metadata: { hidden: false },
    });

    expect(setLevel).toHaveBeenCalledTimes(1);
    expect(setLevel).toHaveBeenCalledWith('fatal');
    expect(setExtra).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith('visible', { level: 'fatal' });
  });

  it('captures exceptions when metadata contains flattened errors', () => {
    let capturedException: unknown;
    let capturedExceptionHint: unknown;
    let capturedMessage: string | undefined;

    const sentry: SentryLike = {
      withScope: (callback) => callback(createScope()),
      captureException: (error, hint) => {
        capturedException = error;
        capturedExceptionHint = hint;
        return 'exception-id';
      },
      captureMessage: (message) => {
        capturedMessage = message;
        return 'message-id';
      },
    };

    const logger = new Logger({
      level: 'debug',
      transports: [createSentryTransport({ sentry, levels: ['error'] })],
    });

    const originalError = new Error('boom');
    logger.error('request failed', originalError);

    expect(capturedException).toBeInstanceOf(Error);
    expect((capturedException as Error).message).toBe('boom');
    expect(capturedExceptionHint).toEqual(
      expect.objectContaining({
        level: 'error',
        originalMessage: 'request failed',
      })
    );
    expect(capturedMessage).toBeUndefined();
  });
});
