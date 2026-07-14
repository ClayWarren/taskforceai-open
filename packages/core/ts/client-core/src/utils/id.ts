import type { RNG } from '@taskforceai/client-core/random/rng';

export const createId = (prefix: string, rng: RNG): string => {
  const suffix = rng.uuid();
  return `${prefix}-${suffix}`;
};
