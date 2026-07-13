import { afterEach, describe, expect, it, vi } from 'bun:test';

import { reportOptionalLatencyMark } from './latency-mark';

const globalWithMark = globalThis as typeof globalThis & {
  __TASKFORCEAI_LATENCY_MARK__?: unknown;
};

describe('reportOptionalLatencyMark', () => {
  afterEach(() => {
    delete globalWithMark.__TASKFORCEAI_LATENCY_MARK__;
  });

  it('calls a registered latency marker', () => {
    const mark = vi.fn();
    globalWithMark.__TASKFORCEAI_LATENCY_MARK__ = mark;

    reportOptionalLatencyMark('app.ready', { ok: true });

    expect(mark).toHaveBeenCalledWith('app.ready', { ok: true });
  });

  it('ignores non-callable globals', () => {
    globalWithMark.__TASKFORCEAI_LATENCY_MARK__ = { clobbered: true };

    expect(() => reportOptionalLatencyMark('app.ready')).not.toThrow();
  });

  it('swallows marker exceptions', () => {
    globalWithMark.__TASKFORCEAI_LATENCY_MARK__ = () => {
      throw new Error('latency marker failed');
    };

    expect(() => reportOptionalLatencyMark('app.ready')).not.toThrow();
  });
});
