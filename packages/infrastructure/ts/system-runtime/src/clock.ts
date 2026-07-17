import type { Clock } from '@taskforceai/client-core/time/clock';

export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }

  date(): Date {
    return new Date();
  }
}

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

  advance(ms: number): void {
    this.currentTime += ms;
  }

  set(time: number | Date): void {
    this.currentTime = typeof time === 'number' ? time : time.getTime();
  }
}

export const systemClock = new RealClock();
