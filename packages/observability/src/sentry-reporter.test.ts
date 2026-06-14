import { describe, expect, it, vi } from 'bun:test';

import { createSentryErrorReporter } from './sentry-reporter';

describe('observability/sentry-reporter', () => {
  const createMockSentry = () => {
    let scopeCallback: ((scope: any) => void) | null = null;
    const mockScope = {
      setLevel: vi.fn(),
      setContext: vi.fn(),
      setExtra: vi.fn(),
      setFingerprint: vi.fn(),
    };

    return {
      withScope: vi.fn((callback) => {
        scopeCallback = callback;
        callback(mockScope);
      }),
      captureException: vi.fn().mockReturnValue('event-id-1'),
      captureMessage: vi.fn().mockReturnValue('event-id-2'),
      mockScope,
      getScopeCallback: () => scopeCallback,
    };
  };

  it('creates an error reporter function', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    expect(typeof reporter).toBe('function');
  });

  it('sets error level on scope', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    reporter({
      message: 'Test error',
      environment: 'test',
      correlationId: 'corr-123',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: undefined,
    });

    expect(mockSentry.mockScope.setLevel).toHaveBeenCalledWith('error');
  });

  it('sets logger context with message and environment', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    reporter({
      message: 'Error occurred',
      environment: 'production',
      correlationId: 'corr-456',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: undefined,
    });

    expect(mockSentry.mockScope.setContext).toHaveBeenCalledWith('logger', {
      message: 'Error occurred',
      environment: 'production',
      correlationId: 'corr-456',
    });
  });

  it('captures exception when meta contains an error', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);
    const testError = new Error('Test error');

    reporter({
      message: 'Something failed',
      environment: 'test',
      correlationId: 'corr-789',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: testError,
    });

    expect(mockSentry.mockScope.setFingerprint).toHaveBeenCalledWith(['Error', 'Something failed']);
    expect(mockSentry.captureException).toHaveBeenCalledWith(testError);
    expect(mockSentry.captureMessage).not.toHaveBeenCalled();
  });

  it('captures message when meta does not contain an error', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    reporter({
      message: 'Warning message',
      environment: 'test',
      correlationId: 'corr-abc',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: { info: 'some data' },
    });

    expect(mockSentry.captureMessage).toHaveBeenCalledWith('Warning message');
    expect(mockSentry.captureException).not.toHaveBeenCalled();
  });

  it('sets meta as extra when meta is not the error', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);
    const testError = new Error('Test');
    const meta = { error: testError, additionalInfo: 'extra' };

    reporter({
      message: 'Error with meta',
      environment: 'test',
      correlationId: 'corr-def',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta,
    });

    expect(mockSentry.mockScope.setExtra).toHaveBeenCalledWith('meta', {
      error: expect.objectContaining({
        name: 'Error',
        message: 'Test',
      }),
      additionalInfo: 'extra',
    });
  });

  it('sanitizes meta before setting Sentry extras', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    reporter({
      message: 'Sensitive metadata',
      environment: 'test',
      correlationId: 'corr-secret',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: {
        accessToken: 'token-value',
        nested: { clientSecret: 'client-secret' },
      },
    });

    expect(mockSentry.mockScope.setExtra).toHaveBeenCalledWith('meta', {
      accessToken: '[REDACTED]',
      nested: { clientSecret: '[REDACTED]' },
    });
  });

  it('sanitizes context metadata before setting Sentry extras', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    reporter({
      message: 'Sensitive context',
      environment: 'test',
      correlationId: 'corr-context',
      baseMeta: { refreshToken: 'refresh-token' },
      getLogMetadata: () => ({ clientSecret: 'client-secret' }),
      meta: undefined,
    });

    expect(mockSentry.mockScope.setExtra).toHaveBeenCalledWith('contextMeta', {
      refreshToken: '[REDACTED]',
      clientSecret: '[REDACTED]',
    });
  });

  it('normalizes cyclic meta before setting Sentry extras', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);
    const meta: Record<string, unknown> = { label: 'root' };
    meta['self'] = meta;

    expect(() =>
      reporter({
        message: 'Cyclic metadata',
        environment: 'test',
        correlationId: 'corr-cycle',
        baseMeta: {},
        getLogMetadata: () => ({}),
        meta,
      })
    ).not.toThrow();

    expect(mockSentry.mockScope.setExtra).toHaveBeenCalledWith('meta', {
      label: 'root',
      self: '[Circular]',
    });
  });

  it('normalizes sensitive and cyclic array meta before setting Sentry extras', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);
    const meta: unknown[] = [{ clientSecret: 'client-secret' }];
    meta.push(meta);

    reporter({
      message: 'Array metadata',
      environment: 'test',
      correlationId: 'corr-array',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta,
    });

    expect(mockSentry.mockScope.setExtra).toHaveBeenCalledWith('meta', [
      { clientSecret: '[REDACTED]' },
      '[Circular]',
    ]);
  });

  it('does not set meta as extra when meta is the error itself', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);
    const testError = new Error('Test');

    reporter({
      message: 'Error only',
      environment: 'test',
      correlationId: 'corr-ghi',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: testError,
    });

    // setExtra should still be called for contextMeta
    const setExtraCalls = mockSentry.mockScope.setExtra.mock.calls;
    const metaCalls = setExtraCalls.filter((call: any[]) => call[0] === 'meta');
    expect(metaCalls.length).toBe(0);
  });

  it('sets contextMeta as extra when available', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    reporter({
      message: 'Error with context',
      environment: 'test',
      correlationId: 'corr-jkl',
      baseMeta: { userId: '123' },
      getLogMetadata: () => ({ requestId: 'req-456' }),
      meta: undefined,
    });

    expect(mockSentry.mockScope.setExtra).toHaveBeenCalledWith(
      'contextMeta',
      expect.objectContaining({})
    );
  });

  it('handles undefined meta', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    reporter({
      message: 'No meta',
      environment: 'test',
      correlationId: 'corr-mno',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: undefined,
    });

    expect(mockSentry.captureMessage).toHaveBeenCalledWith('No meta');
  });

  it('handles error in nested meta object', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);
    const testError = new Error('Nested error');

    reporter({
      message: 'Nested error case',
      environment: 'test',
      correlationId: 'corr-pqr',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: { error: testError },
    });

    expect(mockSentry.captureException).toHaveBeenCalledWith(testError);
  });

  it('does not set contextMeta when empty', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    reporter({
      message: 'No context meta',
      environment: 'test',
      correlationId: 'corr-empty',
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: undefined,
    });

    // Check that contextMeta was not set (only meta calls would exist if meta was provided)
    const setExtraCalls = mockSentry.mockScope.setExtra.mock.calls;
    const hasContextMeta = setExtraCalls.some((call: unknown[]) => call[0] === 'contextMeta');
    // contextMeta is set if returned value is truthy, so check if it was not called
    expect(hasContextMeta).toBe(false);
    expect(mockSentry.captureMessage).toHaveBeenCalled();
  });

  it('handles null correlationId', () => {
    const mockSentry = createMockSentry();
    const reporter = createSentryErrorReporter(mockSentry);

    reporter({
      message: 'Null correlation',
      environment: 'test',
      correlationId: undefined,
      baseMeta: {},
      getLogMetadata: () => ({}),
      meta: undefined,
    });

    expect(mockSentry.mockScope.setContext).toHaveBeenCalledWith('logger', {
      message: 'Null correlation',
      environment: 'test',
      correlationId: undefined,
    });
  });
});
