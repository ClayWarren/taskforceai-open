import { describe, expect, it } from 'bun:test';
import { mobileMetrics } from '../../observability/metrics';

describe('mobile qa observability stubs', () => {
  it('provides a valid mobileMetrics object to prevent API client crashes (Hardening TF-0101, TF-0103)', () => {
    // The bug was that these functions didn't exist, causing the shared API client to crash on mobile
    expect(mobileMetrics).toBeDefined();
    expect(typeof mobileMetrics.startTimer).toBe('function');
    expect(typeof mobileMetrics.incrementCounter).toBe('function');

    // They should be safe to call
    expect(() => {
      const stop = mobileMetrics.startTimer('test');
      stop();
      mobileMetrics.incrementCounter('test');
    }).not.toThrow();
  });
});
