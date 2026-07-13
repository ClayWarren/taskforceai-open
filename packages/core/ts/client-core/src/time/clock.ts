/**
 * Clock abstraction for managing time deterministically.
 *
 * Use this instead of reading the system clock to allow for
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
