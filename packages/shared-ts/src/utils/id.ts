import type { RNG } from '@taskforceai/shared/random/rng';
import { systemRNG } from '@taskforceai/shared/random/rng';

export const createId = (prefix: string, rng: RNG = systemRNG): string => {
  const suffix = rng.uuid();
  return `${prefix}-${suffix}`;
};
