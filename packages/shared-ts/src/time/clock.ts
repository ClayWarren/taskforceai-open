/**
 * Clock abstraction for managing time deterministically.
 *
 * Use this instead of `Date.now()` or `new Date()` to allow for
 * deterministic testing and time travel.
 */
export interface Clock {
  /**
   * Get the current timestamp in milliseconds
   */
  now(): number;

  /**
   * Get the current Date object
   */
  date(): Date;
}

/**
 * Real system clock implementation
 */
export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }

  date(): Date {
    return new Date();
  }
}

/**
 * Fixed clock for testing
 */
export class FixedClock implements Clock {
  private currentTime: number;

  constructor(initialTime: number | Date = Date.now()) {
    this.currentTime = typeof initialTime === 'number' ? initialTime : initialTime.getTime();
  }

  now(): number {
    return this.currentTime;
  }

  date(): Date {
    return new Date(this.currentTime);
  }

  /**
   * Advance the clock by a specified duration
   */
  advance(ms: number): void {
    this.currentTime += ms;
  }

  /**
   * Set the clock to a specific time
   */
  set(time: number | Date): void {
    this.currentTime = typeof time === 'number' ? time : time.getTime();
  }
}

/**
 * Global instance of the real clock.
 * Prefer dependency injection, but use this for default values.
 */
export const systemClock = new RealClock();
