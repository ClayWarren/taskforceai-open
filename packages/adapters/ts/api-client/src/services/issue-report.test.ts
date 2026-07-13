import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const reportIssueMock = vi.fn();
const logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};
const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalIntl = globalThis.Intl;

const setGlobalProperty = (key: 'window' | 'navigator' | 'Intl', value: unknown) => {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
};

const createDateTimeFormatConstructor = (timeZone: string) => {
  function MockDateTimeFormat() {
    return {
      format() {
        return '';
      },
      formatToParts() {
        return [];
      },
      resolvedOptions() {
        return {
          calendar: 'gregory',
          locale: 'en-US',
          numberingSystem: 'latn',
          timeZone,
        };
      },
    };
  }

  return Object.assign(MockDateTimeFormat, {
    supportedLocalesOf: () => [],
  });
};

mock.module('../api/support', () => ({
  reportIssue: reportIssueMock,
}));

mock.module('../auth/logger', () => ({
  getAuthLogger: () => logger,
}));

const { submitIssueReport } = (await import(
  `./issue-report?test=${Date.now()}`
)) as typeof import('./issue-report');

describe('issue report service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setGlobalProperty('window', {});
    setGlobalProperty('navigator', { language: 'en-US', platform: 'MacIntel' });
    setGlobalProperty('Intl', {
      DateTimeFormat: createDateTimeFormatConstructor('America/Chicago'),
    });
  });

  afterEach(() => {
    setGlobalProperty('window', originalWindow);
    setGlobalProperty('navigator', originalNavigator);
    setGlobalProperty('Intl', originalIntl);
  });

  it('submits reports with client metadata and optional context', async () => {
    reportIssueMock.mockResolvedValue(undefined);

    const result = await submitIssueReport({
      appVersion: 'web',
      category: 'ui_bug',
      description: 'Button is broken',
      context: {
        conversationId: 'conv_123',
        lastMessagePreview: 'x'.repeat(320),
      },
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(reportIssueMock).toHaveBeenCalledWith({
      category: 'ui_bug',
      description: 'Button is broken',
      metadata: {
        appVersion: 'web',
        conversationId: 'conv_123',
        latestMessagePreview: 'x'.repeat(280),
        locale: 'en-US',
        platform: 'MacIntel',
        timezone: 'America/Chicago',
      },
    });
  });

  it('falls back to empty metadata when client metadata is unavailable', async () => {
    setGlobalProperty('window', undefined);
    reportIssueMock.mockResolvedValue(undefined);

    const result = await submitIssueReport({
      category: 'billing',
      description: 'Need help',
      context: { conversationId: null },
    });

    expect(result.ok).toBe(true);
    expect(reportIssueMock).toHaveBeenCalledWith({
      category: 'billing',
      description: 'Need help',
      metadata: {},
    });
  });

  it('returns submit_failed when the API call rejects', async () => {
    reportIssueMock.mockRejectedValue(new Error('offline'));

    const result = await submitIssueReport({
      category: 'ui_bug',
      description: 'Broken',
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'submit_failed', message: 'offline' },
    });
    expect(logger.error).toHaveBeenCalledWith('Failed to submit issue report', {
      category: 'ui_bug',
      error: expect.any(Error),
    });
  });

  it('uses the fallback message when a non-Error value is rejected', async () => {
    reportIssueMock.mockRejectedValue('offline');

    const result = await submitIssueReport({
      category: 'ui_bug',
      description: 'Broken',
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'submit_failed', message: 'Unable to submit report' },
    });
  });
});
