import { describe, expect, it } from 'bun:test';

import { FixedClock, RealClock, systemClock } from './clock';

describe('time/clock', () => {
  describe('RealClock', () => {
    it('now returns current timestamp', () => {
      const clock = new RealClock();
      const before = Date.now();
      const now = clock.now();
      const after = Date.now();
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(after);
    });

    it('date returns current Date', () => {
      const clock = new RealClock();
      const date = clock.date();
      expect(date).toBeInstanceOf(Date);
      expect(Math.abs(date.getTime() - Date.now())).toBeLessThan(1000);
    });
  });

  describe('FixedClock', () => {
    it('uses provided initial time', () => {
      const clock = new FixedClock(1000);
      expect(clock.now()).toBe(1000);
    });

    it('accepts Date as initial time', () => {
      const date = new Date('2024-01-15T12:00:00Z');
      const clock = new FixedClock(date);
      expect(clock.now()).toBe(date.getTime());
    });

    it('uses current time as default', () => {
      const before = Date.now();
      const clock = new FixedClock();
      const after = Date.now();
      expect(clock.now()).toBeGreaterThanOrEqual(before);
      expect(clock.now()).toBeLessThanOrEqual(after);
    });

    it('date returns Date for current time', () => {
      const clock = new FixedClock(1705323600000); // 2024-01-15T12:00:00Z
      const date = clock.date();
      expect(date.getTime()).toBe(1705323600000);
    });

    it('advance moves time forward', () => {
      const clock = new FixedClock(1000);
      clock.advance(500);
      expect(clock.now()).toBe(1500);
      clock.advance(100);
      expect(clock.now()).toBe(1600);
    });

    it('set updates time to specific value', () => {
      const clock = new FixedClock(1000);
      clock.set(5000);
      expect(clock.now()).toBe(5000);
    });

    it('set accepts Date', () => {
      const clock = new FixedClock(1000);
      const date = new Date('2024-06-01T00:00:00Z');
      clock.set(date);
      expect(clock.now()).toBe(date.getTime());
    });
  });

  describe('systemClock', () => {
    it('is a RealClock instance', () => {
      expect(systemClock).toBeInstanceOf(RealClock);
    });

    it('now works', () => {
      const now = systemClock.now();
      expect(typeof now).toBe('number');
    });

    it('date works', () => {
      const date = systemClock.date();
      expect(date).toBeInstanceOf(Date);
    });
  });
});
