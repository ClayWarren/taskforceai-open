/**
 * Random Number Generator abstraction.
 *
 * Use this instead of reading system randomness explicitly.
 * to allow for seeded/deterministic testing.
 */
export interface RNG {
  /**
   * Returns a random number between 0 (inclusive) and 1 (exclusive).
   * Return a value in the same range as the host random number generator.
   */
  random(): number;

  /**
   * Generates a UUID string.
   */
  uuid(): string;
}
